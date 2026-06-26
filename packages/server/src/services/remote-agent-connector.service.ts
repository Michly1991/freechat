import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'
import { config } from '../config.js'
import { billingService } from './billing.service.js'
import { platformHostedAgentRuntimeService } from './platform-hosted-agent-runtime.service.js'
import { messageService } from './message.service.js'
import { getGateway } from '../ws/gateway.js'

const ACCESS_EXPIRES_IN = '7d'
const PAIRING_TTL_MS = 10 * 60 * 1000
const CONNECTOR_ONLINE_TTL_MS = 45 * 1000
const DELIVERED_EVENT_REQUEUE_MS = 2 * 60 * 1000

export type ConnectorAuth = {
  connectorId: string
  agentId: string
  ownerId: string
  tokenId: string
}

type EventSubscriber = {
  auth: ConnectorAuth
  send: (event: any) => void
}

type EnqueueContext = {
  actorUserId?: string
  runSource?: string
  taskId?: string
  subtaskId?: string
  parentRunId?: string
  resumeAttempt?: number
  responseMode?: 'final_to_chat' | 'tool_only' | 'silent'
  metadata?: Record<string, any>
}

type ControlEventInput = {
  roomId: string
  agentId: string
  type: string
  payload: Record<string, any>
}

function compactCode(raw: string): string {
  return String(raw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

function randomPairingCode(): string {
  const raw = crypto.randomBytes(5).toString('hex').toUpperCase()
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 10)}`
}

function tokenPrefix(token: string): string {
  return `${token.slice(0, 12)}…${token.slice(-6)}`
}

export class RemoteAgentConnectorService {
  private subscribers = new Map<string, Set<EventSubscriber>>()

  async createPairingCode(agentId: string, ownerId: string) {
    const agent = db.prepare('SELECT id, owner_id, deployment FROM agents WHERE id = ?').get(agentId) as any
    if (!agent) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
    if (agent.owner_id !== ownerId) throw { code: 'FORBIDDEN', message: 'Only owner can create connector pairing code' }
    const code = randomPairingCode()
    const id = `apair_${uuidv4()}`
    const now = Date.now()
    db.prepare(`
      INSERT INTO agent_connector_pairing_codes (id, agent_id, owner_id, code_hash, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, agentId, ownerId, await bcrypt.hash(compactCode(code), 10), now + PAIRING_TTL_MS, now)
    return { id, code, expiresAt: now + PAIRING_TTL_MS }
  }


  ensurePlatformHostedConnector(agentId: string, ownerId: string) {
    const now = Date.now()
    const existing = db.prepare("SELECT id FROM agent_connectors WHERE agent_id = ? AND instance_id = ? AND status != 'revoked' ORDER BY created_at ASC LIMIT 1").get(agentId, 'platform-hosted') as any
    if (existing?.id) {
      db.prepare("UPDATE agent_connectors SET status = 'online', last_seen_at = ?, capabilities_json = ? WHERE id = ?").run(now, JSON.stringify({ platformHosted: true }), existing.id)
      const token = db.prepare("SELECT id FROM agent_connector_tokens WHERE connector_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").get(existing.id) as any
      if (token?.id) return { connectorId: existing.id, tokenId: token.id }
      const tokenId = `actok_${uuidv4()}`
      const rawToken = `fcconn_${crypto.randomBytes(36).toString('base64url')}`
      db.prepare("INSERT INTO agent_connector_tokens (id, connector_id, token_hash, token_prefix, status, last_used_at, created_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run(tokenId, existing.id, bcrypt.hashSync(rawToken, 10), tokenPrefix(rawToken), now, now)
      return { connectorId: existing.id, tokenId }
    }
    const connectorId = `aconn_${uuidv4()}`
    const tokenId = `actok_${uuidv4()}`
    const rawToken = `fcconn_${crypto.randomBytes(36).toString('base64url')}`
    db.prepare("INSERT INTO agent_connectors (id, agent_id, owner_id, instance_id, name, status, client_version, capabilities_json, last_seen_at, created_at) VALUES (?, ?, ?, 'platform-hosted', 'FreeChat 平台托管客户端', 'online', 'platform-hosted', ?, ?, ?)")
      .run(connectorId, agentId, ownerId, JSON.stringify({ platformHosted: true }), now, now)
    db.prepare("INSERT INTO agent_connector_tokens (id, connector_id, token_hash, token_prefix, status, last_used_at, created_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run(tokenId, connectorId, bcrypt.hashSync(rawToken, 10), tokenPrefix(rawToken), now, now)
    return { connectorId, tokenId }
  }

  getConnectorSummary(agentId: string) {
    const rows = db.prepare(`
      SELECT id, name, status, last_seen_at lastSeenAt, created_at createdAt
      FROM agent_connectors
      WHERE agent_id = ? AND status != 'revoked'
      ORDER BY COALESCE(last_seen_at, created_at) DESC
    `).all(agentId) as any[]
    const latest = rows[0]
    const fresh = latest?.lastSeenAt && Date.now() - Number(latest.lastSeenAt) <= CONNECTOR_ONLINE_TTL_MS
    const status = rows.length === 0 ? undefined : (fresh ? latest?.status : 'offline')
    return {
      managedByClient: rows.length > 0,
      clientConnectorCount: rows.length,
      clientConnectorId: latest?.id,
      clientConnectorName: latest?.name || undefined,
      clientConnectorStatus: status || undefined,
      clientLastSeenAt: latest?.lastSeenAt || undefined,
    }
  }

  listConnectors(agentId: string, ownerId: string) {
    const agent = db.prepare('SELECT owner_id FROM agents WHERE id = ?').get(agentId) as any
    if (!agent) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
    if (agent.owner_id !== ownerId) throw { code: 'FORBIDDEN', message: 'Only owner can list connectors' }
    return db.prepare(`
      SELECT id, agent_id agentId, instance_id instanceId, name, status, client_version clientVersion,
        capabilities_json capabilitiesJson, last_seen_at lastSeenAt, created_at createdAt, revoked_at revokedAt
      FROM agent_connectors
      WHERE agent_id = ?
      ORDER BY created_at DESC
    `).all(agentId)
  }

  revokeConnector(agentId: string, ownerId: string, connectorId: string) {
    const connector = db.prepare('SELECT id, agent_id, owner_id FROM agent_connectors WHERE id = ? AND agent_id = ?').get(connectorId, agentId) as any
    if (!connector) throw { code: 'CONNECTOR_NOT_FOUND', message: 'Connector not found' }
    if (connector.owner_id !== ownerId) throw { code: 'FORBIDDEN', message: 'Only owner can revoke connector' }
    const now = Date.now()
    db.prepare("UPDATE agent_connectors SET status = 'revoked', revoked_at = ?, last_seen_at = ? WHERE id = ?").run(now, now, connectorId)
    db.prepare("UPDATE agent_connector_tokens SET status = 'revoked' WHERE connector_id = ?").run(connectorId)
  }


  private migrateRoomsToManagedAgent(agentId: string) {
    const agent = db.prepare('SELECT id, owner_id, name, role_type FROM agents WHERE id = ?').get(agentId) as any
    if (!agent) return { migrated: 0, removedDuplicates: 0 }
    const siblings = db.prepare(`
      SELECT id
      FROM agents
      WHERE owner_id = ? AND name = ? AND role_type = ? AND id != ?
    `).all(agent.owner_id, agent.name, agent.role_type, agent.id) as any[]
    let migrated = 0
    let removedDuplicates = 0
    for (const sibling of siblings) {
      const roomRows = db.prepare('SELECT room_id FROM room_agents WHERE agent_id = ?').all(sibling.id) as any[]
      for (const row of roomRows) {
        const exists = db.prepare('SELECT 1 FROM room_agents WHERE room_id = ? AND agent_id = ?').get(row.room_id, agent.id) as any
        if (exists) {
          db.prepare('DELETE FROM room_agents WHERE room_id = ? AND agent_id = ?').run(row.room_id, sibling.id)
          db.prepare('DELETE FROM room_agent_model_bindings WHERE room_id = ? AND agent_id = ?').run(row.room_id, sibling.id)
          removedDuplicates += 1
        } else {
          db.prepare('UPDATE room_agents SET agent_id = ? WHERE room_id = ? AND agent_id = ?').run(agent.id, row.room_id, sibling.id)
          const bindingExists = db.prepare('SELECT 1 FROM room_agent_model_bindings WHERE room_id = ? AND agent_id = ?').get(row.room_id, agent.id) as any
          if (bindingExists) db.prepare('DELETE FROM room_agent_model_bindings WHERE room_id = ? AND agent_id = ?').run(row.room_id, sibling.id)
          else db.prepare('UPDATE room_agent_model_bindings SET agent_id = ? WHERE room_id = ? AND agent_id = ?').run(agent.id, row.room_id, sibling.id)
          migrated += 1
        }
      }
    }
    return { migrated, removedDuplicates }
  }

  async register(input: { pairingCode: string; instanceId?: string; name?: string; clientVersion?: string; capabilities?: any }) {
    const code = compactCode(input.pairingCode)
    if (!code) throw { code: 'VALIDATION_ERROR', message: 'pairingCode is required' }
    const now = Date.now()
    const rows = db.prepare("SELECT * FROM agent_connector_pairing_codes WHERE status = 'pending' AND expires_at > ? ORDER BY created_at DESC").all(now) as any[]
    let matched: any | null = null
    for (const row of rows) {
      if (await bcrypt.compare(code, row.code_hash)) { matched = row; break }
    }
    if (!matched) throw { code: 'PAIRING_CODE_INVALID', message: 'Pairing code is invalid or expired' }

    const connectorId = `aconn_${uuidv4()}`
    const tokenId = `actok_${uuidv4()}`
    const rawToken = `fcconn_${crypto.randomBytes(36).toString('base64url')}`
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO agent_connectors (id, agent_id, owner_id, instance_id, name, status, client_version, capabilities_json, last_seen_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'online', ?, ?, ?, ?)
      `).run(connectorId, matched.agent_id, matched.owner_id, input.instanceId || null, input.name || null, input.clientVersion || null, JSON.stringify(input.capabilities || {}), now, now)
      db.prepare(`
        INSERT INTO agent_connector_tokens (id, connector_id, token_hash, token_prefix, status, last_used_at, created_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?)
      `).run(tokenId, connectorId, bcrypt.hashSync(rawToken, 10), tokenPrefix(rawToken), now, now)
      db.prepare("UPDATE agent_connector_pairing_codes SET status = 'used', used_at = ? WHERE id = ?").run(now, matched.id)
      db.prepare("UPDATE agents SET deployment = 'client', status = 'active', updated_at = ? WHERE id = ?").run(now, matched.agent_id)
    })
    tx()
    return {
      agentId: matched.agent_id,
      connectorId,
      accessToken: this.signAccessToken({ connectorId, agentId: matched.agent_id, ownerId: matched.owner_id, tokenId }),
      connectorToken: rawToken,
      expiresIn: ACCESS_EXPIRES_IN,
    }
  }

  async authenticateBearer(authHeader?: string): Promise<ConnectorAuth | null> {
    const token = (authHeader || '').startsWith('Bearer ') ? authHeader!.slice(7) : ''
    return this.authenticateCredential(token)
  }

  async authenticateCredential(token: string): Promise<ConnectorAuth | null> {
    if (!token) return null
    const jwtAuth = this.verifyAccessToken(token)
    if (jwtAuth) return jwtAuth
    if (!token.startsWith('fcconn_')) return null
    const rows = db.prepare(`
      SELECT t.*, c.agent_id, c.owner_id, c.status connector_status
      FROM agent_connector_tokens t
      INNER JOIN agent_connectors c ON c.id = t.connector_id
      WHERE t.status = 'active' AND c.status != 'revoked'
    `).all() as any[]
    for (const row of rows) {
      if (await bcrypt.compare(token, row.token_hash)) {
        const now = Date.now()
        db.prepare('UPDATE agent_connector_tokens SET last_used_at = ? WHERE id = ?').run(now, row.id)
        db.prepare("UPDATE agent_connectors SET status = CASE WHEN status = 'working' THEN status ELSE 'online' END, last_seen_at = ? WHERE id = ?").run(now, row.connector_id)
        return { connectorId: row.connector_id, agentId: row.agent_id, ownerId: row.owner_id, tokenId: row.id }
      }
    }
    return null
  }

  heartbeat(auth: ConnectorAuth, metadata: any = {}) {
    const now = Date.now()
    db.prepare("UPDATE agent_connectors SET status = 'online', capabilities_json = COALESCE(?, capabilities_json), last_seen_at = ? WHERE id = ? AND status != 'revoked'")
      .run(metadata.capabilities ? JSON.stringify(metadata.capabilities) : null, now, auth.connectorId)
    db.prepare('UPDATE agent_connector_tokens SET last_used_at = ? WHERE id = ?').run(now, auth.tokenId)
    this.requeueStaleDeliveredEvents(auth.agentId)
    this.pushPendingEvents(auth.agentId)
    return { ok: true, now }
  }

  enqueueControlEvent(input: ControlEventInput) {
    const now = Date.now()
    const runId = `ctrl_${uuidv4()}`
    const eventId = `raevt_${uuidv4()}`
    db.prepare(`
      INSERT INTO agent_runs (id, room_id, agent_id, status, input, actor_user_id, payer_user_id, run_source, runtime, started_at)
      VALUES (?, ?, ?, 'running', ?, ?, ?, ?, 'remote-control', ?)
    `).run(runId, input.roomId, input.agentId, JSON.stringify(input.payload || {}), input.payload?.actorUserId || null, input.payload?.actorUserId || null, input.type, now)
    db.prepare(`
      INSERT INTO remote_agent_events (id, run_id, room_id, agent_id, type, payload_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(eventId, runId, input.roomId, input.agentId, input.type, JSON.stringify({ ...input.payload, runId, roomId: input.roomId, agentId: input.agentId }), now)
    this.pushPendingEvents(input.agentId)
    return { runId, eventId }
  }

  enqueueRun(roomId: string, agentId: string, input: string, context: EnqueueContext = {}) {
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any
    if (!agent) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
    const room = db.prepare('SELECT created_by, room_kind, workgroup_entry_id FROM rooms WHERE id = ?').get(roomId) as any
    const preflight = billingService.checkRoomAgentInvocation(roomId, agentId, context.actorUserId)
    if (!preflight.allowed) {
      const isSharedEntry = room?.room_kind === 'entry' || !!room?.workgroup_entry_id
      throw {
        code: 'INSUFFICIENT_CREDITS',
        message: isSharedEntry
          ? `余额不足，无法使用分享入口 Agent。本次会话模型费用由你承担，请先充值 credit 后再继续。`
          : `余额不足，无法启动 Agent。预计模型费用至少需要 ${preflight.estimatedMinCredits} credit，当前余额 ${preflight.balance} credit。`,
        payerUserId: preflight.payerUserId,
        estimatedMinCredits: preflight.estimatedMinCredits,
        balance: preflight.balance,
      }
    }
    const payerUserId = context.actorUserId || room?.created_by || agent.owner_id || null
    const now = Date.now()
    const runId = `arun_${uuidv4()}`
    const eventId = `raevt_${uuidv4()}`
    const eventType = context.subtaskId ? 'task.assigned' : context.taskId ? 'task.assigned' : 'agent.mentioned'
    db.prepare(`
      INSERT INTO agent_runs (id, room_id, agent_id, status, input, actor_user_id, payer_user_id, run_source, task_id, subtask_id, parent_run_id, resume_attempt, runtime, started_at)
      VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, 'remote-claude-code', ?)
    `).run(runId, roomId, agentId, input, context.actorUserId || null, payerUserId, context.runSource || eventType, context.taskId || null, context.subtaskId || null, context.parentRunId || null, context.resumeAttempt || 0, now)
    db.prepare(`
      INSERT INTO remote_agent_events (id, run_id, room_id, agent_id, type, payload_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(eventId, runId, roomId, agentId, eventType, JSON.stringify({ runId, roomId, agentId, input, actorUserId: context.actorUserId, taskId: context.taskId, subtaskId: context.subtaskId, runSource: context.runSource || eventType, responseMode: context.responseMode, metadata: context.metadata }), now)
    db.prepare("UPDATE agents SET status = 'working', updated_at = ? WHERE id = ?").run(now, agentId)
    this.pushPendingEvents(agentId)
    if (platformHostedAgentRuntimeService.canHandle(agentId)) {
      const connector = db.prepare("SELECT id FROM agent_connectors WHERE agent_id = ? AND instance_id = ? AND status != 'revoked' ORDER BY created_at ASC LIMIT 1").get(agentId, 'platform-hosted') as any
      const token = connector ? db.prepare("SELECT id FROM agent_connector_tokens WHERE connector_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").get(connector.id) as any : null
      if (connector?.id && token?.id) void platformHostedAgentRuntimeService.processPending({ connectorId: connector.id, agentId, ownerId: agent.owner_id, tokenId: token.id }, this.complete.bind(this), this.fail.bind(this)).catch((err) => console.error('[platform-hosted-agent] process failed', err))
    }
    return { runId, eventId }
  }

  pollEvents(auth: ConnectorAuth, limit = 10, agentIds?: string[]) {
    const requested = Array.isArray(agentIds) ? agentIds.filter(Boolean) : []
    const allowed = requested.length > 0 ? this.allowedPollAgentIds(auth, requested) : [auth.agentId]
    if (allowed.length === 0) return []
    const placeholders = allowed.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT * FROM remote_agent_events
      WHERE agent_id IN (${placeholders}) AND status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `).all(...allowed, Math.max(1, Math.min(50, Number(limit) || 10))) as any[]
    const now = Date.now()
    const mark = db.prepare("UPDATE remote_agent_events SET status = 'delivered', delivered_at = ? WHERE id = ?")
    const events = rows.map((row) => {
      mark.run(now, row.id)
      return { id: row.id, runId: row.run_id, roomId: row.room_id, agentId: row.agent_id, type: row.type, payload: JSON.parse(row.payload_json || '{}'), createdAt: row.created_at }
    })
    return events
  }


  subscribe(auth: ConnectorAuth, send: (event: any) => void) {
    const sub: EventSubscriber = { auth, send }
    let set = this.subscribers.get(auth.agentId)
    if (!set) { set = new Set(); this.subscribers.set(auth.agentId, set) }
    set.add(sub)
    this.heartbeat(auth, { capabilities: { sse: true } })
    this.requeueStaleDeliveredEvents(auth.agentId)
    this.pushPendingEvents(auth.agentId)
    return () => {
      const current = this.subscribers.get(auth.agentId)
      current?.delete(sub)
      if (current && current.size === 0) this.subscribers.delete(auth.agentId)
    }
  }

  private pushPendingEvents(agentId: string) {
    const set = this.subscribers.get(agentId)
    if (!set || set.size === 0) return
    for (const sub of Array.from(set)) {
      try {
        const events = this.pollEvents(sub.auth, 10)
        for (const event of events) sub.send(event)
      } catch {
        set.delete(sub)
      }
    }
    if (set.size === 0) this.subscribers.delete(agentId)
  }

  activity(auth: ConnectorAuth, runId: string, text: string) {
    this.assertRunAuth(auth, runId)
    const now = Date.now()
    const current = db.prepare('SELECT output FROM agent_runs WHERE id = ?').get(runId) as any
    const notes = [current?.output, `[activity] ${text}`].filter(Boolean).join('\n')
    db.prepare('UPDATE agent_runs SET output = ? WHERE id = ?').run(notes, runId)
    db.prepare("UPDATE agent_connectors SET status = 'working', last_seen_at = ? WHERE id = ?").run(now, auth.connectorId)
    return { ok: true }
  }

  complete(auth: ConnectorAuth, runId: string, payload: any = {}) {
    const run = this.assertRunAuth(auth, runId)
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
    this.settleRemoteRun(runId)
    if ((run.run_source === 'agent.mentioned' || run.run_source === 'handoff') && payload.output && payload.responseMode !== 'tool_only' && payload.responseMode !== 'silent') {
      void messageService.createMessage(run.room_id, run.agent_id, (db.prepare('SELECT name FROM agents WHERE id = ?').get(run.agent_id) as any)?.name || 'Agent', 'ai', String(payload.output))
        .then((message) => getGateway()?.broadcast(run.room_id, { msgId: message.id, roomId: run.room_id, type: 'broadcast', action: 'chat.message', payload: message, timestamp: Date.now() }))
        .catch((err) => console.error('[remote-agent] create completion message failed', err))
    }
    return { ok: true }
  }

  fail(auth: ConnectorAuth, runId: string, error: string) {
    const run = this.assertRunAuth(auth, runId)
    const now = Date.now()
    const durationMs = Math.max(0, now - Number(run.started_at || now))
    db.prepare("UPDATE agent_runs SET status = 'failed', error = ?, runtime = 'remote-claude-code', duration_ms = ?, finished_at = ? WHERE id = ?")
      .run(error || 'Remote Agent failed', durationMs, now, runId)
    db.prepare("UPDATE remote_agent_events SET status = 'completed', completed_at = ? WHERE run_id = ?").run(now, runId)
    db.prepare("UPDATE agent_connectors SET status = 'online', last_seen_at = ? WHERE id = ?").run(now, auth.connectorId)
    db.prepare("UPDATE agents SET status = 'error', updated_at = ? WHERE id = ?").run(now, auth.agentId)
    return { ok: true }
  }

  private requeueStaleDeliveredEvents(agentId: string) {
    const cutoff = Date.now() - DELIVERED_EVENT_REQUEUE_MS
    db.prepare(`
      UPDATE remote_agent_events
      SET status = 'pending', delivered_at = NULL
      WHERE agent_id = ? AND status = 'delivered' AND COALESCE(delivered_at, created_at) < ?
        AND run_id IN (SELECT id FROM agent_runs WHERE status = 'running')
    `).run(agentId, cutoff)
  }

  private allowedPollAgentIds(auth: ConnectorAuth, requested: string[]) {
    if (requested.includes(auth.agentId)) return [auth.agentId]
    return []
  }

  private signAccessToken(auth: ConnectorAuth) {
    return jwt.sign({ ...auth, kind: 'agent_connector' }, config.jwtSecret, { expiresIn: ACCESS_EXPIRES_IN })
  }

  private verifyAccessToken(token: string): ConnectorAuth | null {
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as any
      if (decoded?.kind !== 'agent_connector') return null
      const connector = db.prepare('SELECT status FROM agent_connectors WHERE id = ?').get(decoded.connectorId) as any
      if (!connector || connector.status === 'revoked') return null
      return { connectorId: decoded.connectorId, agentId: decoded.agentId, ownerId: decoded.ownerId, tokenId: decoded.tokenId }
    } catch { return null }
  }

  private assertRunAuth(auth: ConnectorAuth, runId: string) {
    const run = db.prepare('SELECT * FROM agent_runs WHERE id = ? AND agent_id = ?').get(runId, auth.agentId) as any
    if (!run) throw { code: 'RUN_NOT_FOUND', message: 'Run not found for this connector' }
    return run
  }

  private settleRemoteRun(runId: string) {
    billingService.billRun(runId)
  }
}

export const remoteAgentConnectorService = new RemoteAgentConnectorService()
