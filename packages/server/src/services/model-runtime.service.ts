import db from '../storage/db.js'
import { aiConfigService, type AICallResult } from './ai-config.service.js'
import { decryptSecret } from './secret-crypto.js'
import { agentModelConfigService } from './agent-model-config.service.js'

export type ModelSource = 'platform' | 'user_owned' | 'marketplace' | 'client_reported' | 'system_default'

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
