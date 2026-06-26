import { FastifyInstance } from 'fastify'
import { aiConfigService } from '../services/ai-config.service.js'
import { requireAdmin, routeAuthError } from './route-auth.js'

export async function registerAIRoutes(app: FastifyInstance) {
  // Get AI config
  app.get('/api/ai/config', async (request, reply) => {
    const user = (request as any).user
    try { requireAdmin(user) } catch (err: any) { return routeAuthError(reply, err) }
    const config = aiConfigService.getConfig()
    // Don't expose full API keys, just mask them
    const maskedConfig = {
      ...config,
      apiKeys: Object.fromEntries(
        Object.entries(config.apiKeys).map(([k, v]) => [
          k,
          v ? `${v.substring(0, 8)}...${v.substring(v.length - 4)}` : ''
        ])
      )
    }
    return reply.send({ success: true, data: maskedConfig })
  })

  // Update API key
  app.post('/api/ai/api-key', async (request, reply) => {
    const user = (request as any).user
    try { requireAdmin(user) } catch (err: any) { return routeAuthError(reply, err) }
    const { provider, apiKey } = request.body as any
    if (!provider || !apiKey) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'provider and apiKey are required' }
      })
    }

    aiConfigService.updateApiKey(provider, apiKey)
    return reply.send({ success: true, message: 'API key updated' })
  })

  // Set current provider
  app.post('/api/ai/provider', async (request, reply) => {
    const user = (request as any).user
    try { requireAdmin(user) } catch (err: any) { return routeAuthError(reply, err) }
    const { provider } = request.body as any
    if (!provider) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'provider is required' }
      })
    }

    aiConfigService.setCurrentProvider(provider)
    return reply.send({ success: true, message: 'Provider updated' })
  })

  // Enable/disable provider
  app.patch('/api/ai/provider/:provider/enabled', async (request, reply) => {
    const user = (request as any).user
    try { requireAdmin(user) } catch (err: any) { return routeAuthError(reply, err) }
    const { provider } = request.params as any
    const { enabled } = request.body as any

    if (typeof enabled !== 'boolean') {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'enabled must be a boolean' }
      })
    }

    aiConfigService.enableProvider(provider, enabled)
    return reply.send({ success: true, message: 'Provider enabled status updated' })
  })

  // Test connection
  app.post('/api/ai/test', async (request, reply) => {
    const user = (request as any).user
    try { requireAdmin(user) } catch (err: any) { return routeAuthError(reply, err) }
    const { provider, model } = request.body as any
    if (!provider) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'provider is required' }
      })
    }

    const result = await aiConfigService.testConnection(provider, model)
    return reply.send({ success: result.success, data: result })
  })

  // Call AI directly
  app.post('/api/ai/call', async (request, reply) => {
    const user = (request as any).user
    try { requireAdmin(user) } catch (err: any) { return routeAuthError(reply, err) }
    const { prompt, model, maxTokens, system } = request.body as any
    if (!prompt) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'prompt is required' }
      })
    }

    try {
      const response = await aiConfigService.callAI(prompt, { model, maxTokens, system })
      return reply.send({ success: true, data: { response } })
    } catch (err: any) {
      return reply.code(500).send({
        success: false,
        error: { code: 'AI_ERROR', message: err.message }
      })
    }
  })
}
