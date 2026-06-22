import { getAgentOnlineStatus, getAgentStatusLabel, getMemberAvatar, getMemberDisplayName, renderAgentAvatar, renderAvatar } from './room-ui-utils'
import type { Message } from '../room-page-model'

interface ProfileDeps {
  members: any[]
  roomAgents: any[]
  setSelectedProfile: (value: any | null) => void
}

export function createRoomProfileController({ members, roomAgents, setSelectedProfile }: ProfileDeps) {
  const getActorMember = (msg: Message) => members.find((m) => (m.userId || m.id) === msg.actorId)
  const getActorAgent = (msg: Message) => roomAgents.find((a) => a.id === msg.actorId || a.name === msg.actorName)
  const getActorAvatar = (msg: Message) => getActorMember(msg)?.avatar || ''

  const openMemberProfile = (target: any, kind: 'member' | 'agent') => {
    if (kind === 'member') {
      setSelectedProfile({
        kind,
        name: getMemberDisplayName(target),
        username: target.username,
        avatar: getMemberAvatar(target),
        subtitle: target.username ? `@${target.username}` : '项目成员',
        status: '在线',
        roomRole: target.role,
        identityType: target.identityType || target.type,
      })
    } else {
      setSelectedProfile({
        kind,
        id: target.id,
        name: target.name,
        subtitle: 'Agent',
        roleType: target.roleType,
        status: getAgentStatusLabel(target),
        onlineStatus: getAgentOnlineStatus(target),
        specialties: target.specialties || [],
      })
    }
  }

  const renderAssigneeBadge = (item: any, compact = false) => {
    if (!item?.assigneeName) return null
    const labelClass = compact ? 'text-[10px] text-gray-400 gap-1.5' : 'text-xs text-gray-400 gap-1.5'
    const avatarSize = compact ? 'w-4 h-4' : 'w-5 h-5'
    const iconSize = compact ? 'w-2.5 h-2.5' : 'w-3 h-3'
    if (item.assigneeType === 'agent') {
      const agent = roomAgents.find((a) => a.id === item.assigneeId || a.name === item.assigneeName) || {
        name: item.assigneeName,
        roleType: item.assigneeName.includes('助理') ? 'assistant' : 'specialist',
        status: 'active',
      }
      return <span className={`inline-flex items-center ${labelClass}`}>{renderAgentAvatar(agent, avatarSize, iconSize)}<span>{item.assigneeName}</span></span>
    }
    const member = members.find((m) => (m.userId || m.id) === item.assigneeId || getMemberDisplayName(m) === item.assigneeName)
    return <span className={`inline-flex items-center ${labelClass}`}>{renderAvatar(item.assigneeName, member?.avatar, avatarSize)}<span>{item.assigneeName}</span></span>
  }

  return { getActorMember, getActorAgent, getActorAvatar, openMemberProfile, renderAssigneeBadge }
}
