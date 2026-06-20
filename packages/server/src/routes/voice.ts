import { FastifyInstance } from 'fastify'
import { voiceConfigService } from '../services/voice/voice-config.service.js'
import { voiceService } from '../services/voice/voice.service.js'
export async function registerVoiceRoutes(app: FastifyInstance) {
  app.get('/api/voice/configs', async (request) => {
    const user = (request as any).user
    return { success: true, data: { configs: voiceConfigService.list(user.id) } }
  })
  app.post('/api/voice/configs', async (request) => {
    const user = (request as any).user
    return { success: true, data: { config: voiceConfigService.create(user.id, request.body || {}) } }
  })
  app.get('/api/voice/configs/:id/edit', async (request) => {
    const user = (request as any).user
    const { id } = request.params as any
    return { success: true, data: { config: voiceConfigService.getEditable(user.id, id) } }
  })
  app.patch('/api/voice/configs/:id', async (request) => {
    const user = (request as any).user
    const { id } = request.params as any
    return { success: true, data: { config: voiceConfigService.update(user.id, id, request.body || {}) } }
  })
  app.delete('/api/voice/configs/:id', async (request) => {
    const user = (request as any).user
    const { id } = request.params as any
    return { success: true, data: voiceConfigService.delete(user.id, id) }
  })
  app.post('/api/voice/configs/:id/test', async (request) => {
    const user = (request as any).user
    const { id } = request.params as any
    return { success: true, data: await voiceService.testConfig(user.id, id) }
  })
  app.post('/api/voice/transcribe', async (request) => {
    const user = (request as any).user
    const file = await request.file()
    if (!file) throw { code: 'VOICE_AUDIO_REQUIRED', message: '请上传语音文件' }
    const fields: any = file.fields || {}
    const val = (name: string) => fields[name]?.value ? String(fields[name].value) : undefined
    const buffer = await file.toBuffer()
    if (buffer.length > 20 * 1024 * 1024) throw { code: 'VOICE_AUDIO_TOO_LARGE', message: '语音文件不能超过 20MB' }
    const result = await voiceService.transcribe(user.id, {
      providerConfigId: val('providerConfigId'),
      roomId: val('roomId'),
      taskId: val('taskId'),
      language: val('language'),
      format: val('format'),
      sampleRate: val('sampleRate') ? Number(val('sampleRate')) : undefined,
      mimeType: file.mimetype || 'application/octet-stream',
      audio: buffer,
    })
    return { success: true, data: result }
  })
  app.post('/api/voice/synthesize', async (request) => {
    const user = (request as any).user
    const body = request.body as any
    const result = await voiceService.synthesize(user.id, {
      providerConfigId: body?.providerConfigId,
      text: String(body?.text || ''),
      roomId: body?.roomId,
      taskId: body?.taskId,
      messageId: body?.messageId,
      voice: body?.voice,
      speed: body?.speed !== undefined ? Number(body.speed) : undefined,
      format: body?.format,
      sampleRate: body?.sampleRate !== undefined ? Number(body.sampleRate) : undefined,
    })
    return { success: true, data: result }
  })
}
