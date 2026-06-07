import db from '../storage/db.js'
import { writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { existsSync } from 'fs'
import { config } from '../config.js'
import type { RoomMember, Agent } from '@freechat/shared'

interface ProfileRow {
  room_id: string
  member_id: string
  member_type: string
  display_name: string | null
  role_description: string | null
  avatar: string | null
  custom_data: string | null
  created_at: number
  updated_at: number
}

interface MemberWithProfile extends RoomMember {
  display_name?: string
  role_description?: string
}

export class MembersService {
  /**
   * Get all profiles for a room
   */
  async getRoomProfiles(roomId: string): Promise<any[]> {
    const rows = db.prepare(`
      SELECT rp.*, 
             u.username, u.nickname, u.avatar as user_avatar,
             a.name as agent_name, a.description as agent_description
      FROM room_profiles rp
      LEFT JOIN users u ON rp.member_id = u.id AND rp.member_type = 'human'
      LEFT JOIN agents a ON rp.member_id = a.id AND rp.member_type = 'agent'
      WHERE rp.room_id = ?
      ORDER BY rp.updated_at DESC
    `).all(roomId) as any[]

    return rows.map(row => ({
      memberId: row.member_id,
      memberType: row.member_type,
      displayName: row.display_name,
      roleDescription: row.role_description,
      avatar: row.avatar || row.user_avatar,
      username: row.username,
      nickname: row.nickname,
      agentName: row.agent_name,
      agentDescription: row.agent_description,
      customData: row.custom_data ? JSON.parse(row.custom_data) : undefined,
      updatedAt: row.updated_at,
    }))
  }

  /**
   * Get or create a profile for a member
   */
  async getProfile(roomId: string, memberId: string): Promise<any> {
    const row = db.prepare(`
      SELECT * FROM room_profiles WHERE room_id = ? AND member_id = ?
    `).get(roomId, memberId) as ProfileRow | undefined

    if (!row) {
      // Return default profile
      const member = db.prepare(`
        SELECT rm.*, u.username, u.nickname, u.avatar
        FROM room_members rm
        LEFT JOIN users u ON rm.user_id = u.id
        WHERE rm.room_id = ? AND rm.user_id = ?
      `).get(roomId, memberId) as any

      if (!member) {
        throw { code: 'MEMBER_NOT_FOUND', message: 'Member not found in room' }
      }

      return {
        memberId,
        memberType: member.type || 'human',
        displayName: member.nickname,
        avatar: member.avatar,
        username: member.username,
      }
    }

    return {
      memberId: row.member_id,
      memberType: row.member_type,
      displayName: row.display_name,
      roleDescription: row.role_description,
      avatar: row.avatar,
      customData: row.custom_data ? JSON.parse(row.custom_data) : undefined,
      updatedAt: row.updated_at,
    }
  }

  /**
   * Set or update a profile
   */
  async setProfile(
    roomId: string,
    memberId: string,
    updates: {
      displayName?: string
      roleDescription?: string
      avatar?: string
      customData?: Record<string, any>
    }
  ): Promise<any> {
    const now = Date.now()
    const memberType = this.getMemberType(memberId)

    const existing = db.prepare(`
      SELECT * FROM room_profiles WHERE room_id = ? AND member_id = ?
    `).get(roomId, memberId) as ProfileRow | undefined

    if (existing) {
      const fields: string[] = []
      const values: any[] = []

      if (updates.displayName !== undefined) {
        fields.push('display_name = ?')
        values.push(updates.displayName)
      }
      if (updates.roleDescription !== undefined) {
        fields.push('role_description = ?')
        values.push(updates.roleDescription)
      }
      if (updates.avatar !== undefined) {
        fields.push('avatar = ?')
        values.push(updates.avatar)
      }
      if (updates.customData !== undefined) {
        fields.push('custom_data = ?')
        values.push(JSON.stringify(updates.customData))
      }

      if (fields.length > 0) {
        fields.push('updated_at = ?')
        values.push(now)
        values.push(roomId, memberId)

        db.prepare(`
          UPDATE room_profiles SET ${fields.join(', ')} WHERE room_id = ? AND member_id = ?
        `).run(...values)
      }
    } else {
      db.prepare(`
        INSERT INTO room_profiles (room_id, member_id, member_type, display_name, role_description, avatar, custom_data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        roomId,
        memberId,
        memberType,
        updates.displayName || null,
        updates.roleDescription || null,
        updates.avatar || null,
        updates.customData ? JSON.stringify(updates.customData) : null,
        now,
        now
      )
    }

    // Regenerate MEMBERS.md
    await this.updateMembersFile(roomId)

    return this.getProfile(roomId, memberId)
  }

  /**
   * Batch update profiles
   */
  async batchUpdateProfiles(
    roomId: string,
    profiles: Array<{
      memberId: string
      displayName?: string
      roleDescription?: string
      avatar?: string
      customData?: Record<string, any>
    }>
  ): Promise<void> {
    for (const profile of profiles) {
      await this.setProfile(roomId, profile.memberId, {
        displayName: profile.displayName,
        roleDescription: profile.roleDescription,
        avatar: profile.avatar,
        customData: profile.customData,
      })
    }
  }

  /**
   * Generate and write .freechat/MEMBERS.md for a room
   */
  async updateMembersFile(roomId: string): Promise<void> {
    const members = await this.getRoomMembersWithProfiles(roomId)
    const agents = await this.getRoomAgents(roomId)

    const lines: string[] = [
      '# Room Members',
      '',
      '## Humans',
      '',
    ]

    for (const member of members.filter(m => m.type === 'human')) {
      const displayName = member.display_name || member.nickname
      const role = member.role_description || member.role
      lines.push(`- **${displayName}** (@${member.username}) - ${role}`)
    }

    lines.push('')
    lines.push('## Agents')
    lines.push('')

    for (const agent of agents) {
      const profile = members.find(m => m.user_id === agent.id)
      const displayName = profile?.display_name || agent.name
      const description = profile?.role_description || agent.description || 'No description'
      lines.push(`- **${displayName}** - ${description}`)
    }

    const content = lines.join('\n')
    const workspaceDir = join(config.workspace.root, roomId)
    const freechatDir = join(workspaceDir, '.freechat')
    const membersFile = join(freechatDir, 'MEMBERS.md')

    if (!existsSync(freechatDir)) {
      await mkdir(freechatDir, { recursive: true })
    }

    await writeFile(membersFile, content, 'utf-8')
  }

  /**
   * Get room members with their profiles
   */
  private async getRoomMembersWithProfiles(roomId: string): Promise<any[]> {
    return db.prepare(`
      SELECT rm.*, u.username, u.nickname, u.avatar as user_avatar,
             rp.display_name, rp.role_description
      FROM room_members rm
      INNER JOIN users u ON rm.user_id = u.id
      LEFT JOIN room_profiles rp ON rm.room_id = rp.room_id AND rm.user_id = rp.member_id
      WHERE rm.room_id = ? AND rm.type = 'human'
      ORDER BY rm.joined_at ASC
    `).all(roomId) as any[]
  }

  /**
   * Get room agents
   */
  private async getRoomAgents(roomId: string): Promise<Agent[]> {
    const rows = db.prepare(`
      SELECT a.* FROM agents a
      INNER JOIN room_agents ra ON a.id = ra.agent_id
      WHERE ra.room_id = ?
      ORDER BY ra.added_at ASC
    `).all(roomId) as any[]

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      roleType: row.role_type,
      deployment: row.deployment,
      description: row.description,
      specialties: row.specialties ? JSON.parse(row.specialties) : undefined,
      config: row.config ? JSON.parse(row.config) : undefined,
      status: row.status,
    }))
  }

  /**
   * Determine if a member_id is a human or agent
   */
  private getMemberType(memberId: string): string {
    const agent = db.prepare('SELECT id FROM agents WHERE id = ?').get(memberId)
    return agent ? 'agent' : 'human'
  }
}

export const membersService = new MembersService()
