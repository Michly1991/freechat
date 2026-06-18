import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { billingRuleRepository } from '../domains/billing/billing-rule.repository.js'
import { modelProfileRepository } from '../domains/model-provider/model-profile.repository.js'
import { aiConfigService } from './ai-config.service.js'
import { encryptSecret } from './secret-crypto.js'

export const PLATFORM_USER_ID = 'user_platform_model_provider'

const PLATFORM_MODEL_RULES = {
  economy: { inputCreditPerMillion: 50, outputCreditPerMillion: 200, cacheWriteCreditPerMillion: 50, cacheReadCreditPerMillion: 10, minCreditsPerRun: 0, enabled: true },
  standard: { inputCreditPerMillion: 100, outputCreditPerMillion: 400, cacheWriteCreditPerMillion: 100, cacheReadCreditPerMillion: 20, minCreditsPerRun: 0, enabled: true },
  premium: { inputCreditPerMillion: 200, outputCreditPerMillion: 800, cacheWriteCreditPerMillion: 200, cacheReadCreditPerMillion: 40, minCreditsPerRun: 0, enabled: true },
}

function defaultRuleForPlatformModel(model?: string | null) {
  const name = String(model || '').toLowerCase()
  if (/mini|lite|flash|turbo|small/.test(name)) return PLATFORM_MODEL_RULES.economy
  if (/max|pro|plus|code|reason|thinking|r1|o1|o3/.test(name)) return PLATFORM_MODEL_RULES.premium
  return PLATFORM_MODEL_RULES.standard
}

function intValue(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

export class PlatformModelBootstrapService {
  ensurePlatformUserAndModels(): void {
    if (!modelProfileRepository.getUser(PLATFORM_USER_ID)) {
      modelProfileRepository.createSystemUser({
        id: PLATFORM_USER_ID,
        username: 'platform_model_provider',
        passwordHash: bcrypt.hashSync(`platform-${uuidv4()}`, 10),
        nickname: '平台模型服务',
        role: 'admin',
      })
    }
    const aiConfig = aiConfigService.getConfig()
    for (const [key, provider] of Object.entries(aiConfig.providers || {})) {
      if (!provider?.enabled) continue
      const apiKey = aiConfig.apiKeys?.[key]
      const profile = modelProfileRepository.upsertPlatformProfile({
        id: `mp_platform_${key}`,
        ownerId: PLATFORM_USER_ID,
        name: provider.name || key,
        baseUrl: provider.baseUrl || null,
        apiKeyCipher: apiKey ? encryptSecret(apiKey) : null,
        apiKeyLast4: apiKey ? apiKey.slice(-4) : null,
        defaultModel: provider.defaultModel || null,
        models: JSON.stringify(provider.models || []),
      })
      const models = provider.models?.length ? provider.models : [provider.defaultModel].filter(Boolean)
      for (const model of models) billingRuleRepository.upsertModelRule(profile.id, model, defaultRuleForPlatformModel(model), intValue)
    }
  }
}

export const platformModelBootstrapService = new PlatformModelBootstrapService()
