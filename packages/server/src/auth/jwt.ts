import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { config } from '../config.js'
import type { User } from '@freechat/shared'

const SALT_ROUNDS = 10

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function generateToken(user: Omit<User, 'avatar'>): string {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
      identityType: user.identityType
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn as string & jwt.SignOptions['expiresIn'] }
  )
}

export function verifyToken(token: string): any {
  try {
    return jwt.verify(token, config.jwtSecret)
  } catch (err) {
    return null
  }
}

export function extractTokenFromHeader(authHeader?: string): string | null {
  if (!authHeader) return null
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null
  return parts[1]
}
