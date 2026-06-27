import { hostname } from 'os'
import type { AgentCredential, ClientConfig, RemoteEvent } from '../config/types.js'

export const CLIENT_VERSION = '0.1.0'

export async function request<T>(serverUrl: string, path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(`${serverUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok || data?.success === false) {
    throw new Error(data?.error?.message || data?.message || `HTTP ${res.status}`)
  }
  return data.data ?? data
}

export async function pairAgent(cfg: ClientConfig, pairingCode: string, name?: string) {
  const data = await request<any>(cfg.serverUrl, '/api/remote-agents/register', {
    method: 'POST',
    body: JSON.stringify({
      pairingCode,
      instanceId: `${hostname()}-${process.pid}`,
      name: name || cfg.clientName,
      clientVersion: CLIENT_VERSION,
      capabilities: { runtime: 'claude-code', localClaudeCode: true, multiAgentClient: true, webConsole: true },
    }),
  })
  const now = Date.now()
  return {
    agentId: data.agentId,
    connectorId: data.connectorId,
    accessToken: data.accessToken,
    connectorToken: data.connectorToken,
    name: name || data.agentId,
    enabled: true,
    maxConcurrency: 1,
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  } as AgentCredential
}

function authToken(agent: AgentCredential) {
  // Connector JWTs are short-lived; the raw connector token is stored locally and
  // authenticated server-side against the active connector token hash. Prefer it
  // for long-running Agent Client services so existing bindings keep working
  // after the access JWT expires.
  return agent.connectorToken || agent.accessToken
}

export async function heartbeat(cfg: ClientConfig, agent: AgentCredential) {
  return request(cfg.serverUrl, '/api/remote-agents/heartbeat', {
    method: 'POST',
    body: JSON.stringify({
      capabilities: {
        runtime: 'claude-code',
        localClaudeCode: true,
        version: CLIENT_VERSION,
        multiAgentClient: true,
        clientName: cfg.clientName,
        agentCount: cfg.agents.length,
      },
    }),
  }, authToken(agent))
}

export async function pollEvents(cfg: ClientConfig, agent: AgentCredential): Promise<RemoteEvent[]> {
  const data = await request<{ events: RemoteEvent[] }>(cfg.serverUrl, '/api/remote-agents/events?limit=5', {}, authToken(agent))
  return data.events || []
}

export interface AgentKnowledgeFile {
  id: string
  name: string
  path: string
  mimeType?: string
  content: string
  size?: number
  checksum?: string
  updatedAt?: number
}

export interface AgentKnowledgePayload {
  agentId: string
  rootAgentId?: string
  files: AgentKnowledgeFile[]
  summary: any
}

export interface RuntimeSpec {
  version: string
  updatedAt: number
  checksum: string
  cliWrapper: string
  cliCjsTemplate: string
  claudeMd: string
  apiDoc: string
  runtimeRules: string
}

let runtimeSpecCache: { spec: RuntimeSpec; fetchedAt: number } | null = null
const RUNTIME_SPEC_TTL_MS = 10 * 60 * 1000

export async function getRuntimeSpec(cfg: ClientConfig, agent: AgentCredential): Promise<RuntimeSpec> {
  if (runtimeSpecCache && Date.now() - runtimeSpecCache.fetchedAt < RUNTIME_SPEC_TTL_MS) return runtimeSpecCache.spec
  const spec = await request<RuntimeSpec>(cfg.serverUrl, '/api/remote-agents/runtime-spec', {}, authToken(agent))
  runtimeSpecCache = { spec, fetchedAt: Date.now() }
  return spec
}

export async function getAgentKnowledge(cfg: ClientConfig, agent: AgentCredential): Promise<AgentKnowledgePayload> {
  return request<AgentKnowledgePayload>(cfg.serverUrl, '/api/remote-agents/knowledge', {}, authToken(agent))
}

export function agentTool(cfg: ClientConfig, agent: AgentCredential, roomId: string, action: string, args: any) {
  return request(cfg.serverUrl, `/api/agent-tools/${encodeURIComponent(roomId)}`, {
    method: 'POST',
    body: JSON.stringify({ action, args }),
  }, authToken(agent))
}

export function runActivity(cfg: ClientConfig, agent: AgentCredential, runId: string, text: string) {
  return request(cfg.serverUrl, `/api/remote-agents/runs/${encodeURIComponent(runId)}/activity`, {
    method: 'POST', body: JSON.stringify({ text }),
  }, authToken(agent))
}

export function runComplete(cfg: ClientConfig, agent: AgentCredential, runId: string, payload: any) {
  return request(cfg.serverUrl, `/api/remote-agents/runs/${encodeURIComponent(runId)}/complete`, {
    method: 'POST', body: JSON.stringify(payload),
  }, authToken(agent))
}

export function runFail(cfg: ClientConfig, agent: AgentCredential, runId: string, error: any) {
  return request(cfg.serverUrl, `/api/remote-agents/runs/${encodeURIComponent(runId)}/fail`, {
    method: 'POST', body: JSON.stringify({ error: error?.message || String(error) }),
  }, authToken(agent))
}


export async function streamEvents(cfg: ClientConfig, agent: AgentCredential, onEvent: (event: RemoteEvent) => void, signal: AbortSignal) {
  const res = await fetch(`${cfg.serverUrl}/api/remote-agents/events/stream`, {
    headers: { authorization: `Bearer ${authToken(agent)}` },
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`SSE failed: HTTP ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (!signal.aborted) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const eventLine = frame.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim()
      const dataLine = frame.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim()
      if (eventLine === 'remote-event' && dataLine) onEvent(JSON.parse(dataLine))
    }
  }
}


export function websocketUrl(serverUrl: string) {
  const url = new URL(serverUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/api/remote-agents/events/ws'
  url.search = ''
  return url.toString()
}

export function connectEventWebSocket(
  cfg: ClientConfig,
  agent: AgentCredential,
  onEvent: (event: RemoteEvent) => void,
  onClose?: (reason: string) => void,
): { close: () => void } {
  const WS = (globalThis as any).WebSocket
  if (!WS) throw new Error('WebSocket is not available in this Node runtime')
  const url = new URL(websocketUrl(cfg.serverUrl))
  url.searchParams.set('token', authToken(agent))
  const ws = new WS(url.toString())
  ws.onmessage = (message: any) => {
    const data = JSON.parse(String(message.data || '{}'))
    if (data.type === 'remote-event' && data.event) onEvent(data.event)
  }
  ws.onerror = () => {}
  ws.onclose = (event: any) => onClose?.(event?.reason || `closed ${event?.code || ''}`.trim())
  return { close: () => ws.close() }
}
