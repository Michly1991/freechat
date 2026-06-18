import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'

export const SYSTEM_ADMIN_USER_ID = 'user_freechat_admin'

export class SystemAdminService {
  ensureSystemAdmin(): void {
    const now = Date.now()
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(SYSTEM_ADMIN_USER_ID)
    if (!existing) {
      db.prepare(`
        INSERT INTO users (id, username, password_hash, nickname, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'admin', ?, ?)
      `).run(SYSTEM_ADMIN_USER_ID, 'freechat_admin', bcrypt.hashSync(`freechat-admin-${uuidv4()}`, 10), 'FreeChat 管理员', now, now)
    }
    db.prepare(`
      UPDATE agents
      SET owner_id = ?, updated_at = ?
      WHERE config LIKE '%"defaultRoomAssistant":true%'
         OR config LIKE '%"builtInKey":"default_assistant"%'
    `).run(SYSTEM_ADMIN_USER_ID, now)
  }
}

export const systemAdminService = new SystemAdminService()
