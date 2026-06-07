import db from '../storage/db.js'
import { hashPassword, verifyPassword, generateToken } from '../auth/jwt.js'
import { v4 as uuidv4 } from 'uuid'
import type { User, AuthResponse } from '@freechat/shared'

export class AuthService {
  async register(username: string, password: string, nickname: string): Promise<AuthResponse> {
    // Check if username exists
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
    if (existing) {
      throw { code: 'USERNAME_TAKEN', message: 'Username already exists' }
    }

    const id = `usr_${uuidv4()}`
    const passwordHash = await hashPassword(password)
    const now = Date.now()

    db.prepare(`
      INSERT INTO users (id, username, password_hash, nickname, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'user', ?, ?)
    `).run(id, username, passwordHash, nickname, now, now)

    const user: User = { id, username, nickname, role: 'user', createdAt: now }
    const token = generateToken(user)

    return { user, token }
  }

  async login(username: string, password: string): Promise<AuthResponse> {
    const row: any = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
    if (!row) {
      throw { code: 'INVALID_PASSWORD', message: 'Invalid username or password' }
    }

    const valid = await verifyPassword(password, row.password_hash)
    if (!valid) {
      throw { code: 'INVALID_PASSWORD', message: 'Invalid username or password' }
    }

    const user: User = {
      id: row.id,
      username: row.username,
      nickname: row.nickname,
      avatar: row.avatar,
      role: row.role,
      createdAt: row.created_at
    }
    const token = generateToken(user)

    return { user, token }
  }

  async getMe(userId: string): Promise<User> {
    const row: any = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!row) {
      throw { code: 'NOT_FOUND', message: 'User not found' }
    }

    return {
      id: row.id,
      username: row.username,
      nickname: row.nickname,
      avatar: row.avatar,
      role: row.role,
      createdAt: row.created_at
    }
  }

  async updateProfile(userId: string, nickname?: string, avatar?: string): Promise<User> {
    const updates: string[] = []
    const values: any[] = []

    if (nickname !== undefined) {
      updates.push('nickname = ?')
      values.push(nickname)
    }
    if (avatar !== undefined) {
      updates.push('avatar = ?')
      values.push(avatar)
    }

    if (updates.length === 0) {
      return this.getMe(userId)
    }

    updates.push('updated_at = ?')
    values.push(Date.now())
    values.push(userId)

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    return this.getMe(userId)
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const row: any = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId)
    if (!row) {
      throw { code: 'NOT_FOUND', message: 'User not found' }
    }

    const valid = await verifyPassword(oldPassword, row.password_hash)
    if (!valid) {
      throw { code: 'INVALID_PASSWORD', message: 'Current password is incorrect' }
    }

    const newHash = await hashPassword(newPassword)
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(newHash, Date.now(), userId)
  }
}

export const authService = new AuthService()
