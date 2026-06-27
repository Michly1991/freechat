import type { AgentCredential, ClientConfig, RemoteEvent, RuntimeState } from '../config/types.js'
import { connectEventWebSocket, heartbeat, pollEvents, runActivity, runComplete, runFail, streamEvents } from '../connector/api.js'
import { executeEvent, abortAgentRuns, clearAgentSession } from '../executor/claude.js'
import { loadConfig, saveConfig, updateAgent, upsertAgent } from '../config/store.js'
import { completeBindRequest, createPairingCode, failBindRequest, listBindRequests, loginServer } from '../connector/server-admin.js'
import { pairAgent } from '../connector/api.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const runtimeState: RuntimeState = { workerRunning: false, activeRuns: {}, logs: [] }
let stopRequested = false
const streamControllers = new Map<string, AbortController>()
const websocketConnections = new Map<string, { close: () => void }>()
const seenEvents = new Set<string>()

export function log(message: string) {
  const line = `[${new Date().toISOString()}] ${message}`
  runtimeState.logs.push(line)
  if (runtimeState.logs.length > 300) runtimeState.logs.shift()
  console.log(line)
}

function activeCount(agentId?: string) {
  return Object.values(runtimeState.activeRuns).filter((run) => !agentId || run.agentId === agentId).length
}

async function handleRestartEvent(agent: AgentCredential, event: RemoteEvent) {
  const cfg = loadConfig()
  const force = event.payload?.mode === 'force'
  if (force) abortAgentRuns(agent.agentId, event.payload?.reason || 'Agent restart requested')
  if (event.payload?.clearSession !== false) clearAgentSession(agent, event.roomId)
  delete runtimeState.activeRuns[event.runId]
  updateAgent(agent.agentId, { status: 'idle', lastSeenAt: Date.now(), lastError: undefined })
  await runComplete(cfg, agent, event.runId, { output: 'Agent Client restarted', usage: { runtime: 'remote-control', usageSource: 'client_control', trustLevel: 'client_reported' } })
  log(`Agent ${agent.agentId} ${force ? 'force ' : ''}restart completed for room ${event.roomId}`)
}

async function handleEvent(agent: AgentCredential, event: RemoteEvent) {
  if (seenEvents.has(event.id)) return
  seenEvents.add(event.id)
  if (seenEvents.size > 500) seenEvents.clear()
  const cfg = loadConfig()
  if (event.type === 'agent.restart') {
    runtimeState.activeRuns[event.runId] = { runId: event.runId, agentId: agent.agentId, startedAt: Date.now(), type: event.type }
    try { await handleRestartEvent(agent, event) }
    catch (err: any) { log(`Agent ${agent.agentId} restart failed: ${err?.message || err}`); try { await runFail(cfg, agent, event.runId, err) } catch {}; updateAgent(agent.agentId, { status: 'error', lastError: err?.message || String(err), lastSeenAt: Date.now() }) }
    finally { delete runtimeState.activeRuns[event.runId] }
    return
  }
  runtimeState.activeRuns[event.runId] = { runId: event.runId, agentId: agent.agentId, startedAt: Date.now(), type: event.type }
  updateAgent(agent.agentId, { status: 'running', lastSeenAt: Date.now(), lastError: undefined })
  try {
    await runActivity(cfg, agent, event.runId, `accepted by Agent Client ${cfg.clientName}`)
    const result = await executeEvent(cfg, agent, event)
    await runComplete(cfg, agent, event.runId, { summary: result.response.slice(0, 500), output: result.response, usage: result.usage })
    updateAgent(agent.agentId, { status: 'idle', lastSeenAt: Date.now() })
  } catch (err: any) {
    log(`Agent ${agent.agentId} run ${event.runId} failed: ${err?.message || err}`)
    try { await runFail(cfg, agent, event.runId, err) } catch {}
    updateAgent(agent.agentId, { status: 'error', lastError: err?.message || String(err), lastSeenAt: Date.now() })
  } finally {
    delete runtimeState.activeRuns[event.runId]
  }
}

function ensureStream(cfg: ReturnType<typeof loadConfig>, agent: AgentCredential) {
  if (websocketConnections.has(agent.agentId) || streamControllers.has(agent.agentId)) return
  try {
    const ws = connectEventWebSocket(cfg, agent, (event) => void handleEvent(agent, event), (reason) => {
      websocketConnections.delete(agent.agentId)
      log(`WebSocket disconnected for Agent ${agent.agentId}: ${reason || 'closed'}`)
    })
    websocketConnections.set(agent.agentId, ws)
    log(`WebSocket connecting for Agent ${agent.agentId}`)
    return
  } catch (err: any) {
    log(`WebSocket unavailable for Agent ${agent.agentId}: ${err?.message || err}; falling back to SSE`)
  }
  const controller = new AbortController()
  streamControllers.set(agent.agentId, controller)
  void (async () => {
    try {
      log(`SSE connected for Agent ${agent.agentId}`)
      await streamEvents(cfg, agent, (event) => void handleEvent(agent, event), controller.signal)
    } catch (err: any) {
      if (!controller.signal.aborted) log(`SSE disconnected for Agent ${agent.agentId}: ${err?.message || err}`)
    } finally {
      streamControllers.delete(agent.agentId)
    }
  })()
}

