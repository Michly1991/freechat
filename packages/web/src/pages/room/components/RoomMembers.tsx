import { useEffect, useState } from 'react'
import { Bot, Plus, ShieldCheck, UserRound, Wrench, X } from 'lucide-react'
import { api } from '../../../lib/api'
import { AgentRow } from './AgentRow'
import { getAgentStatusDotClass, getAgentStatusLabel, getMemberAvatar, getMemberDisplayName, renderAgentAvatar, renderAvatar } from '../room-ui-utils'

function AddContactMembers({ roomId, members, feedback, onMembersChanged, compact = false }: any) {
  const [open, setOpen] = useState(false)
  const [friends, setFriends] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    api.getFriends().then((data) => setFriends(data.friends || [])).catch((err) => feedback?.error?.(err?.message || '加载通讯录失败')).finally(() => setLoading(false))
  }, [open])

  const addMember = async (userId: string) => {
    if (!roomId) return
    try {
      await api.addRoomMember(roomId, userId, 'editor')
      feedback?.success?.('通讯录成员已添加到项目')
      onMembersChanged?.()
      setFriends((items) => [...items])
    } catch (err: any) {
      feedback?.error?.(err?.message || '添加成员失败')
    }
  }

  return <div className={compact ? 'mb-3' : 'mb-4'}>
    <button onClick={() => setOpen(!open)} className={`${compact ? 'w-full justify-center py-2' : 'w-full justify-between py-2'} flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 text-sm font-medium text-blue-600 hover:bg-blue-100`}>
      <span className="inline-flex items-center gap-2"><Plus className="w-4 h-4" />添加通讯录成员</span>
      {!compact && <span className="text-xs text-blue-400">{open ? '收起' : '展开'}</span>}
    </button>
    {open && <div className="mt-2 rounded-xl border border-gray-100 bg-gray-50 p-2 space-y-2">
      {loading && <p className="text-xs text-gray-400 px-1 py-2">加载通讯录...</p>}
      {!loading && friends.length === 0 && <p className="text-xs text-gray-400 px-1 py-2">通讯录暂无成员。</p>}
      {!loading && friends.map((friend) => {
        const friendId = friend.id || friend.userId || friend.friendId
        const already = members.some((member: any) => (member.id || member.userId) === friendId)
        return <div key={friendId} className="flex items-center justify-between gap-2 rounded-lg bg-white border border-gray-100 p-2">
          <div className="flex items-center gap-2 min-w-0">
            {friend.avatar ? <img src={friend.avatar} alt="头像" className="w-8 h-8 rounded-full object-cover border border-gray-200" /> : <span className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-xs font-semibold">{(friend.nickname || friend.username || '?')[0].toUpperCase()}</span>}
            <div className="min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{friend.nickname || friend.username || '未命名用户'}</p>{friend.username && <p className="text-xs text-gray-400 truncate">@{friend.username}</p>}</div>
          </div>
          {already ? <span className="text-xs text-gray-400 shrink-0">已在项目</span> : <button onClick={() => addMember(friendId)} className="text-xs text-blue-600 hover:text-blue-700 shrink-0">添加</button>}
        </div>
      })}
    </div>}
  </div>
}

export function DesktopMembersPanel({ showMembers, setShowMembers, members, roomAgents, openMemberProfile, restartAgent, roomId, feedback, onMembersChanged }: any) {
  if (!showMembers) return null
  return <div className="order-first w-64 border-r border-gray-200 bg-white overflow-y-auto shrink-0 hidden md:block relative"><button onClick={() => setShowMembers(false)} className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-12 rounded-full bg-white border border-gray-200 shadow-sm text-gray-400 hover:text-blue-600 flex items-center justify-center" title="收起成员面板">‹</button><div className="p-4"><h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center justify-between">房间成员<span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{members.length}</span></h3><AddContactMembers roomId={roomId} members={members} feedback={feedback} onMembersChanged={onMembersChanged} /><div className="space-y-1">{members.map((member: any) => <button key={member.id || member.userId} type="button" onClick={() => openMemberProfile(member, 'member')} className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-blue-50 transition-colors text-left"><div className="relative">{renderAvatar(getMemberDisplayName(member), getMemberAvatar(member), 'w-9 h-9')}<div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 border-2 border-white rounded-full"></div></div><div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{getMemberDisplayName(member)}</p><p className="text-xs text-gray-400 truncate">{member.username && member.username !== getMemberDisplayName(member) ? `@${member.username}` : '在线'}</p></div></button>)}</div>{roomAgents.length > 0 && <><h3 className="text-sm font-semibold text-gray-700 mt-6 mb-4 flex items-center justify-between">AI Agents<span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{roomAgents.length}</span></h3><div className="space-y-1">{roomAgents.map((agent: any) => <AgentRow key={agent.id} agent={agent} openMemberProfile={openMemberProfile} restartAgent={restartAgent} />)}</div></>}</div></div>
}

