import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'

export type AuditAction =
  | 'user.login'
  | 'user.register'
  | 'user.logout'
  | 'agent.create'
  | 'agent.update'
  | 'agent.delete'
  | 'agent.publish'
  | 'agent.unpublish'
  | 'room.create'
  | 'room.delete'
  | 'room.invite'
  | 'room.member_add'
  | 'room.member_remove'
  | 'billing.topup'
  | 'billing.charge'
  | 'billing.refund'
  | 'file.upload'
  | 'file.delete'
  | 'scene.create'
  | 'scene.update'
  | 'scene.delete'
  | 'scene.purchase'
  | 'model.add'
  | 'model.update'
  | 'model.delete'
  | 'workgroup.create'
  | 'workgroup.update'
  | 'workgroup.member_add'
  | 'workgroup.member_remove'

export interface AuditLog {
  id: string
  userId: string
  username?: string
  action: AuditAction | string
  targetType?: string
  targetId?: string
  targetName?: string
  ip?: string
  userAgent?: string
  metadata?: Record<string, any>
  createdAt: number
}

export function ensureAuditSchema(_db?: any) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      target_name TEXT,
      ip TEXT,
      user_agent TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    )
  `)

  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id)`)
}

export class AuditLogService {
  log(opts: {
    userId: string
    username?: string
    action: AuditAction | string
    targetType?: string
    targetId?: string
    targetName?: string
    ip?: string
    userAgent?: string
    metadata?: Record<string, any>
  }) {
    const id = `audit_${uuidv4()}`
    const now = Date.now()
    db.prepare(`
      INSERT INTO audit_logs (id, user_id, username, action, target_type, target_id, target_name, ip, user_agent, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      opts.userId,
      opts.username || null,
      opts.action,
      opts.targetType || null,
      opts.targetId || null,
      opts.targetName || null,
      opts.ip || null,
      opts.userAgent || null,
      opts.metadata ? JSON.stringify(opts.metadata) : null,
      now
    )
    return id
  }

  list(opts: {
    userId?: string
    action?: string
    targetType?: string
    targetId?: string
    limit?: number
    offset?: number
  } = {}) {
    const limit = opts.limit || 50
    const offset = opts.offset || 0
    const params: any[] = []
    const wheres: string[] = []

    if (opts.userId) {
      wheres.push('user_id = ?')
      params.push(opts.userId)
    }
    if (opts.action) {
      wheres.push('action = ?')
      params.push(opts.action)
    }
    if (opts.targetType) {
      wheres.push('target_type = ?')
      params.push(opts.targetType)
    }
    if (opts.targetId) {
      wheres.push('target_id = ?')
      params.push(opts.targetId)
    }

    const whereClause = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : ''

    const rows = db.prepare(`
      SELECT * FROM audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `).all(...params) as any[]

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      username: row.username,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      targetName: row.target_name,
      ip: row.ip,
      userAgent: row.user_agent,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.created_at,
    }))
  }

  count(opts: { userId?: string; action?: string; targetType?: string; targetId?: string } = {}) {
    const params: any[] = []
    const wheres: string[] = []

    if (opts.userId) {
      wheres.push('user_id = ?')
      params.push(opts.userId)
    }
    if (opts.action) {
      wheres.push('action = ?')
      params.push(opts.action)
    }
    if (opts.targetType) {
      wheres.push('target_type = ?')
      params.push(opts.targetType)
    }
    if (opts.targetId) {
      wheres.push('target_id = ?')
      params.push(opts.targetId)
    }

    const whereClause = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : ''
    const row = db.prepare(`SELECT COUNT(*) as count FROM audit_logs ${whereClause}`).get(...params) as any
    return row?.count || 0
  }

  deleteOldest(before: number) {
    db.prepare('DELETE FROM audit_logs WHERE created_at < ?').run(before)
  }
}

export const auditLogService = new AuditLogService()