function reconcileStreams(enabledAgents: AgentCredential[]) {
  const enabledIds = new Set(enabledAgents.map((agent) => agent.agentId))
  for (const [agentId, controller] of streamControllers) {
    if (!enabledIds.has(agentId)) { controller.abort(); streamControllers.delete(agentId) }
  }
  for (const [agentId, ws] of websocketConnections) {
    if (!enabledIds.has(agentId)) { ws.close(); websocketConnections.delete(agentId) }
  }
}

async function refreshServerAuthToken(cfg: ClientConfig) {
  if (!cfg.serverUsername || !cfg.serverPassword) return null
  try {
    const result = await loginServer(cfg.serverUrl, cfg.serverUsername, cfg.serverPassword)
    const token = result.token || result.accessToken || result.jwt || result?.user?.token
    if (!token) return null
    saveConfig({ ...loadConfig(), serverAuthToken: token, serverUser: result.user || null })
    log('FreeChat Server login refreshed for Agent Client bind checks')
    return token
  } catch (err: any) {
    log(`FreeChat Server login refresh failed: ${err?.message || err}`)
    return null
  }
}

async function claimPendingBindRequests() {
  let cfg = loadConfig()
  if (!cfg.serverAuthToken && !(await refreshServerAuthToken(cfg))) return
  cfg = loadConfig()
  let requests: any[] = []
  try { requests = await listBindRequests(cfg) } catch (err: any) {
    const message = err?.message || String(err)
    if (/登录已过期|Unauthorized|401|token/i.test(message) && await refreshServerAuthToken(cfg)) {
      requests = await listBindRequests(loadConfig()).catch((retryErr: any) => { log(`Bind request check failed: ${retryErr?.message || retryErr}`); return [] })
    } else {
      log(`Bind request check failed: ${message}`)
    }
    if (!requests.length) return
  }
  for (const request of requests) {
    if (loadConfig().agents.some((agent) => agent.agentId === request.agentId)) continue
    try {
      log(`Claiming Agent bind request ${request.id} for ${request.agentName || request.agentId}`)
      const pairing = await createPairingCode(loadConfig(), request.agentId)
      const agent = await pairAgent(loadConfig(), pairing.code, loadConfig().clientName)
      upsertAgent(agent)
      await completeBindRequest(loadConfig(), request.id, agent.connectorId)
      log(`Agent ${request.agentName || request.agentId} bound to this client`)
    } catch (err: any) {
      const message = err?.message || String(err)
      log(`Bind request ${request.id} failed: ${message}`)
      try { await failBindRequest(loadConfig(), request.id, message) } catch {}
    }
  }
}

async function tick() {
  await claimPendingBindRequests()
  const cfg = loadConfig()
  const enabledAgents = cfg.agents.filter((agent) => agent.enabled)
  reconcileStreams(enabledAgents)
  for (const agent of enabledAgents) {
    ensureStream(cfg, agent)
    try {
      await heartbeat(cfg, agent)
      updateAgent(agent.agentId, { status: activeCount(agent.agentId) > 0 ? 'running' : 'idle', lastSeenAt: Date.now() })
      if (activeCount() >= cfg.maxConcurrency || activeCount(agent.agentId) >= agent.maxConcurrency) continue
      const events = await pollEvents(cfg, agent)
      for (const event of events) {
        if (activeCount() >= cfg.maxConcurrency || activeCount(agent.agentId) >= agent.maxConcurrency) break
        void handleEvent(agent, event)
      }
    } catch (err: any) {
      log(`Agent ${agent.agentId} poll failed: ${err?.message || err}`)
      updateAgent(agent.agentId, { status: 'error', lastError: err?.message || String(err), lastSeenAt: Date.now() })
    }
  }
}

export async function startWorker() {
  if (runtimeState.workerRunning) return
  stopRequested = false
  runtimeState.workerRunning = true
  log('Agent Client worker started')
  while (!stopRequested) {
    const cfg = loadConfig()
    await tick()
    await sleep(Math.max(1000, cfg.pollIntervalMs || 3000))
  }
  runtimeState.workerRunning = false
  log('Agent Client worker stopped')
}

export function stopWorker() {
  stopRequested = true
  for (const controller of streamControllers.values()) controller.abort()
  streamControllers.clear()
  for (const ws of websocketConnections.values()) ws.close()
  websocketConnections.clear()
}
