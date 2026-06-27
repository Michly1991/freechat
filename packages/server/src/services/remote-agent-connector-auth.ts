import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import db from '../storage/db.js'
import { config } from '../config.js'
import type { ConnectorAuth } from './remote-agent-connector.service.js'

export const ACCESS_EXPIRES_IN = '7d'

export function signConnectorAccessToken(auth: ConnectorAuth) {
  return jwt.sign({ ...auth, kind: 'agent_connector' }, config.jwtSecret, { expiresIn: ACCESS_EXPIRES_IN })
}

export function verifyConnectorAccessToken(token: string): ConnectorAuth | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any
    if (decoded?.kind !== 'agent_connector') return null
    const connector = db.prepare('SELECT status FROM agent_connectors WHERE id = ?').get(decoded.connectorId) as any
    if (!connector || connector.status === 'revoked') return null
    return { connectorId: decoded.connectorId, agentId: decoded.agentId, ownerId: decoded.ownerId, tokenId: decoded.tokenId }
  } catch {
    return null
  }
}

export async function authenticateConnectorCredential(token: string): Promise<ConnectorAuth | null> {
  if (!token) return null
  const jwtAuth = verifyConnectorAccessToken(token)
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
