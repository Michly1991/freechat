import crypto from 'crypto'
import db from '../../storage/db.js'
import { decryptSecret, encryptSecret } from '../secret-crypto.js'
import type { VoiceProviderConfig, VoiceProviderConfigPublic } from './types.js'

function parseJson(value?: string | null) { try { return value ? JSON.parse(value) : {} } catch { return {} } }
function rowToConfig(row: any): VoiceProviderConfig {
  return { id: row.id, userId: row.user_id, provider: row.provider, name: row.name, asrEnabled: !!row.asr_enabled, ttsEnabled: !!row.tts_enabled, isDefaultAsr: !!row.is_default_asr, isDefaultTts: !!row.is_default_tts, credential: parseJson(decryptSecret(row.credential_json_cipher)), config: parseJson(row.config_json), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }
}
function toPublic(config: VoiceProviderConfig): VoiceProviderConfigPublic { const { credential, ...rest } = config; return { ...rest, credentialStatus: Object.keys(credential || {}).length ? 'configured' : 'missing' } }

export class VoiceConfigService {
  list(userId: string) { return (db.prepare('SELECT * FROM user_voice_provider_configs WHERE user_id = ? AND status != ? ORDER BY created_at DESC').all(userId, 'deleted') as any[]).map((row) => toPublic(rowToConfig(row))) }
  get(userId: string, id: string) { const row = db.prepare('SELECT * FROM user_voice_provider_configs WHERE id = ? AND user_id = ? AND status != ?').get(id, userId, 'deleted') as any; if (!row) throw { code: 'VOICE_CONFIG_NOT_FOUND', message: '语音服务配置不存在' }; return rowToConfig(row) }
  getDefault(userId: string, capability: 'asr' | 'tts') {
    const flag = capability === 'asr' ? 'is_default_asr' : 'is_default_tts', enabled = capability === 'asr' ? 'asr_enabled' : 'tts_enabled'
    const row = db.prepare(`SELECT * FROM user_voice_provider_configs WHERE user_id = ? AND status = 'active' AND ${enabled} = 1 ORDER BY ${flag} DESC, updated_at DESC LIMIT 1`).get(userId) as any
    if (!row) throw { code: 'VOICE_PROVIDER_NOT_CONFIGURED', message: capability === 'asr' ? '请先配置语音识别服务 Key' : '请先配置语音合成服务 Key' }
    return rowToConfig(row)
  }
  create(userId: string, input: any) {
    const now = Date.now(), id = `voice_cfg_${crypto.randomUUID()}`, provider = String(input.provider || 'volcengine')
    const asrEnabled = input.asrEnabled !== false, ttsEnabled = input.ttsEnabled !== false, isDefaultAsr = input.isDefaultAsr !== false, isDefaultTts = input.isDefaultTts !== false
    db.transaction(() => {
      if (isDefaultAsr) db.prepare('UPDATE user_voice_provider_configs SET is_default_asr = 0 WHERE user_id = ?').run(userId)
      if (isDefaultTts) db.prepare('UPDATE user_voice_provider_configs SET is_default_tts = 0 WHERE user_id = ?').run(userId)
      db.prepare('INSERT INTO user_voice_provider_configs (id,user_id,provider,name,asr_enabled,tts_enabled,is_default_asr,is_default_tts,credential_json_cipher,config_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, userId, provider, String(input.name || '我的语音服务'), asrEnabled ? 1 : 0, ttsEnabled ? 1 : 0, isDefaultAsr ? 1 : 0, isDefaultTts ? 1 : 0, encryptSecret(JSON.stringify(input.credential || {})), JSON.stringify(input.config || {}), 'active', now, now)
    })()
    return toPublic(this.get(userId, id))
  }
  update(userId: string, id: string, input: any) {
    this.get(userId, id)
    const fields: string[] = [], values: any[] = [], add = (sql: string, value: any) => { fields.push(sql); values.push(value) }
    if (input.name !== undefined) add('name = ?', String(input.name || '我的语音服务'))
    if (input.asrEnabled !== undefined) add('asr_enabled = ?', input.asrEnabled ? 1 : 0)
    if (input.ttsEnabled !== undefined) add('tts_enabled = ?', input.ttsEnabled ? 1 : 0)
    if (input.credential !== undefined) add('credential_json_cipher = ?', encryptSecret(JSON.stringify(input.credential || {})))
    if (input.config !== undefined) add('config_json = ?', JSON.stringify(input.config || {}))
    if (input.isDefaultAsr === true) db.prepare('UPDATE user_voice_provider_configs SET is_default_asr = 0 WHERE user_id = ?').run(userId)
    if (input.isDefaultTts === true) db.prepare('UPDATE user_voice_provider_configs SET is_default_tts = 0 WHERE user_id = ?').run(userId)
    if (input.isDefaultAsr !== undefined) add('is_default_asr = ?', input.isDefaultAsr ? 1 : 0)
    if (input.isDefaultTts !== undefined) add('is_default_tts = ?', input.isDefaultTts ? 1 : 0)
    if (fields.length) db.prepare(`UPDATE user_voice_provider_configs SET ${fields.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`).run(...values, Date.now(), id, userId)
    return toPublic(this.get(userId, id))
  }
  delete(userId: string, id: string) { this.get(userId, id); db.prepare("UPDATE user_voice_provider_configs SET status = 'deleted', updated_at = ? WHERE id = ? AND user_id = ?").run(Date.now(), id, userId); return { id } }
}
export const voiceConfigService = new VoiceConfigService()
