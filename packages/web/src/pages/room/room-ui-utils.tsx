import { Bot, Sparkles } from 'lucide-react'

export function getAgentOnlineStatus(agent: any) {
  return agent?.onlineStatus || (
    agent?.status === 'working' ? 'working' :
    agent?.status === 'inactive' ? 'offline' :
    agent?.status === 'error' ? 'error' : 'online'
  )
}

export function getAgentStatusLabel(agent: any) {
  const status = getAgentOnlineStatus(agent)
  if (status === 'working') return '工作中'
  if (status === 'offline') return '离线'
  if (status === 'error') return '异常'
  return '在线'
}

export function getAgentStatusDotClass(agent: any) {
  const status = getAgentOnlineStatus(agent)
  if (status === 'working') return 'bg-yellow-400 agent-breathing shadow-[0_0_0_4px_rgba(250,204,21,0.25)]'
  if (status === 'offline') return 'bg-gray-400'
  if (status === 'error') return 'bg-red-500'
  return 'bg-green-400'
}

export const getMemberDisplayName = (member: any) => member?.nickname || member?.username || member?.displayName || '未命名用户'
export const getMemberAvatar = (member: any) => member?.avatar || ''
export const getTabTitle = (tab: any) => tab?.title || tab?.name || '未命名'

export function renderAvatar(name: string, avatar?: string, size = 'w-9 h-9') {
  return avatar ? (
    <img src={avatar} alt={name} className={`${size} rounded-full object-cover border border-gray-200 shrink-0`} />
  ) : (
    <div className={`${size} rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-sm font-semibold shrink-0`}>
      {(name || '?')[0].toUpperCase()}
    </div>
  )
}

export function renderAgentAvatar(agent: any, size = 'w-9 h-9', iconSize = 'w-5 h-5') {
  const isAssistant = agent?.roleType === 'assistant'
  const Icon = isAssistant ? Sparkles : Bot
  const gradient = isAssistant ? 'from-violet-400 via-fuchsia-400 to-blue-500' : 'from-green-400 to-blue-500'
  return (
    <div className="relative shrink-0 fc-avatar-pop">
      <div className={`${size} bg-gradient-to-br ${gradient} rounded-full flex items-center justify-center text-white font-medium shadow-sm`}>
        <Icon className={iconSize} />
      </div>
      <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 border-2 border-white rounded-full ${getAgentStatusDotClass(agent)}`}></div>
    </div>
  )
}

export function renderMessageContent(content: string, isOwn = false) {
  const parts = content.split(/(@[^@\s]+)/g)
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      return <span key={i} className={`inline-block px-1 rounded text-xs font-medium ${isOwn ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-700'}`}>{part}</span>
    }
    return <span key={i}>{part}</span>
  })
}
