import crypto from 'crypto'
import { config } from './config.js'

export function createAgentToolToken(roomId: string, agentId: string): string {
  const sig = crypto
    .createHmac('sha256', config.jwtSecret)
    .update(`${roomId}:${agentId}`)
    .digest('hex')
  return `${agentId}.${sig}`
}

export function verifyAgentToolToken(roomId: string, token?: string): { ok: boolean; agentId?: string } {
  if (!token || !token.includes('.')) return { ok: false }
  const [agentId, sig] = token.split('.', 2)
  const expected = createAgentToolToken(roomId, agentId).split('.', 2)[1]
  if (sig.length !== expected.length) return { ok: false }
  const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  return ok ? { ok: true, agentId } : { ok: false }
}
