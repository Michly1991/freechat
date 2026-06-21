import bcrypt from 'bcryptjs'
import db from '../storage/db.js'

export const SYSTEM_ADMIN_USER_ID = 'user_freechat_admin'

export class SystemAdminService {
  ensureSystemAdmin(): void {
    const now = Date.now()
    const passwordHash = bcrypt.hashSync('1234', 10)
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(SYSTEM_ADMIN_USER_ID)
    if (!existing) {
      db.prepare(`
        INSERT INTO users (id, username, password_hash, nickname, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'admin', ?, ?)
      `).run(SYSTEM_ADMIN_USER_ID, 'freechat_admin', passwordHash, 'FreeChat 管理员', now, now)
    } else {
      db.prepare("UPDATE users SET password_hash = ?, role = 'admin', updated_at = ? WHERE id = ?").run(passwordHash, now, SYSTEM_ADMIN_USER_ID)
    }
    db.prepare(`UPDATE agents SET deployment = 'client', updated_at = ? WHERE deployment != 'client'`).run(now)
    db.prepare(`
      UPDATE agents
      SET owner_id = ?, deployment = 'client', updated_at = ?
      WHERE config LIKE '%"defaultRoomAssistant":true%'
         OR config LIKE '%"builtInKey":"default_assistant"%'
    `).run(SYSTEM_ADMIN_USER_ID, now)
    this.ensureTabToolPermission(now)
  }

  private ensureTabToolPermission(now: number): void {
    const rows = db.prepare('SELECT id, config FROM agents').all() as any[]
    const update = db.prepare('UPDATE agents SET config = ?, updated_at = ? WHERE id = ?')
    for (const row of rows) {
      let cfg: any = {}
      try { cfg = row.config ? JSON.parse(row.config) : {} } catch { cfg = {} }
      cfg.tools = { chat: true, task: true, file: true, interaction: true, members: true, ...(cfg.tools || {}), tab: true }
      update.run(JSON.stringify(cfg), now, row.id)
    }
  }
}

export const systemAdminService = new SystemAdminService()
