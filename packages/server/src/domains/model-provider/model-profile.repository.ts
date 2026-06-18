import { v4 as uuidv4 } from 'uuid'
import db from '../../storage/db.js'

export class ModelProfileRepository {
  getUser(id: string) {
    return db.prepare('SELECT id FROM users WHERE id = ?').get(id) as any
  }

  createSystemUser(input: { id: string; username: string; passwordHash: string; nickname: string; role: string }): void {
    const now = Date.now()
    db.prepare(`
      INSERT INTO users (id, username, password_hash, nickname, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.username, input.passwordHash, input.nickname, input.role, now, now)
  }

  listVisible(userId: string, userRole?: string) {
    return db.prepare(`
      SELECT * FROM model_profiles
      WHERE enabled = 1 AND (owner_id = ? OR visibility IN ('shared', 'platform') OR ? = 'admin')
      ORDER BY CASE WHEN owner_id = ? THEN 0 ELSE 1 END, updated_at DESC
    `).all(userId, userRole || 'user', userId) as any[]
  }

  get(id: string) {
    return db.prepare('SELECT * FROM model_profiles WHERE id = ?').get(id) as any
  }

  create(ownerId: string, input: {
    name: string
    providerType: string
    baseUrl?: string | null
    apiKeyCipher?: string | null
    apiKeyLast4?: string | null
    defaultModel?: string | null
    models?: string | null
    visibility: string
  }) {
    const id = `mp_${uuidv4()}`
    const now = Date.now()
    db.prepare(`
      INSERT INTO model_profiles (id, owner_id, name, provider_type, base_url, api_key_cipher, api_key_last4, default_model, models, visibility, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, ownerId, input.name, input.providerType, input.baseUrl || null, input.apiKeyCipher || null, input.apiKeyLast4 || null, input.defaultModel || null, input.models || null, input.visibility, now, now)
    return this.get(id)
  }

  upsertPlatformProfile(input: {
    id: string
    ownerId: string
    name: string
    baseUrl?: string | null
    apiKeyCipher?: string | null
    apiKeyLast4?: string | null
    defaultModel?: string | null
    models?: string | null
  }) {
    const existing = this.get(input.id)
    const now = Date.now()
    if (existing) {
      db.prepare(`
        UPDATE model_profiles
        SET name = ?, provider_type = 'anthropic-compatible', base_url = ?,
            api_key_cipher = COALESCE(?, api_key_cipher), api_key_last4 = COALESCE(?, api_key_last4),
            default_model = ?, models = ?, visibility = 'platform', enabled = 1, updated_at = ?
        WHERE id = ?
      `).run(input.name, input.baseUrl || null, input.apiKeyCipher || null, input.apiKeyLast4 || null, input.defaultModel || null, input.models || null, now, input.id)
      return this.get(input.id)
    }
    db.prepare(`
      INSERT INTO model_profiles (id, owner_id, name, provider_type, base_url, api_key_cipher, api_key_last4, default_model, models, visibility, enabled, created_at, updated_at)
      VALUES (?, ?, ?, 'anthropic-compatible', ?, ?, ?, ?, ?, 'platform', 1, ?, ?)
    `).run(input.id, input.ownerId, input.name, input.baseUrl || null, input.apiKeyCipher || null, input.apiKeyLast4 || null, input.defaultModel || null, input.models || null, now, now)
    return this.get(input.id)
  }

  update(id: string, input: {
    name: string
    providerType: string
    baseUrl?: string | null
    apiKeyCipher?: string | null
    apiKeyLast4?: string | null
    defaultModel?: string | null
    models?: string | null
    visibility: string
    enabled: number
  }) {
    db.prepare(`
      UPDATE model_profiles
      SET name = ?, provider_type = ?, base_url = ?, api_key_cipher = COALESCE(?, api_key_cipher), api_key_last4 = COALESCE(?, api_key_last4),
          default_model = ?, models = ?, visibility = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(input.name, input.providerType, input.baseUrl || null, input.apiKeyCipher || null, input.apiKeyLast4 || null, input.defaultModel || null, input.models || null, input.visibility, input.enabled, Date.now(), id)
    return this.get(id)
  }
}

export const modelProfileRepository = new ModelProfileRepository()
