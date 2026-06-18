import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { modelProfileRepository } from '../domains/model-provider/model-profile.repository.js'
import { aiConfigService } from './ai-config.service.js'
import { encryptSecret } from './secret-crypto.js'

export const PLATFORM_USER_ID = 'user_platform_model_provider'

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
      modelProfileRepository.upsertPlatformProfile({
        id: `mp_platform_${key}`,
        ownerId: PLATFORM_USER_ID,
        name: provider.name || key,
        baseUrl: provider.baseUrl || null,
        apiKeyCipher: apiKey ? encryptSecret(apiKey) : null,
        apiKeyLast4: apiKey ? apiKey.slice(-4) : null,
        defaultModel: provider.defaultModel || null,
        models: JSON.stringify(provider.models || []),
      })
    }
  }
}

export const platformModelBootstrapService = new PlatformModelBootstrapService()
