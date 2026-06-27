import db from '../storage/db.js'
import { billingService } from './billing.service.js'
import { messageService } from './message.service.js'
import { getGateway } from '../ws/gateway.js'
import type { ConnectorAuth } from './remote-agent-connector.service.js'

export function assertRemoteRunAuth(auth: ConnectorAuth, runId: string) {
  const run = db.prepare('SELECT * FROM agent_runs WHERE id = ? AND agent_id = ?').get(runId, auth.agentId) as any
  if (!run) throw { code: 'RUN_NOT_FOUND', message: 'Run not found for this connector' }
  return run
}

export function completeRemoteRun(auth: ConnectorAuth, runId: string, payload: any = {}) {
  const run = assertRemoteRunAuth(auth, runId)
  const now = Date.now()
  const usage = payload.usage || {}
  const durationMs = Math.max(0, now - Number(run.started_at || now))
  const inputTokens = Number(usage.inputTokens || usage.input_tokens || usage.prompt_tokens || 0)
  const outputTokens = Number(usage.outputTokens || usage.output_tokens || usage.completion_tokens || 0)
  const cacheCreationInputTokens = Number(usage.cacheCreationInputTokens || usage.cache_creation_input_tokens || 0)
  const cacheReadInputTokens = Number(usage.cacheReadInputTokens || usage.cache_read_input_tokens || 0)
  const totalTokens = Number(usage.totalTokens || usage.total_tokens || (inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens) || 0)
  db.prepare(`
    UPDATE agent_runs
    SET status = 'succeeded', output = ?, error = NULL, runtime = ?, model = ?, duration_ms = ?,
      input_tokens = ?, output_tokens = ?, cache_creation_input_tokens = ?, cache_read_input_tokens = ?, total_tokens = ?,
      usage_source = ?, usage_trust_level = ?, usage_reported_by_connector_id = ?, usage_reported_at = ?, raw_usage_json = ?,
      finished_at = ?
    WHERE id = ?
  `).run(payload.output || payload.summary || '', usage.runtime || (usage.usageSource === 'server_metered' ? 'platform-hosted-client' : 'remote-claude-code'), usage.model || null, durationMs, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, totalTokens, usage.usageSource || usage.usage_source || 'client_reported', usage.trustLevel || usage.usage_trust_level || 'provider_reported', auth.connectorId, now, JSON.stringify(usage || {}), now, runId)
  db.prepare("UPDATE remote_agent_events SET status = 'completed', completed_at = ? WHERE run_id = ?").run(now, runId)
  db.prepare("UPDATE agent_connectors SET status = 'online', last_seen_at = ? WHERE id = ?").run(now, auth.connectorId)
  db.prepare("UPDATE agents SET status = 'active', updated_at = ? WHERE id = ?").run(now, auth.agentId)
  billingService.billRun(runId)
  if ((run.run_source === 'agent.mentioned' || run.run_source === 'handoff') && payload.output && payload.responseMode !== 'tool_only' && payload.responseMode !== 'silent') {
    void messageService.createMessage(run.room_id, run.agent_id, (db.prepare('SELECT name FROM agents WHERE id = ?').get(run.agent_id) as any)?.name || 'Agent', 'ai', String(payload.output))
      .then((message) => getGateway()?.broadcast(run.room_id, { msgId: message.id, roomId: run.room_id, type: 'broadcast', action: 'chat.message', payload: message, timestamp: Date.now() }))
      .catch((err) => console.error('[remote-agent] create completion message failed', err))
  }
  return { ok: true }
}

export function failRemoteRun(auth: ConnectorAuth, runId: string, error: string) {
  const run = assertRemoteRunAuth(auth, runId)
  const now = Date.now()
  const durationMs = Math.max(0, now - Number(run.started_at || now))
  db.prepare("UPDATE agent_runs SET status = 'failed', error = ?, runtime = 'remote-claude-code', duration_ms = ?, finished_at = ? WHERE id = ?")
    .run(error || 'Remote Agent failed', durationMs, now, runId)
  db.prepare("UPDATE remote_agent_events SET status = 'completed', completed_at = ? WHERE run_id = ?").run(now, runId)
  db.prepare("UPDATE agent_connectors SET status = 'online', last_seen_at = ? WHERE id = ?").run(now, auth.connectorId)
  db.prepare("UPDATE agents SET status = 'error', updated_at = ? WHERE id = ?").run(now, auth.agentId)
  return { ok: true }
}
