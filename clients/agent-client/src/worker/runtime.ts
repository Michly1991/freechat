import type { AgentCredential, RemoteEvent, RuntimeState } from '../config/types.js'
import { connectEventWebSocket, heartbeat, pollEvents, runActivity, runComplete, runFail, streamEvents } from '../connector/api.js'
import { executeEvent } from '../executor/claude.js'
import { loadConfig, updateAgent } from '../config/store.js'

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

async function handleEvent(agent: AgentCredential, event: RemoteEvent) {
  if (seenEvents.has(event.id)) return
  seenEvents.add(event.id)
  if (seenEvents.size > 500) seenEvents.clear()
  const cfg = loadConfig()
  runtimeState.activeRuns[event.runId] = { runId: event.runId, agentId: agent.agentId, startedAt: Date.now(), type: event.type }
  updateAgent(agent.agentId, { status: 'running', lastSeenAt: Date.now(), lastError: undefined })
  try {
    await runActivity(cfg, agent, event.runId, `accepted by Agent Client ${cfg.clientName}`)
    const response = await executeEvent(cfg, agent, event)
    await runComplete(cfg, agent, event.runId, { summary: response.slice(0, 500), output: response })
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

async function tick() {
  const cfg = loadConfig()
  const enabledAgents = cfg.agents.filter((agent) => agent.enabled)
  reconcileStreams(enabledAgents)
  for (const agent of enabledAgents) {
    ensureStream(cfg, agent)
    if (activeCount() >= cfg.maxConcurrency || activeCount(agent.agentId) >= agent.maxConcurrency) continue
    try {
      await heartbeat(cfg, agent)
      updateAgent(agent.agentId, { status: activeCount(agent.agentId) > 0 ? 'running' : 'idle', lastSeenAt: Date.now() })
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