export function MobileMembersDrawer({ showMobileMembers, setShowMobileMembers, members, roomAgents, openMemberProfile, restartAgent, roomId, feedback, onMembersChanged }: any) {
  if (!showMobileMembers) return null
  return <div className="md:hidden fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setShowMobileMembers(false)}><div className="w-full max-w-md bg-white rounded-t-3xl max-h-[82vh] overflow-y-auto animate-slideUp shadow-2xl" onClick={(e) => e.stopPropagation()}><div className="sticky top-0 fc-mobile-glass bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between rounded-t-3xl z-10"><div><h3 className="font-semibold text-gray-800">成员与 AI</h3><p className="text-xs text-gray-400">成员 {members.length} · Agent {roomAgents.length}</p></div><button onClick={() => setShowMobileMembers(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100"><X className="w-5 h-5" /></button></div><div className="p-4 space-y-2"><AddContactMembers roomId={roomId} members={members} feedback={feedback} onMembersChanged={onMembersChanged} compact /><h4 className="px-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">在线成员</h4>{members.map((member: any) => <button key={member.id || member.userId} type="button" onClick={() => openMemberProfile(member, 'member')} className="fc-pressable w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-blue-50 transition-colors text-left active:bg-blue-100/70"><div className="relative">{renderAvatar(getMemberDisplayName(member), getMemberAvatar(member), 'w-11 h-11')}<div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-400 border-2 border-white rounded-full"></div></div><div className="flex-1"><p className="font-medium text-gray-800">{getMemberDisplayName(member)}</p><p className="text-sm text-gray-400">{member.username && member.username !== getMemberDisplayName(member) ? `@${member.username}` : '在线'}</p></div></button>)}{roomAgents.length > 0 && <><h4 className="px-1 pt-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">AI Agents</h4>{roomAgents.map((agent: any) => <AgentRow key={agent.id} agent={agent} openMemberProfile={openMemberProfile} restartAgent={restartAgent} mobile />)}</>}</div></div></div>
}

export function ProfileModal({ selectedProfile, setSelectedProfile, restartAgent }: any) {
  if (!selectedProfile) return null
  return <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => setSelectedProfile(null)}><div className="fc-sheet-pop w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-2xl shadow-xl p-5" onClick={(e) => e.stopPropagation()}><div className="flex items-start justify-between mb-4"><div className="flex items-center gap-3 min-w-0">{selectedProfile.kind === 'agent' ? renderAgentAvatar(selectedProfile, 'w-14 h-14', 'w-7 h-7') : renderAvatar(selectedProfile.name, selectedProfile.avatar, 'w-14 h-14')}<div className="min-w-0"><p className="font-semibold text-gray-800 truncate">{selectedProfile.name}</p><p className="text-sm text-gray-400 truncate">{selectedProfile.subtitle}</p></div></div><button onClick={() => setSelectedProfile(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100"><X className="w-5 h-5" /></button></div><div className="space-y-2 text-sm"><div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2"><span className="text-gray-500">类型</span><span className="font-medium text-gray-700 inline-flex items-center gap-1">{selectedProfile.kind === 'agent' ? <Bot className="w-4 h-4" /> : <UserRound className="w-4 h-4" />}{selectedProfile.kind === 'agent' ? 'AI Agent' : '项目成员'}</span></div><div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2"><span className="text-gray-500">状态</span><span className="font-medium text-gray-700 inline-flex items-center gap-1.5">{selectedProfile.kind === 'agent' && <span className={`w-2 h-2 rounded-full ${getAgentStatusDotClass(selectedProfile)}`}></span>}{selectedProfile.status}</span></div>{selectedProfile.kind === 'agent' && <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2"><span className="text-gray-500">角色</span><span className="font-medium text-gray-700 inline-flex items-center gap-1">{selectedProfile.roleType === 'assistant' ? <ShieldCheck className="w-4 h-4" /> : <Wrench className="w-4 h-4" />}{selectedProfile.roleType === 'assistant' ? '助理' : '专家'}</span></div>}{selectedProfile.specialties?.length > 0 && <div className="flex flex-wrap gap-1.5 pt-1">{selectedProfile.specialties.map((s: string) => <span key={s} className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-full">{s}</span>)}</div>}{selectedProfile.kind === 'agent' && <button onClick={() => restartAgent?.(selectedProfile)} className="mt-2 w-full rounded-xl bg-blue-50 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-100">软重启 Agent</button>}</div></div></div>
}
