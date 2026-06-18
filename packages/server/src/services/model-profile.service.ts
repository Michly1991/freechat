import { modelProfileRepository } from '../domains/model-provider/model-profile.repository.js'
import db from '../storage/db.js'
import { encryptSecret } from './secret-crypto.js'

function last4(value?: string | null): string | null {
  const text = String(value || '')
  return text ? text.slice(-4) : null
}

function parseModels(value: any): string | null {
  if (value === undefined || value === null || value === '') return null
  if (Array.isArray(value)) return JSON.stringify(value.map(String).filter(Boolean))
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return JSON.stringify(parsed.map(String).filter(Boolean))
    } catch {}
    return JSON.stringify(value.split(',').map((x) => x.trim()).filter(Boolean))
  }
  return null
}

function hostOf(url?: string | null): string | null {
  if (!url) return null
  try { return new URL(url).host } catch { return String(url).replace(/^https?:\/\//, '').split('/')[0] || null }
}

function priceSummary(profileId: string): string {
  const rows = db.prepare('SELECT * FROM model_billing_rules WHERE model_profile_id = ? AND enabled = 1 ORDER BY model ASC').all(profileId) as any[]
  if (!rows.length) return '暂无定价'
  return rows.slice(0, 2).map((r) => `${r.model}: 输入${r.input_credit_per_million || 0}/百万，输出${r.output_credit_per_million || 0}/百万${r.min_credits_per_run ? `，最低${r.min_credits_per_run}/次` : ''}`).join('；') + (rows.length > 2 ? ` 等${rows.length}个模型` : '')
}

function publicProfile(row: any, viewer?: { id: string; role?: string }) {
  const canEdit = !!viewer && (row.owner_id === viewer.id || viewer.role === 'admin')
  const owner = db.prepare('SELECT nickname, username FROM users WHERE id = ?').get(row.owner_id) as any
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    providerType: row.provider_type,
    ownerName: owner?.nickname || owner?.username || row.owner_id,
    canEdit,
    baseUrl: canEdit ? row.base_url : undefined,
    baseUrlHost: hostOf(row.base_url),
    apiKeyLast4: canEdit ? row.api_key_last4 : undefined,
    defaultModel: row.default_model,
    models: row.models ? JSON.parse(row.models) : [],
    visibility: row.visibility,
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    priceSummary: priceSummary(row.id),
  }
}

export class ModelProfileService {
  listVisible(userId: string, userRole?: string) {
    return modelProfileRepository.listVisible(userId, userRole).map((row) => publicProfile(row, { id: userId, role: userRole }))
  }

  create(ownerId: string, input: any) {
    const apiKey = String(input?.apiKey || input?.api_key || '')
    const visibility = ['private', 'shared', 'platform'].includes(input?.visibility) ? input.visibility : 'private'
    const row = modelProfileRepository.create(ownerId, {
      name: String(input?.name || '我的模型'),
      providerType: String(input?.providerType || input?.provider_type || 'anthropic-compatible'),
      baseUrl: input?.baseUrl || input?.base_url || null,
      apiKeyCipher: encryptSecret(apiKey),
      apiKeyLast4: last4(apiKey),
      defaultModel: input?.defaultModel || input?.default_model || input?.model || null,
      models: parseModels(input?.models),
      visibility,
    })
    return publicProfile(row, { id: ownerId })
  }

  update(user: { id: string; role?: string }, id: string, input: any) {
    const row = modelProfileRepository.get(id)
    if (!row) throw { code: 'MODEL_PROFILE_NOT_FOUND', message: 'Model profile not found' }
    if (row.owner_id !== user.id && user.role !== 'admin') throw { code: 'FORBIDDEN', message: 'Only owner/admin can edit this model profile' }
    const apiKey = input?.apiKey || input?.api_key
    const next = {
      name: input?.name !== undefined ? String(input.name) : row.name,
      providerType: input?.providerType || input?.provider_type || row.provider_type,
      baseUrl: input?.baseUrl !== undefined ? input.baseUrl : row.base_url,
      apiKeyCipher: encryptSecret(apiKey),
      apiKeyLast4: last4(apiKey),
      defaultModel: input?.defaultModel !== undefined ? input.defaultModel : row.default_model,
      models: input?.models !== undefined ? parseModels(input.models) : row.models,
      visibility: ['private', 'shared', 'platform'].includes(input?.visibility) ? input.visibility : row.visibility,
      enabled: input?.enabled !== undefined ? (input.enabled ? 1 : 0) : row.enabled,
    }
    return publicProfile(modelProfileRepository.update(id, next), user)
  }
}

export const modelProfileService = new ModelProfileService()
