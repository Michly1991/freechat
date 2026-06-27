import db from '../storage/db.js'
import { aiConfigService, type AICallResult } from './ai-config.service.js'
import { decryptSecret } from './secret-crypto.js'
import { agentModelConfigService } from './agent-model-config.service.js'

export type ModelSource = 'platform' | 'user_owned' | 'marketplace' | 'client_reported' | 'system_default'


export type VisionModelContent = { type: 'text'; text: string } | { type: 'image'; mediaType: string; data: string }

export interface VisionCallInput {
  roomId: string
  agentId: string
  payerUserId?: string | null
  content: VisionModelContent[]
  system?: string
  maxTokens?: number
  model?: string
}

export type ResolvedModelRuntime = {
  modelProfileId: string | null
  model: string
  modelSource: ModelSource
  modelProviderUserId: string | null
  baseUrlHost: string | null
  isSelfProvidedModel: boolean
}

type ModelProfileRow = {
  id: string
  owner_id: string
  name: string
  provider_type: string
  base_url?: string | null
  api_key_cipher?: string | null
  default_model?: string | null
  visibility?: string | null
}

function hostOf(url?: string | null): string | null {
  if (!url) return null
  try { return new URL(url).host } catch { return String(url).replace(/^https?:\/\//, '').split('/')[0] || null }
}

function sourceFor(profile: ModelProfileRow | null | undefined, payerUserId?: string | null): ModelSource {
  if (!profile) return 'system_default'
  if (profile.owner_id && payerUserId && profile.owner_id === payerUserId) return 'user_owned'
  if (profile.visibility === 'platform') return 'platform'
  return 'marketplace'
}

export class ModelRuntimeService {
  resolveRoomAgentModel(roomId: string, agentId: string, payerUserId?: string | null): ResolvedModelRuntime {
    const binding = agentModelConfigService.getEffectiveConfig(roomId, agentId)
    if (binding?.modelProfileId) {
      const profile = db.prepare('SELECT * FROM model_profiles WHERE id = ? AND enabled = 1').get(binding.modelProfileId) as ModelProfileRow | undefined
      if (profile) {
        const model = binding.model || profile.default_model || null
        const modelSource = sourceFor(profile, payerUserId)
        return {
          modelProfileId: profile.id,
          model: model || '',
          modelSource,
          modelProviderUserId: modelSource === 'user_owned' ? null : profile.owner_id,
          baseUrlHost: hostOf(profile.base_url),
          isSelfProvidedModel: modelSource === 'user_owned',
        }
      }
    }

    const aiConfig = aiConfigService.getConfig()
    const providerKey = aiConfig.currentProvider
    const provider = providerKey ? aiConfig.providers?.[providerKey] : null
    const platformProfileId = providerKey ? `mp_platform_${providerKey}` : null
    const platformProfile = platformProfileId ? db.prepare('SELECT * FROM model_profiles WHERE id = ? AND enabled = 1').get(platformProfileId) as ModelProfileRow | undefined : undefined
    return {
      modelProfileId: platformProfile?.id || platformProfileId || null,
      model: binding?.model || platformProfile?.default_model || provider?.defaultModel || '',
      modelSource: platformProfile ? sourceFor(platformProfile, payerUserId) : 'platform',
      modelProviderUserId: platformProfile?.owner_id || null,
      baseUrlHost: hostOf(platformProfile?.base_url || provider?.baseUrl),
      isSelfProvidedModel: false,
    }
  }


  private async callAnthropicCompatibleVision(input: { baseUrl: string; apiKey: string; apiKeyHeader?: string; authType?: string; model?: string; content: VisionModelContent[]; maxTokens?: number; system?: string }): Promise<AICallResult> {
    const url = `${input.baseUrl.replace(/\/$/, '')}/v1/messages`
    const headers: Record<string, string> = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }
    if (input.authType === 'bearer') headers.authorization = `Bearer ${input.apiKey}`
    else headers[input.apiKeyHeader || 'x-api-key'] = input.apiKey
    const model = input.model || 'qwen-vl-max'
    const content = input.content.map((item) => item.type === 'image'
      ? { type: 'image', source: { type: 'base64', media_type: item.mediaType, data: item.data } }
      : { type: 'text', text: item.text })
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, max_tokens: input.maxTokens || 1024, messages: [{ role: 'user', content }], ...(input.system && { system: input.system }) }),
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as any
      throw new Error(`AI vision API error: ${err.message || err.code || response.statusText}`)
    }
    const data = await response.json() as any
    const usage = (data.usage || {}) as any
    return {
      text: data.content?.map((part: any) => part?.text || '').filter(Boolean).join('\n') || '',
      model: data.model || model,
      usage: {
        inputTokens: Number(usage.input_tokens || usage.prompt_tokens || 0),
        outputTokens: Number(usage.output_tokens || usage.completion_tokens || 0),
        cacheCreationInputTokens: Number(usage.cache_creation_input_tokens || 0),
        cacheReadInputTokens: Number(usage.cache_read_input_tokens || 0),
        totalTokens: Number(usage.input_tokens || usage.prompt_tokens || 0) + Number(usage.output_tokens || usage.completion_tokens || 0) + Number(usage.cache_creation_input_tokens || 0) + Number(usage.cache_read_input_tokens || 0),
      },
    }
  }

  async callRoomAgentVision(input: VisionCallInput): Promise<AICallResult & ResolvedModelRuntime> {
    const resolved = this.resolveRoomAgentModel(input.roomId, input.agentId, input.payerUserId)
    if (resolved.modelProfileId) {
      const profile = db.prepare('SELECT * FROM model_profiles WHERE id = ? AND enabled = 1').get(resolved.modelProfileId) as ModelProfileRow | undefined
      if (profile?.base_url && profile.api_key_cipher) {
        const apiKey = decryptSecret(profile.api_key_cipher)
        const authType = profile.provider_type === 'bearer' ? 'bearer' : 'header'
        const apiKeyHeader = authType === 'bearer' ? undefined : profile.provider_type === 'anthropic-compatible' ? 'x-api-key' : profile.provider_type || 'x-api-key'
        const result = await this.callAnthropicCompatibleVision({ baseUrl: profile.base_url, apiKey: apiKey || '', apiKeyHeader, authType, model: input.model || resolved.model || profile.default_model || undefined, content: input.content, maxTokens: input.maxTokens, system: input.system })
        return { ...result, ...resolved, model: result.model || resolved.model }
      }
    }
    const aiConfig = aiConfigService.getConfig()
    const providerKey = aiConfig.currentProvider
    const provider = providerKey ? aiConfig.providers?.[providerKey] : null
    const apiKey = aiConfigService.getApiKey(providerKey || '')
    if (!provider || !apiKey) throw new Error('AI provider not configured')
    const result = await this.callAnthropicCompatibleVision({ baseUrl: provider.baseUrl, apiKey, apiKeyHeader: provider.apiKeyHeader, authType: provider.authType, model: input.model || resolved.model || provider.defaultModel, content: input.content, maxTokens: input.maxTokens, system: input.system })
    return { ...result, ...resolved, model: result.model || resolved.model }
  }

  async callRoomAgentModel(roomId: string, agentId: string, payerUserId: string | null | undefined, prompt: string, options?: { model?: string; maxTokens?: number; system?: string }): Promise<AICallResult & ResolvedModelRuntime> {
    const resolved = this.resolveRoomAgentModel(roomId, agentId, payerUserId)
    if (resolved.modelProfileId) {
      const profile = db.prepare('SELECT * FROM model_profiles WHERE id = ? AND enabled = 1').get(resolved.modelProfileId) as ModelProfileRow | undefined
      if (profile?.base_url && profile.api_key_cipher) {
        const apiKey = decryptSecret(profile.api_key_cipher)
        const authType = profile.provider_type === 'bearer' ? 'bearer' : 'header'
        const apiKeyHeader = authType === 'bearer'
          ? undefined
          : profile.provider_type === 'anthropic-compatible'
            ? 'x-api-key'
            : profile.provider_type || 'x-api-key'
        const result = await aiConfigService.callAnthropicCompatibleWithUsage({
          baseUrl: profile.base_url,
          apiKey: apiKey || '',
          apiKeyHeader,
          authType,
          model: options?.model || resolved.model || profile.default_model || undefined,
          prompt,
          maxTokens: options?.maxTokens,
          system: options?.system,
        })
        return { ...result, ...resolved, model: result.model || resolved.model }
      }
    }

    const result = await aiConfigService.callAIWithUsage(prompt, { model: options?.model || resolved.model || undefined, maxTokens: options?.maxTokens, system: options?.system })
    return { ...result, ...resolved, model: result.model || resolved.model }
  }
}

export const modelRuntimeService = new ModelRuntimeService()
