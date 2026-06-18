import crypto from 'crypto'
import { config } from '../config.js'

const PREFIX = 'enc:v1:'

function keyBytes(): Buffer {
  const source = process.env.MODEL_KEY_ENCRYPTION_SECRET || config.jwtSecret || 'freechat-dev-secret'
  return crypto.createHash('sha256').update(source).digest()
}

export function encryptSecret(value?: string | null): string | null {
  if (!value) return null
  if (value.startsWith(PREFIX)) return value
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64')}`
}

export function decryptSecret(value?: string | null): string | null {
  if (!value) return null
  if (!value.startsWith(PREFIX)) return value
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const encrypted = raw.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
