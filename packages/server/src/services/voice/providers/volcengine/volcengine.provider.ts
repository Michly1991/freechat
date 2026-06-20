import crypto from 'crypto'
import type { SpeechRecognitionProvider, SpeechSynthesisProvider, VoiceProviderConfig } from '../../types.js'

function reqid() { return crypto.randomUUID() }
function bearer(config: VoiceProviderConfig) { return config.credential.token || config.credential.accessToken || config.credential.secretAccessKey || '' }
function doubaoApiKey(config: VoiceProviderConfig) {
  // 新版豆包语音 HTTP TTS 使用 X-Api-Key。用户表单里的 Token 对应该值；App ID 可能也是 api- 开头但不一定可作为 X-Api-Key。
  const appId = config.credential.appId || config.credential.appid || ''
  return config.credential.apiKey || config.config.apiKey || bearer(config) || (String(appId).startsWith('api-') ? appId : '')
}
function authHeader(config: VoiceProviderConfig, token: string) { return config.config.authorization || `${config.config.authScheme || 'Bearer;'}${token}` }
function asString(v: any) { return typeof v === 'string' ? v : '' }
function pickText(data: any): string { return asString(data?.text) || asString(data?.result?.text) || asString(data?.result?.[0]?.text) || asString(data?.utterances?.[0]?.text) || asString(data?.data?.text) || '' }
function audioFormat(mimeType?: string, fallback = 'wav') { if (!mimeType) return fallback; if (mimeType.includes('webm')) return 'webm'; if (mimeType.includes('ogg')) return 'ogg'; if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3'; if (mimeType.includes('wav')) return 'wav'; return fallback }
function mimeFromEncoding(encoding: string) { return encoding === 'wav' ? 'audio/wav' : 'audio/mpeg' }
function volcErrorMessage(message: any, fallback: string) {
  const text = asString(message) || fallback
  if (text.includes('invalid auth token') || text.includes('Invalid X-Api-Key')) return '火山语音鉴权失败：请检查 Token/API Key 是否正确'
  if (text.includes('requested grant not found')) return '火山语音授权不匹配：当前 App/Token 没有该 Resource ID、cluster 或音色的 TTS/ASR 授权，请检查火山控制台授权、Resource ID 和音色配置'
  return text
}
function shouldUseDoubaoAsr(config: VoiceProviderConfig) {
  if (config.config.asrApiVersion === 'legacy') return false
  if (config.config.asrApiVersion === 'v3' || config.config.asrApiVersion === 'doubao') return true
  const appId = config.credential.appId || config.credential.appid || ''
  return String(appId).startsWith('api-') || String(appId).startsWith('api_key') || !!config.config.asrResourceId
}

export class VolcengineVoiceProvider implements SpeechRecognitionProvider, SpeechSynthesisProvider {
  provider = 'volcengine'
  async transcribeOnce(input: { audio: Buffer; mimeType: string; sampleRate?: number; language?: string; format?: string; config: VoiceProviderConfig }) {
    const { config } = input
    if (shouldUseDoubaoAsr(config)) return this.transcribeDoubao(input)
    const asrUrl = config.config.asrUrl || 'https://openspeech.bytedance.com/api/v1/asr'
    const token = bearer(config)
    if (!token) throw { code: 'VOICE_PROVIDER_CREDENTIAL_INVALID', message: '火山语音 token/secret 未配置' }
    const started = Date.now()
    const body = {
      app: { appid: config.credential.appId || config.credential.appid, token, cluster: config.credential.asrCluster || config.config.asrCluster || 'volcengine_input_common' },
      user: { uid: config.userId },
      audio: { format: input.format || audioFormat(input.mimeType), rate: input.sampleRate || config.config.sampleRate || 16000, data: input.audio.toString('base64') },
      request: { reqid: reqid(), language: input.language || config.config.language || 'zh-CN', operation: 'query', sequence: 1 },
    }
    const res = await fetch(asrUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: authHeader(config, token) }, body: JSON.stringify(body) })
    const text = await res.text()
    let data: any = {}
    try { data = text ? JSON.parse(text) : {} } catch { data = { rawText: text } }
    if (!res.ok || data?.code || data?.error) throw { code: 'VOICE_ASR_FAILED', message: volcErrorMessage(data?.message || data?.error, `火山语音识别失败 HTTP ${res.status}`) }
    const transcript = pickText(data)
    if (!transcript) throw { code: 'VOICE_ASR_EMPTY', message: '语音识别未返回文本' }
    return { text: transcript, durationMs: Date.now() - started, raw: data }
  }

  private async transcribeDoubao(input: { audio: Buffer; mimeType: string; sampleRate?: number; language?: string; format?: string; config: VoiceProviderConfig }) {
    const { config } = input
    const asrUrl = config.config.asrUrl || 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash'
    const requestId = reqid()
    const apiKey = doubaoApiKey(config)
    const appKey = config.credential.appId || config.credential.appid || config.config.appKey || apiKey
    const accessKey = config.credential.accessKey || config.config.accessKey || bearer(config) || apiKey
    if (!apiKey && (!appKey || !accessKey)) throw { code: 'VOICE_PROVIDER_CREDENTIAL_INVALID', message: '火山豆包语音 ASR API Key 未配置' }
    const format = input.format || audioFormat(input.mimeType)
    const started = Date.now()
    const body = {
      user: { uid: config.userId },
      audio: { format, rate: input.sampleRate || config.config.sampleRate || 16000, data: input.audio.toString('base64') },
      request: { reqid: requestId, model_name: config.config.asrModel || 'bigmodel', language: input.language || config.config.language || 'zh-CN', enable_itn: true, enable_punc: true },
    }
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-api-resource-id': config.config.asrResourceId || config.credential.asrCluster || config.config.asrCluster || 'volc.bigasr.auc', 'x-api-request-id': requestId, 'x-api-sequence': '-1' }
    if (apiKey) headers['x-api-key'] = apiKey
    if (appKey) headers['x-api-app-key'] = appKey
    if (accessKey) headers['x-api-access-key'] = accessKey
    const res = await fetch(asrUrl, { method: 'POST', headers, body: JSON.stringify(body) })
    const text = await res.text()
    let data: any = {}
    try { data = text ? JSON.parse(text) : {} } catch { data = { rawText: text } }
    if (!res.ok || data?.code || data?.error) throw { code: 'VOICE_ASR_FAILED', message: volcErrorMessage(data?.message || data?.error, `火山豆包语音识别失败 HTTP ${res.status}`) }
    const transcript = pickText(data)
    if (!transcript) throw { code: 'VOICE_ASR_EMPTY', message: '语音识别未返回文本' }
    return { text: transcript, durationMs: Date.now() - started, raw: data }
  }
  async synthesize(input: { text: string; voice?: string; speed?: number; format?: string; sampleRate?: number; config: VoiceProviderConfig }) {
    const { config } = input
    if (config.config.ttsApiVersion === 'legacy') return this.synthesizeLegacy(input)
    const ttsUrl = config.config.ttsUrl || 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
    const apiKey = doubaoApiKey(config)
    if (!apiKey) throw { code: 'VOICE_PROVIDER_CREDENTIAL_INVALID', message: '火山豆包语音 API Key 未配置' }
    const encoding = input.format || config.config.audioFormat || 'mp3'
    const started = Date.now()
    const body = {
      req_params: {
        text: input.text,
        speaker: input.voice || config.config.defaultVoice || config.config.speaker || 'zh_female_vv_uranus_bigtts',
        audio_params: { format: encoding, sample_rate: input.sampleRate || config.config.sampleRate || 24000 },
      },
    }
    const res = await fetch(ttsUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'x-api-resource-id': config.config.ttsResourceId || config.credential.resourceId || config.credential.ttsCluster || 'seed-tts-2.0', 'x-control-require-usage-tokens-return': '*' }, body: JSON.stringify(body) })
    const text = await res.text()
    const chunks: Buffer[] = []
    let last: any = null
    for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      try { last = JSON.parse(line) } catch { continue }
      if (last?.code && last.code !== 0 && last.code !== 20000000) throw { code: 'VOICE_TTS_FAILED', message: volcErrorMessage(last?.message, `火山语音合成失败：${last.code}`) }
      if (last?.data) chunks.push(Buffer.from(last.data, 'base64'))
    }
    if (!res.ok) throw { code: 'VOICE_TTS_FAILED', message: volcErrorMessage(last?.message, `火山语音合成失败 HTTP ${res.status}`) }
    if (!chunks.length) throw { code: 'VOICE_TTS_EMPTY', message: volcErrorMessage(last?.message, '语音合成未返回音频') }
    return { audio: Buffer.concat(chunks), mimeType: mimeFromEncoding(encoding), durationMs: Date.now() - started, raw: last || {} }
  }

  private async synthesizeLegacy(input: { text: string; voice?: string; speed?: number; format?: string; sampleRate?: number; config: VoiceProviderConfig }) {
    const { config } = input
    const ttsUrl = config.config.ttsUrl || 'https://openspeech.bytedance.com/api/v1/tts'
    const token = bearer(config)
    if (!token) throw { code: 'VOICE_PROVIDER_CREDENTIAL_INVALID', message: '火山语音 token/secret 未配置' }
    const encoding = input.format || config.config.audioFormat || 'mp3'
    const started = Date.now()
    const body = {
      app: { appid: config.credential.appId || config.credential.appid, token, cluster: config.credential.ttsCluster || config.config.ttsCluster || 'volcano_tts' },
      user: { uid: config.userId },
      audio: { voice_type: input.voice || config.config.defaultVoice || 'zh_female_tianmeisongv2_moon_bigtts', encoding, speed_ratio: input.speed || config.config.speed || 1.0, rate: input.sampleRate || config.config.sampleRate || 24000 },
      request: { reqid: reqid(), text: input.text, operation: 'query' },
    }
    const res = await fetch(ttsUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: authHeader(config, token) }, body: JSON.stringify(body) })
    const text = await res.text()
    let data: any = {}
    try { data = text ? JSON.parse(text) : {} } catch { data = { rawText: text } }
    if (!res.ok || data?.code || data?.error) throw { code: 'VOICE_TTS_FAILED', message: volcErrorMessage(data?.message || data?.error, `火山语音合成失败 HTTP ${res.status}`) }
    const base64 = data?.data || data?.audio || data?.result?.audio || data?.result?.data
    if (!base64) throw { code: 'VOICE_TTS_EMPTY', message: '语音合成未返回音频' }
    return { audio: Buffer.from(base64, 'base64'), mimeType: mimeFromEncoding(encoding), durationMs: Date.now() - started, raw: data }
  }
}
