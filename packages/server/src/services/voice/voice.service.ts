import crypto from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import db from '../../storage/db.js'
import { config as appConfig } from '../../config.js'
import type { SpeechRecognitionProvider, SpeechSynthesisProvider, VoiceProviderConfig } from './types.js'
import { voiceConfigService } from './voice-config.service.js'
import { VolcengineVoiceProvider } from './providers/volcengine/volcengine.provider.js'

const volc = new VolcengineVoiceProvider()
const asrProviders: Record<string, SpeechRecognitionProvider> = { volcengine: volc }
const ttsProviders: Record<string, SpeechSynthesisProvider> = { volcengine: volc }
function providerError(provider: string) { return { code: 'VOICE_PROVIDER_UNSUPPORTED', message: `暂不支持语音服务厂商：${provider}` } }
function record(input: { userId: string; roomId?: string; taskId?: string; messageId?: string; provider: string; direction: 'input' | 'output'; audioPath?: string; text?: string; status: string; error?: string; durationMs?: number }) {
  db.prepare('INSERT INTO voice_interactions (id,user_id,room_id,task_id,message_id,provider,direction,audio_path,text,status,error,duration_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(`voice_${crypto.randomUUID()}`, input.userId, input.roomId || null, input.taskId || null, input.messageId || null, input.provider, input.direction, input.audioPath || null, input.text || null, input.status, input.error || null, input.durationMs || null, Date.now())
}
export class VoiceService {
  async transcribe(userId: string, input: { providerConfigId?: string; audio: Buffer; mimeType: string; roomId?: string; taskId?: string; sampleRate?: number; language?: string; format?: string }) {
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
