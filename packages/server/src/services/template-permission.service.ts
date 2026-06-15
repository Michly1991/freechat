import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'

export type TemplateTargetType = 'agent' | 'scene'
export type TemplatePermissionRole = 'owner' | 'editor'
export type TemplateRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

function normalizeRole(role?: string): TemplatePermissionRole {
  return role === 'owner' ? 'owner' : 'editor'
}

function ownerOf(targetType: TemplateTargetType, targetId: string): { ownerId?: string; builtIn?: boolean } | null {
  if (targetType === 'agent') {
    const row = db.prepare('SELECT owner_id as ownerId FROM agents WHERE id = ?').get(targetId) as any
    return row ? { ownerId: row.ownerId } : null
  }
  const row = db.prepare('SELECT owner_id as ownerId, built_in_key as builtInKey FROM scene_templates WHERE id = ?').get(targetId) as any
  return row ? { ownerId: row.ownerId, builtIn: !!row.builtInKey } : null
}

function userExists(userId: string): boolean {
  return !!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)
}

export class TemplatePermissionService {
  canEdit(targetType: TemplateTargetType, targetId: string, user: { id: string; role?: string }): boolean {
    const owner = ownerOf(targetType, targetId)
    if (!owner) throw { code: targetType === 'agent' ? 'AGENT_NOT_FOUND' : 'SCENE_NOT_FOUND', message: `${targetType} not found` }
    if (user.role === 'admin') return true
    if (owner.builtIn) return false
    if (owner.ownerId === user.id) return true
    const member = db.prepare(`
      SELECT role FROM template_permission_members
      WHERE target_type = ? AND target_id = ? AND user_id = ?
    `).get(targetType, targetId, user.id) as any
    return member?.role === 'owner' || member?.role === 'editor'
  }

  canManage(targetType: TemplateTargetType, targetId: string, user: { id: string; role?: string }): boolean {
    const owner = ownerOf(targetType, targetId)
    if (!owner) throw { code: targetType === 'agent' ? 'AGENT_NOT_FOUND' : 'SCENE_NOT_FOUND', message: `${targetType} not found` }
    if (user.role === 'admin') return true
    if (owner.builtIn) return false
    if (owner.ownerId === user.id) return true
    const member = db.prepare(`
      SELECT role FROM template_permission_members
      WHERE target_type = ? AND target_id = ? AND user_id = ?
    `).get(targetType, targetId, user.id) as any
    return member?.role === 'owner'
  }

  listMembers(targetType: TemplateTargetType, targetId: string) {
    const owner = ownerOf(targetType, targetId)
    if (!owner) throw { code: targetType === 'agent' ? 'AGENT_NOT_FOUND' : 'SCENE_NOT_FOUND', message: `${targetType} not found` }
    const ownerUser = owner.ownerId ? db.prepare('SELECT id, username, nickname, avatar, role FROM users WHERE id = ?').get(owner.ownerId) as any : null
    const rows = db.prepare(`
      SELECT m.target_type as targetType, m.target_id as targetId, m.user_id as userId, m.role,
             m.granted_by as grantedBy, m.created_at as createdAt, m.updated_at as updatedAt,
             u.username, u.nickname, u.avatar, u.role as userRole
      FROM template_permission_members m
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.target_type = ? AND m.target_id = ?
      ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.created_at ASC
    `).all(targetType, targetId) as any[]
    const members = rows.map((row) => ({ ...row, user: row.username ? { id: row.userId, username: row.username, nickname: row.nickname, avatar: row.avatar, role: row.userRole } : undefined }))
    if (ownerUser && !members.some((m) => m.userId === ownerUser.id)) {
      members.unshift({ targetType, targetId, userId: ownerUser.id, role: 'owner', builtInOwner: true, user: ownerUser })
    }
    return members
  }

  grant(targetType: TemplateTargetType, targetId: string, actor: { id: string; role?: string }, userId: string, role = 'editor') {
    if (!this.canManage(targetType, targetId, actor)) throw { code: 'FORBIDDEN', message: 'Only owner/admin can manage permissions' }
    if (!userExists(userId)) throw { code: 'USER_NOT_FOUND', message: 'User not found' }
    const normalized = normalizeRole(role)
    const owner = ownerOf(targetType, targetId)
    if (owner?.ownerId === userId && normalized !== 'owner') throw { code: 'VALIDATION_ERROR', message: 'Template owner must keep owner role' }
    const now = Date.now()
    db.prepare(`
      INSERT INTO template_permission_members (target_type, target_id, user_id, role, granted_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_type, target_id, user_id) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by, updated_at = excluded.updated_at
    `).run(targetType, targetId, userId, normalized, actor.id, now, now)
    return this.listMembers(targetType, targetId)
  }

