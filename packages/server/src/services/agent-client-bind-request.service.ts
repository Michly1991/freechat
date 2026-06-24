import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'

export type BindRequestStatus = 'pending' | 'claimed' | 'failed' | 'cancelled'

function now() { return Date.now() }

function publicRow(row: any) {
  if (!row) return null
  return {
    id: row.id,
    agentId: row.agent_id,
    ownerId: row.owner_id,
    status: row.status,
    preferredInstanceId: row.preferred_instance_id,
    claimedConnectorId: row.claimed_connector_id,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimedAt: row.claimed_at,
    agentName: row.agent_name,
    agentDescription: row.agent_description,
  }
}

export class AgentClientBindRequestService {
  create(agentId: string, ownerId: string, preferredInstanceId?: string) {
    const agent = db.prepare('SELECT id, owner_id, name, deployment FROM agents WHERE id = ?').get(agentId) as any
    if (!agent) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
    if (agent.owner_id !== ownerId) throw { code: 'FORBIDDEN', message: 'Only owner can request Agent client binding' }

    const connector = db.prepare("SELECT id FROM agent_connectors WHERE agent_id = ? AND status != 'revoked' LIMIT 1").get(agentId) as any
    if (connector) return this.markClaimedByConnector(agentId, ownerId, connector.id)

    const existing = db.prepare("SELECT * FROM agent_client_bind_requests WHERE agent_id = ? AND owner_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").get(agentId, ownerId) as any
    if (existing) return publicRow(existing)

    const ts = now()
    const id = `acbr_${uuidv4()}`
    db.prepare(`
      INSERT INTO agent_client_bind_requests (id, agent_id, owner_id, status, preferred_instance_id, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?, ?)
    `).run(id, agentId, ownerId, preferredInstanceId || null, ts, ts)
    db.prepare("UPDATE agents SET deployment = 'client', status = 'active', updated_at = ? WHERE id = ?").run(ts, agentId)
    return publicRow(db.prepare('SELECT * FROM agent_client_bind_requests WHERE id = ?').get(id))
  }

  autoEnsureForListedClientAgent(agentId: string, ownerId: string) {
    const agent = db.prepare('SELECT id, deployment, market_listed FROM agents WHERE id = ? AND owner_id = ?').get(agentId, ownerId) as any
    if (!agent || agent.deployment !== 'client' || !agent.market_listed) return null
    const summary = this.summary(agentId)
    if (summary.managedByClient) return null
    return this.create(agentId, ownerId)
  }

  listPendingForOwner(ownerId: string, instanceId?: string) {
    const rows = db.prepare(`
      SELECT r.*, a.name agent_name, a.description agent_description
      FROM agent_client_bind_requests r
      JOIN agents a ON a.id = r.agent_id
      WHERE r.owner_id = ? AND r.status = 'pending'
        AND (r.preferred_instance_id IS NULL OR r.preferred_instance_id = ?)
        AND NOT EXISTS (SELECT 1 FROM agent_connectors c WHERE c.agent_id = r.agent_id AND c.status != 'revoked')
      ORDER BY r.created_at ASC
      LIMIT 50
    `).all(ownerId, instanceId || '') as any[]
    return rows.map(publicRow)
  }

  complete(requestId: string, ownerId: string, connectorId: string) {
    const row = this.getOwned(requestId, ownerId)
    const connector = db.prepare('SELECT id, agent_id, owner_id FROM agent_connectors WHERE id = ?').get(connectorId) as any
    if (!connector || connector.owner_id !== ownerId || connector.agent_id !== row.agent_id) throw { code: 'CONNECTOR_NOT_FOUND', message: 'Connector not found for bind request' }
    const ts = now()
    db.prepare("UPDATE agent_client_bind_requests SET status = 'claimed', claimed_connector_id = ?, claimed_at = ?, updated_at = ?, error = NULL WHERE id = ?")
      .run(connectorId, ts, ts, requestId)
    return publicRow(db.prepare('SELECT * FROM agent_client_bind_requests WHERE id = ?').get(requestId))
  }

  fail(requestId: string, ownerId: string, error: string) {
    this.getOwned(requestId, ownerId)
    const ts = now()
    db.prepare("UPDATE agent_client_bind_requests SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(error || 'bind failed', ts, requestId)
    return publicRow(db.prepare('SELECT * FROM agent_client_bind_requests WHERE id = ?').get(requestId))
  }

  summary(agentId: string) {
    const pending = db.prepare("SELECT id, status, error, created_at createdAt, updated_at updatedAt FROM agent_client_bind_requests WHERE agent_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").get(agentId) as any
    const connector = db.prepare("SELECT id FROM agent_connectors WHERE agent_id = ? AND status != 'revoked' LIMIT 1").get(agentId) as any
    return { clientBindPending: !!pending, clientBindRequest: pending || undefined, managedByClient: !!connector }
  }

  private getOwned(requestId: string, ownerId: string) {
    const row = db.prepare('SELECT * FROM agent_client_bind_requests WHERE id = ?').get(requestId) as any
    if (!row) throw { code: 'BIND_REQUEST_NOT_FOUND', message: 'Bind request not found' }
    if (row.owner_id !== ownerId) throw { code: 'FORBIDDEN', message: 'Only owner can update bind request' }
    return row
  }

  private markClaimedByConnector(agentId: string, ownerId: string, connectorId: string) {
    const existing = db.prepare("SELECT * FROM agent_client_bind_requests WHERE agent_id = ? AND owner_id = ? AND status = 'claimed' ORDER BY updated_at DESC LIMIT 1").get(agentId, ownerId) as any
    if (existing) return publicRow(existing)
    const ts = now()
    const id = `acbr_${uuidv4()}`
    db.prepare(`
      INSERT INTO agent_client_bind_requests (id, agent_id, owner_id, status, claimed_connector_id, claimed_at, created_at, updated_at)
      VALUES (?, ?, ?, 'claimed', ?, ?, ?, ?)
    `).run(id, agentId, ownerId, connectorId, ts, ts, ts)
    return publicRow(db.prepare('SELECT * FROM agent_client_bind_requests WHERE id = ?').get(id))
  }
}

export const agentClientBindRequestService = new AgentClientBindRequestService()
