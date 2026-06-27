import crypto from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import db from '../../storage/db.js'
import { roomService } from '../room.service.js'
import { config as appConfig } from '../../config.js'
import type { SpeechRecognitionProvider, SpeechSynthesisProvider, VoiceProviderConfig } from './types.js'
import { voiceConfigService } from './voice-config.service.js'
import { VolcengineVoiceProvider } from './providers/volcengine/volcengine.provider.js'

const volc = new VolcengineVoiceProvider()
const asrProviders: Record<string, SpeechRecognitionProvider> = { volcengine: volc }
const ttsProviders: Record<string, SpeechSynthesisProvider> = { volcengine: volc }
function providerError(provider: string) { return { code: 'VOICE_PROVIDER_UNSUPPORTED', message: `暂不支持语音服务厂商：${provider}` } }
async function assertVoiceRoomContext(userId: string, input: { roomId?: string; taskId?: string; messageId?: string }) {
  const { roomId, taskId, messageId } = input
  if (!roomId && !taskId && !messageId) return

  let resolvedRoomId = roomId
  if (!resolvedRoomId && taskId) {
    const task = db.prepare('SELECT room_id FROM tasks WHERE id = ?').get(taskId) as any
    if (!task) throw { code: 'TASK_NOT_FOUND', message: 'Task not found' }
    resolvedRoomId = task.room_id
  }
  if (!resolvedRoomId && messageId) {
    const message = db.prepare('SELECT room_id FROM messages WHERE id = ? AND deleted = 0').get(messageId) as any
    if (!message) throw { code: 'MESSAGE_NOT_FOUND', message: 'Message not found' }
    resolvedRoomId = message.room_id
  }
  if (!resolvedRoomId || !(await roomService.isMember(resolvedRoomId, userId))) throw { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' }
  if (taskId) {
    const task = db.prepare('SELECT room_id FROM tasks WHERE id = ?').get(taskId) as any
    if (!task || task.room_id !== resolvedRoomId) throw { code: 'TASK_NOT_FOUND', message: 'Task not found in this room' }
  }
  if (messageId) {
    const message = db.prepare('SELECT room_id FROM messages WHERE id = ? AND deleted = 0').get(messageId) as any
    if (!message || message.room_id !== resolvedRoomId) throw { code: 'MESSAGE_NOT_FOUND', message: 'Message not found in this room' }
  }
}
function record(input: { userId: string; roomId?: string; taskId?: string; messageId?: string; provider: string; direction: 'input' | 'output'; audioPath?: string; text?: string; status: string; error?: string; durationMs?: number }) {
  db.prepare('INSERT INTO voice_interactions (id,user_id,room_id,task_id,message_id,provider,direction,audio_path,text,status,error,duration_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(`voice_${crypto.randomUUID()}`, input.userId, input.roomId || null, input.taskId || null, input.messageId || null, input.provider, input.direction, input.audioPath || null, input.text || null, input.status, input.error || null, input.durationMs || null, Date.now())
}
export class VoiceService {
  async transcribe(userId: string, input: { providerConfigId?: string; audio: Buffer; mimeType: string; roomId?: string; taskId?: string; sampleRate?: number; language?: string; format?: string }) {
    await assertVoiceRoomContext(userId, input)
    const cfg = input.providerConfigId ? voiceConfigService.get(userId, input.providerConfigId) : voiceConfigService.getDefault(userId, 'asr')
    if (!cfg.asrEnabled) throw { code: 'VOICE_ASR_DISABLED', message: '该语音配置未启用识别' }
    const provider = asrProviders[cfg.provider]
    if (!provider) throw providerError(cfg.provider)
    try {
      const result = await provider.transcribeOnce({ ...input, config: cfg })
      record({ userId, roomId: input.roomId, taskId: input.taskId, provider: cfg.provider, direction: 'input', text: result.text, status: 'succeeded', durationMs: result.durationMs })
      return { text: result.text, provider: cfg.provider, durationMs: result.durationMs }
    } catch (err: any) {
      record({ userId, roomId: input.roomId, taskId: input.taskId, provider: cfg.provider, direction: 'input', status: 'failed', error: err?.message || String(err) })
      throw err
    }
  }
  async synthesize(userId: string, input: { providerConfigId?: string; text: string; roomId?: string; taskId?: string; messageId?: string; voice?: string; speed?: number; format?: string; sampleRate?: number }) {
    await assertVoiceRoomContext(userId, input)
    if (!input.text?.trim()) throw { code: 'VOICE_TEXT_REQUIRED', message: '请输入需要合成的文本' }
    const cfg: VoiceProviderConfig = input.providerConfigId ? voiceConfigService.get(userId, input.providerConfigId) : voiceConfigService.getDefault(userId, 'tts')
    if (!cfg.ttsEnabled) throw { code: 'VOICE_TTS_DISABLED', message: '该语音配置未启用合成' }
    const provider = ttsProviders[cfg.provider]
    if (!provider) throw providerError(cfg.provider)
    try {
      const result = await provider.synthesize({ ...input, config: cfg })
      const ext = result.mimeType.includes('wav') ? 'wav' : 'mp3'
      const rel = `voice/${userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`
      const abs = join(appConfig.upload.dir, rel)
      mkdirSync(join(appConfig.upload.dir, 'voice', userId), { recursive: true })
      writeFileSync(abs, result.audio)
      const audioUrl = `/uploads/${rel}`
      record({ userId, roomId: input.roomId, taskId: input.taskId, messageId: input.messageId, provider: cfg.provider, direction: 'output', audioPath: audioUrl, text: input.text, status: 'succeeded', durationMs: result.durationMs })
      return { audioUrl, mimeType: result.mimeType, provider: cfg.provider, durationMs: result.durationMs }
    } catch (err: any) {
      record({ userId, roomId: input.roomId, taskId: input.taskId, messageId: input.messageId, provider: cfg.provider, direction: 'output', text: input.text, status: 'failed', error: err?.message || String(err) })
      throw err
    }
  }
  async testConfig(userId: string, id: string) {
    const cfg = voiceConfigService.get(userId, id)
    return { ok: true, provider: cfg.provider, asrEnabled: cfg.asrEnabled, ttsEnabled: cfg.ttsEnabled, credentialStatus: Object.keys(cfg.credential || {}).length ? 'configured' : 'missing' }
  }
}
export const voiceService = new VoiceService()