  revoke(targetType: TemplateTargetType, targetId: string, actor: { id: string; role?: string }, userId: string) {
    if (!this.canManage(targetType, targetId, actor)) throw { code: 'FORBIDDEN', message: 'Only owner/admin can manage permissions' }
    const owner = ownerOf(targetType, targetId)
    if (owner?.ownerId === userId) throw { code: 'VALIDATION_ERROR', message: 'Cannot revoke template owner' }
    db.prepare('DELETE FROM template_permission_members WHERE target_type = ? AND target_id = ? AND user_id = ?').run(targetType, targetId, userId)
    return this.listMembers(targetType, targetId)
  }

  request(targetType: TemplateTargetType, targetId: string, requesterId: string, message?: string, requestedRole = 'editor') {
    const owner = ownerOf(targetType, targetId)
    if (!owner) throw { code: targetType === 'agent' ? 'AGENT_NOT_FOUND' : 'SCENE_NOT_FOUND', message: `${targetType} not found` }
    const now = Date.now()
    const existing = db.prepare(`
      SELECT id FROM template_permission_requests
      WHERE target_type = ? AND target_id = ? AND requester_id = ? AND status = 'pending'
      LIMIT 1
    `).get(targetType, targetId, requesterId) as any
    if (existing) {
      db.prepare('UPDATE template_permission_requests SET message = ?, requested_role = ?, updated_at = ? WHERE id = ?').run(message || null, normalizeRole(requestedRole), now, existing.id)
      return this.getRequest(existing.id)
    }
    const id = `perm_req_${uuidv4()}`
    db.prepare(`
      INSERT INTO template_permission_requests (id, target_type, target_id, requester_id, requested_role, message, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, targetType, targetId, requesterId, normalizeRole(requestedRole), message || null, now, now)
    return this.getRequest(id)
  }

  getRequest(id: string) {
    return db.prepare(`
      SELECT r.id, r.target_type as targetType, r.target_id as targetId, r.requester_id as requesterId,
             r.requested_role as requestedRole, r.message, r.status, r.resolved_by as resolvedBy,
             r.resolved_at as resolvedAt, r.created_at as createdAt, r.updated_at as updatedAt,
             u.username, u.nickname, u.avatar
      FROM template_permission_requests r
      LEFT JOIN users u ON u.id = r.requester_id
      WHERE r.id = ?
    `).get(id) as any
  }

  listRequestsForTarget(targetType: TemplateTargetType, targetId: string) {
    return db.prepare(`
      SELECT r.id, r.target_type as targetType, r.target_id as targetId, r.requester_id as requesterId,
             r.requested_role as requestedRole, r.message, r.status, r.resolved_by as resolvedBy,
             r.resolved_at as resolvedAt, r.created_at as createdAt, r.updated_at as updatedAt,
             u.username, u.nickname, u.avatar
      FROM template_permission_requests r
      LEFT JOIN users u ON u.id = r.requester_id
      WHERE r.target_type = ? AND r.target_id = ?
      ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
    `).all(targetType, targetId) as any[]
  }

  resolveRequest(requestId: string, actor: { id: string; role?: string }, decision: 'approve' | 'reject') {
    const request = this.getRequest(requestId)
    if (!request) throw { code: 'REQUEST_NOT_FOUND', message: 'Permission request not found' }
    if (request.status !== 'pending') throw { code: 'VALIDATION_ERROR', message: 'Request is not pending' }
    if (!this.canManage(request.targetType, request.targetId, actor)) throw { code: 'FORBIDDEN', message: 'Only owner/admin can resolve permission requests' }
    const now = Date.now()
    if (decision === 'approve') this.grant(request.targetType, request.targetId, actor, request.requesterId, request.requestedRole)
    db.prepare('UPDATE template_permission_requests SET status = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?')
      .run(decision === 'approve' ? 'approved' : 'rejected', actor.id, now, now, requestId)
    return this.getRequest(requestId)
  }
}

export const templatePermissionService = new TemplatePermissionService()
