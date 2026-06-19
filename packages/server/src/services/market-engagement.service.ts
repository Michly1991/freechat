import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'
import { creditWalletService } from './credit-wallet.service.js'
import { microToCredit, toInt } from '../domains/billing/money.js'

export type FollowTargetType = 'agent' | 'model'

function now() { return Date.now() }

export class MarketEngagementService {
  follow(userId: string, targetType: FollowTargetType, targetId: string) {
    if (!['agent', 'model'].includes(targetType)) throw { code: 'VALIDATION_ERROR', message: 'targetType must be agent or model' }
    const table = targetType === 'agent' ? 'agents' : 'model_profiles'
    const exists = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(targetId)
    if (!exists) throw { code: 'NOT_FOUND', message: 'Target not found' }
    db.prepare(`
      INSERT OR IGNORE INTO market_follows (id, user_id, target_type, target_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(`mf_${uuidv4()}`, userId, targetType, targetId, now())
    return { targetType, targetId, isFollowing: true }
  }

  unfollow(userId: string, targetType: FollowTargetType, targetId: string) {
    db.prepare('DELETE FROM market_follows WHERE user_id = ? AND target_type = ? AND target_id = ?').run(userId, targetType, targetId)
    return { targetType, targetId, isFollowing: false }
  }

  isFollowing(userId: string, targetType: FollowTargetType, targetId: string): boolean {
    return !!db.prepare('SELECT 1 FROM market_follows WHERE user_id = ? AND target_type = ? AND target_id = ?').get(userId, targetType, targetId)
  }

  purchaseScene(user: { id: string; role?: string }, sceneId: string, confirmed = false) {
    const scene = db.prepare('SELECT id, owner_id, built_in_key FROM scene_templates WHERE id = ? AND status = ?').get(sceneId, 'active') as any
    if (!scene) throw { code: 'SCENE_NOT_FOUND', message: 'Scene not found' }
    const existing = db.prepare('SELECT * FROM scene_purchases WHERE user_id = ? AND scene_template_id = ?').get(user.id, sceneId) as any
    if (existing) return { sceneId, isPurchased: true, priceCredits: microToCredit(existing.price_microcredits) }
    const ownOrBuiltIn = scene.owner_id === user.id || !!scene.built_in_key || user.role === 'admin'
    const rule = db.prepare('SELECT * FROM scene_billing_rules WHERE scene_template_id = ? AND enabled = 1').get(sceneId) as any
    const price = ownOrBuiltIn || rule?.billing_mode === 'free' ? 0 : toInt(rule?.fixed_credits_per_purchase)
    if (price > 0 && !confirmed) {
      const err = new Error(`购买场景需要 ${microToCredit(price)} credits，请确认后继续`)
      ;(err as any).code = 'PURCHASE_CONFIRMATION_REQUIRED'
      ;(err as any).priceCredits = microToCredit(price)
      throw err
    }
    if (price > 0) {
      const account = creditWalletService.getAccount(user.id)
      if (account.balance < price) throw { code: 'INSUFFICIENT_CREDITS', message: `余额不足，购买场景需要 ${microToCredit(price)} credits，当前余额 ${microToCredit(account.balance)} credits` }
    }
    const tx = db.transaction(() => {
      if (price > 0) {
        creditWalletService.apply(user.id, -price, 'scene_purchase', { note: `Purchase scene ${sceneId}` })
        if (scene.owner_id) creditWalletService.apply(scene.owner_id, price, 'scene_income', { note: `Scene purchase ${sceneId}` })
      }
      db.prepare(`
        INSERT OR IGNORE INTO scene_purchases (id, user_id, scene_template_id, price_microcredits, status, purchased_at)
        VALUES (?, ?, ?, ?, 'completed', ?)
      `).run(`sp_${uuidv4()}`, user.id, sceneId, price, now())
    })
    tx()
    return { sceneId, isPurchased: true, priceCredits: microToCredit(price) }
  }

  canUseScene(user: { id: string; role?: string }, sceneId: string): boolean {
    const scene = db.prepare('SELECT owner_id, built_in_key FROM scene_templates WHERE id = ? AND status = ?').get(sceneId, 'active') as any
    if (!scene) return false
    if (user.role === 'admin' || scene.owner_id === user.id || scene.built_in_key) return true
    return !!db.prepare('SELECT 1 FROM scene_purchases WHERE user_id = ? AND scene_template_id = ? AND status = ?').get(user.id, sceneId, 'completed')
  }
}

export const marketEngagementService = new MarketEngagementService()
