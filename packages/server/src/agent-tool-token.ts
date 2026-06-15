import crypto from 'crypto'
import { config } from './config.js'

function sign(roomId: string, agentId: string, actorUserId = ''): string {
  return crypto
    .createHmac('sha256', config.jwtSecret)
    .update(`${roomId}:${agentId}:${actorUserId}`)
    .digest('hex')
}

export function createAgentToolToken(roomId: string, agentId: string, actorUserId?: string): string {
  const actor = actorUserId || ''
  const sig = sign(roomId, agentId, actor)
  return actor ? `${agentId}.${actor}.${sig}` : `${agentId}.${sig}`
}

export function verifyAgentToolToken(roomId: string, token?: string): { ok: boolean; agentId?: string; actorUserId?: string } {
  if (!token || !token.includes('.')) return { ok: false }
  const parts = token.split('.')
  if (parts.length === 2) {
    // Backward-compatible token for already prepared workspaces.
    const [agentId, sig] = parts
    const expected = sign(roomId, agentId, '')
    if (sig.length !== expected.length) return { ok: false }
    const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    return ok ? { ok: true, agentId } : { ok: false }
  }
  if (parts.length !== 3) return { ok: false }
  const [agentId, actorUserId, sig] = parts
  const expected = sign(roomId, agentId, actorUserId)
  if (sig.length !== expected.length) return { ok: false }
  const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  return ok ? { ok: true, agentId, actorUserId } : { ok: false }
}
