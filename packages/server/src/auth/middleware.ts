import { FastifyRequest, FastifyReply } from 'fastify'
import { verifyToken, extractTokenFromHeader } from './jwt.js'
import db from '../storage/db.js'

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const token = extractTokenFromHeader(request.headers.authorization)
  
  if (!token) {
    reply.code(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '未登录，请先登录' }
    })
    return
  }

  const decoded = verifyToken(token)
  
  if (!decoded) {
    reply.code(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '登录已过期，请重新登录' }
    })
    return
  }

  // Verify user actually exists in database
  const user = db.prepare('SELECT id, username, nickname, avatar, role FROM users WHERE id = ?').get(decoded.id) as any
  if (!user) {
    reply.code(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '用户不存在，请重新登录' }
    })
    return
  }

  // Attach user to request with fresh DB data
  ;(request as any).user = {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    avatar: user.avatar,
    role: user.role
  }
}

export function requireAuth(request: FastifyRequest, reply: FastifyReply, done: any) {
  authenticate(request, reply).then(() => {
    if (!reply.sent) {
      done()
    }
  })
}
