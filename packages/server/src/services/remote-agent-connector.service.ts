import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'
import { config } from '../config.js'
import { billingLedgerRepository } from '../domains/billing/billing-ledger.repository.js'
import { creditWalletService } from './credit-wallet.service.js'

const ACCESS_EXPIRES_IN = '7d'
const PAIRING_TTL_MS = 10 * 60 * 1000

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


  getConnectorSummary(agentId: string) {
    const rows = db.prepare(`
      SELECT id, name, status, last_seen_at lastSeenAt, created_at createdAt
      FROM agent_connectors
      WHERE agent_id = ? AND status != 'revoked'
      ORDER BY COALESCE(last_seen_at, created_at) DESC
    `).all(agentId) as any[]
    const latest = rows[0]
    return {
      managedByClient: rows.length > 0,
      clientConnectorCount: rows.length,
      clientConnectorId: latest?.id,
      clientConnectorName: latest?.name || undefined,
      clientConnectorStatus: latest?.status || undefined,
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
    return { ok: true, now }
  }

  enqueueRun(roomId: string, agentId: string, input: string, context: EnqueueContext = {}) {
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any
    if (!agent) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
    const room = db.prepare('SELECT created_by FROM rooms WHERE id = ?').get(roomId) as any
    const now = Date.now()
    const runId = `arun_${uuidv4()}`
    const eventId = `raevt_${uuidv4()}`
    const eventType = context.subtaskId ? 'task.assigned' : context.taskId ? 'task.assigned' : 'agent.mentioned'
    db.prepare(`
      INSERT INTO agent_runs (id, room_id, agent_id, status, input, actor_user_id, payer_user_id, run_source, task_id, subtask_id, parent_run_id, resume_attempt, runtime, started_at)
      VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, 'remote-claude-code', ?)
    `).run(runId, roomId, agentId, input, context.actorUserId || null, room?.created_by || context.actorUserId || agent.owner_id || null, context.runSource || eventType, context.taskId || null, context.subtaskId || null, context.parentRunId || null, context.resumeAttempt || 0, now)
    db.prepare(`
      INSERT INTO remote_agent_events (id, run_id, room_id, agent_id, type, payload_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(eventId, runId, roomId, agentId, eventType, JSON.stringify({ runId, roomId, agentId, input, taskId: context.taskId, subtaskId: context.subtaskId, runSource: context.runSource || eventType }), now)
    db.prepare("UPDATE agents SET status = 'working', updated_at = ? WHERE id = ?").run(now, agentId)
    this.pushPendingEvents(agentId)
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
    db.prepare(`
      UPDATE agent_runs
      SET status = 'succeeded', output = ?, error = NULL, runtime = 'remote-claude-code', model = ?, duration_ms = ?,
        input_tokens = ?, output_tokens = ?, cache_creation_input_tokens = ?, cache_read_input_tokens = ?, total_tokens = ?, finished_at = ?
      WHERE id = ?
    `).run(payload.output || payload.summary || '', usage.model || null, durationMs, usage.inputTokens || 0, usage.outputTokens || 0, usage.cacheCreationInputTokens || 0, usage.cacheReadInputTokens || 0, usage.totalTokens || ((usage.inputTokens || 0) + (usage.outputTokens || 0)), now, runId)
    db.prepare("UPDATE remote_agent_events SET status = 'completed', completed_at = ? WHERE run_id = ?").run(now, runId)
    db.prepare("UPDATE agent_connectors SET status = 'online', last_seen_at = ? WHERE id = ?").run(now, auth.connectorId)
    db.prepare("UPDATE agents SET status = 'active', updated_at = ? WHERE id = ?").run(now, auth.agentId)
    this.billRemoteRun(runId)
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

  private billRemoteRun(runId: string) {
    const run = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as any
    if (!run) return
    const agent = db.prepare('SELECT owner_id, source_template_id FROM agents WHERE id = ?').get(run.agent_id) as any
    const templateId = agent?.source_template_id || run.agent_id
    const rule = db.prepare('SELECT * FROM agent_billing_rules WHERE agent_template_id = ? AND enabled = 1 LIMIT 1').get(templateId) as any
    if (!rule || rule.billing_mode === 'free') return
    if (!['per_run_fixed', 'fixed_per_run'].includes(rule.billing_mode)) return
    const amount = Number(rule.fixed_credits_per_run || 0)
    if (!Number.isFinite(amount) || amount <= 0) return
    const payerUserId = run.payer_user_id
    const providerUserId = (db.prepare('SELECT owner_id FROM agents WHERE id = ?').get(templateId) as any)?.owner_id || agent?.owner_id
    if (!payerUserId || !providerUserId || payerUserId === providerUserId) return
    const event = { id: null, runId, roomId: run.room_id, agentId: run.agent_id, agentTemplateId: templateId, payerUserId, modelProfileId: null, model: null } as any
    const debit = billingLedgerRepository.createEntry(event, { accountUserId: payerUserId, accountRole: 'payer', direction: 'debit', entryType: 'agent_usage_charge', amount, ruleSnapshot: JSON.stringify({ agentRule: rule, remote: true }) })
    creditWalletService.apply(payerUserId, -amount, 'agent_usage_charge', { runId, ledgerId: debit.id, note: `Remote Agent service ${runId}` })
    const credit = billingLedgerRepository.createEntry(event, { accountUserId: providerUserId, accountRole: 'agent_provider', direction: 'credit', entryType: 'agent_income', amount, ruleSnapshot: JSON.stringify({ agentRule: rule, remote: true }) })
    creditWalletService.apply(providerUserId, amount, 'agent_income', { runId, ledgerId: credit.id, note: `Remote Agent service ${templateId}` })
  }
}

export const remoteAgentConnectorService = new RemoteAgentConnectorService()
