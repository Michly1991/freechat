import { useEffect, useMemo, useState } from 'react'
import { Bot, Crown, Plus, ShieldCheck, UserRound, X } from 'lucide-react'
import { api } from '../../../lib/api'
import { AgentRow } from './AgentRow'
import { getAgentStatusDotClass, getAgentStatusLabel, getMemberAvatar, getMemberDisplayName, renderAgentAvatar, renderAvatar } from '../room-ui-utils'

type RoomMemberRole = 'owner' | 'editor' | 'viewer' | string

const roleRank: Record<string, number> = { owner: 0, editor: 1, viewer: 2 }

function memberRoleLabel(role?: RoomMemberRole) {
  if (role === 'owner') return '管理员'
  if (role === 'editor') return '协作者'
  if (role === 'viewer') return '只读'
  return '成员'
}

function memberRoleBadgeClass(role?: RoomMemberRole) {
  if (role === 'owner') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (role === 'editor') return 'border-emerald-100 bg-emerald-50 text-emerald-600'
  if (role === 'viewer') return 'border-gray-200 bg-gray-50 text-gray-500'
  return 'border-blue-100 bg-blue-50 text-blue-600'
}

function sortedMembers(members: any[]) {
  return [...members].sort((a, b) => {
    const ar = roleRank[a.role] ?? 9
    const br = roleRank[b.role] ?? 9
    if (ar !== br) return ar - br
    return getMemberDisplayName(a).localeCompare(getMemberDisplayName(b), 'zh-CN')
  })
}

function MemberRoleBadge({ role, compact = false }: { role?: RoomMemberRole; compact?: boolean }) {
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 ${compact ? 'text-[10px]' : 'text-[11px]'} font-medium ${memberRoleBadgeClass(role)}`}>
    {role === 'owner' && <Crown className="w-3 h-3" />}
    {memberRoleLabel(role)}
  </span>
}

function IdentityBadge({ identityType, compact = false }: { identityType?: string; compact?: boolean }) {
  const isAgent = identityType === 'agent'
  return <span className={`inline-flex shrink-0 rounded-full px-1.5 py-0.5 ${compact ? 'text-[10px]' : 'text-[11px]'} font-medium ${isAgent ? 'bg-violet-50 text-violet-600' : 'bg-gray-100 text-gray-500'}`}>{isAgent ? 'Agent' : '真人'}</span>
}

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
      feedback?.success?.('通讯录成员已添加到群聊')
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
            <div className="min-w-0"><p className="flex items-center gap-1 text-sm font-medium text-gray-800"><span className="truncate">{friend.nickname || friend.username || '未命名用户'}</span><IdentityBadge identityType={friend.identityType} compact /></p>{friend.username && <p className="text-xs text-gray-400 truncate">@{friend.username}</p>}</div>
          </div>
          {already ? <span className="text-xs text-gray-400 shrink-0">已在群聊</span> : <button onClick={() => addMember(friendId)} className="text-xs text-blue-600 hover:text-blue-700 shrink-0">添加</button>}
        </div>
      })}
    </div>}
  </div>
}

function AddAvailableAgents({ roomId, roomAgents, feedback, onMembersChanged, compact = false }: any) {
  const [open, setOpen] = useState(false)
  const [agents, setAgents] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    api.getAgents().then((data) => setAgents((data.agents || []).filter((agent: any) => agent.canUse))).catch((err) => feedback?.error?.(err?.message || '加载 Agent 失败')).finally(() => setLoading(false))
  }, [open])

  const addAgent = async (agent: any, asAssistant = false) => {
    if (!roomId) return
    try {
      if (!agent.isOwner) {
        const ok = feedback?.confirm ? await feedback.confirm({ title: '启用收费 Agent？', message: `「${agent.name}」按 token 收取 Agent 服务费，实际运行时会扣除 credit。确认添加到群聊？`, confirmText: '确认添加' }) : window.confirm(`「${agent.name}」按 token 收取 Agent 服务费，实际运行时会扣除 credit。确认添加到群聊？`)
        if (!ok) return
      }
      await api.addRoomAgent(roomId, agent.id, { roomRole: asAssistant ? 'assistant' : 'specialist', autoEnabled: asAssistant })
      feedback?.success?.('Agent 已添加到群聊')
      onMembersChanged?.()
      const data = await api.getAgents()
      setAgents((data.agents || []).filter((item: any) => item.canUse))
    } catch (err: any) {
      feedback?.error?.(err?.message || '添加 Agent 失败')
    }
  }

  return <div className={compact ? 'mb-3' : 'mb-4'}>
    <button onClick={() => setOpen(!open)} className={`${compact ? 'w-full justify-center py-2' : 'w-full justify-between py-2'} flex items-center gap-2 rounded-xl border border-violet-100 bg-violet-50 px-3 text-sm font-medium text-violet-600 hover:bg-violet-100`}>
      <span className="inline-flex items-center gap-2"><Plus className="w-4 h-4" />添加 Agent</span>
      {!compact && <span className="text-xs text-violet-400">{open ? '收起' : '展开'}</span>}
    </button>
    {open && <div className="mt-2 rounded-xl border border-gray-100 bg-gray-50 p-2 space-y-2">
      {loading && <p className="text-xs text-gray-400 px-1 py-2">加载 Agent...</p>}
      {!loading && agents.length === 0 && <p className="text-xs text-gray-400 px-1 py-2">暂无可用 Agent，请先去市场关注或在通讯录创建。</p>}
      {!loading && agents.map((agent) => {
        const already = roomAgents.some((item: any) => item.id === agent.id || item.sourceTemplateId === agent.id)
        return <div key={agent.id} className="rounded-lg bg-white border border-gray-100 p-2 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{agent.name}</p>{agent.description && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{agent.description}</p>}</div>
            {already ? <span className="text-xs text-gray-400 shrink-0">已在群聊</span> : <div className="flex flex-col gap-1 shrink-0"><button onClick={() => addAgent(agent, false)} className="text-xs text-green-600 hover:text-green-700">添加</button><button onClick={() => addAgent(agent, true)} className="text-xs text-blue-600 hover:text-blue-700">设为协调</button></div>}
          </div>
        </div>
      })}
    </div>}
  </div>
}

function MemberListItem({ member, room, openMemberProfile, mobile = false }: any) {
  const memberId = member.userId || member.id
  const isPayer = room?.createdBy && memberId === room.createdBy
  return <button key={member.id || member.userId} type="button" onClick={() => openMemberProfile(member, 'member')} className={`${mobile ? 'fc-pressable p-3 rounded-2xl active:bg-blue-100/70' : 'p-2 rounded-lg'} w-full flex items-center gap-3 hover:bg-blue-50 transition-colors text-left`}>
    <div className="relative">
      {renderAvatar(getMemberDisplayName(member), getMemberAvatar(member), mobile ? 'w-11 h-11' : 'w-9 h-9')}
      <div className={`${mobile ? 'w-3.5 h-3.5' : 'w-3 h-3'} absolute -bottom-0.5 -right-0.5 bg-green-400 border-2 border-white rounded-full`} />
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <p className={`${mobile ? 'font-medium' : 'text-sm font-medium'} text-gray-800 truncate`}>{getMemberDisplayName(member)}</p>
        <IdentityBadge identityType={member.identityType || member.type} compact={!mobile} />
        <MemberRoleBadge role={member.role} compact={!mobile} />
        {isPayer && <span className={`inline-flex shrink-0 items-center rounded-full border border-blue-100 bg-blue-50 px-1.5 py-0.5 ${mobile ? 'text-[11px]' : 'text-[10px]'} font-medium text-blue-600`}>付费人</span>}
      </div>
      <p className={`${mobile ? 'text-sm' : 'text-xs'} text-gray-400 truncate`}>{isPayer ? '可指挥 Agent · 费用由其承担' : (member.username && member.username !== getMemberDisplayName(member) ? `@${member.username}` : '可参与讨论')}</p>
    </div>
  </button>
}

export function DesktopMembersPanel({ showMembers, setShowMembers, members, roomAgents, openMemberProfile, restartAgent, openModelConfig, roomId, room, feedback, onMembersChanged }: any) {
  const orderedMembers = useMemo(() => sortedMembers(members), [members])
  const admins = orderedMembers.filter((member: any) => member.role === 'owner')
  const payer = orderedMembers.find((member: any) => (member.userId || member.id) === room?.createdBy)
  const handoffAgent = async (agent: any) => { if (!roomId) return; try { await api.handoffRoomAssistant(roomId, agent.id, `手动切换当前协调者为 ${agent.name}`); feedback?.success?.(`已切换当前协调者为 ${agent.name}`); onMembersChanged?.() } catch (err: any) { feedback?.error?.(err?.message || '切换协调者失败') } }
  const removeAgent = async (agent: any) => {
    if (!roomId) return
    const ok = feedback?.confirm ? await feedback.confirm({ title: '移除 Agent？', message: `确认把「${agent.name}」从当前群聊移除？不会删除通讯录里的 Agent。`, confirmText: '确认移除' }) : window.confirm(`确认把「${agent.name}」从当前群聊移除？不会删除通讯录里的 Agent。`)
    if (!ok) return
    try { await api.removeRoomAgent(roomId, agent.id); feedback?.success?.('Agent 已从群聊移除'); onMembersChanged?.() } catch (err: any) { feedback?.error?.(err?.message || '移除 Agent 失败') }
  }
  if (!showMembers) return null
  return <div className="order-first w-64 border-r border-gray-200 bg-white overflow-y-auto shrink-0 hidden md:block relative">
    <button onClick={() => setShowMembers(false)} className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-12 rounded-full bg-white border border-gray-200 shadow-sm text-gray-400 hover:text-blue-600 flex items-center justify-center" title="收起成员面板">‹</button>
    <div className="p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center justify-between">房间成员<span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{members.length}</span></h3>
      {admins.length > 0 && <p className="mb-2 flex items-center gap-1.5 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700"><Crown className="w-3.5 h-3.5" />管理员：{admins.map(getMemberDisplayName).join('、')}</p>}
      {payer && <p className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">付费人 / 可指挥 Agent：{getMemberDisplayName(payer)}</p>}
      <AddContactMembers roomId={roomId} members={members} feedback={feedback} onMembersChanged={onMembersChanged} />
      <AddAvailableAgents roomId={roomId} roomAgents={roomAgents} feedback={feedback} onMembersChanged={onMembersChanged} />
      <div className="space-y-1">{orderedMembers.map((member: any) => <MemberListItem key={member.id || member.userId} member={member} room={room} openMemberProfile={openMemberProfile} />)}</div>
      {roomAgents.length > 0 && <><h3 className="text-sm font-semibold text-gray-700 mt-6 mb-4 flex items-center justify-between">AI Agents<span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{roomAgents.length}</span></h3><div className="space-y-1">{roomAgents.map((agent: any) => <AgentRow key={agent.id} agent={agent} room={room} openMemberProfile={openMemberProfile} restartAgent={restartAgent} openModelConfig={openModelConfig} removeAgent={removeAgent} handoffAgent={handoffAgent} />)}</div></>}
    </div>
  </div>
}

export function MobileMembersDrawer({ showMobileMembers, setShowMobileMembers, members, roomAgents, openMemberProfile, restartAgent, openModelConfig, roomId, room, feedback, onMembersChanged }: any) {
  const orderedMembers = useMemo(() => sortedMembers(members), [members])
  const admins = orderedMembers.filter((member: any) => member.role === 'owner')
  const payer = orderedMembers.find((member: any) => (member.userId || member.id) === room?.createdBy)
  const handoffAgent = async (agent: any) => { if (!roomId) return; try { await api.handoffRoomAssistant(roomId, agent.id, `手动切换当前协调者为 ${agent.name}`); feedback?.success?.(`已切换当前协调者为 ${agent.name}`); onMembersChanged?.() } catch (err: any) { feedback?.error?.(err?.message || '切换协调者失败') } }
  const removeAgent = async (agent: any) => {
    if (!roomId) return
    const ok = feedback?.confirm ? await feedback.confirm({ title: '移除 Agent？', message: `确认把「${agent.name}」从当前群聊移除？不会删除通讯录里的 Agent。`, confirmText: '确认移除' }) : window.confirm(`确认把「${agent.name}」从当前群聊移除？不会删除通讯录里的 Agent。`)
    if (!ok) return
    try { await api.removeRoomAgent(roomId, agent.id); feedback?.success?.('Agent 已从群聊移除'); onMembersChanged?.() } catch (err: any) { feedback?.error?.(err?.message || '移除 Agent 失败') }
  }
  if (!showMobileMembers) return null
  return <div className="md:hidden fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setShowMobileMembers(false)}>
    <div className="w-full max-w-md bg-white rounded-t-3xl max-h-[82vh] overflow-y-auto animate-slideUp shadow-2xl" onClick={(e) => e.stopPropagation()}>
      <div className="sticky top-0 fc-mobile-glass bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between rounded-t-3xl z-10"><div><h3 className="font-semibold text-gray-800">成员与 AI</h3><p className="text-xs text-gray-400">成员 {members.length} · Agent {roomAgents.length}</p></div><button onClick={() => setShowMobileMembers(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100"><X className="w-5 h-5" /></button></div>
      <div className="p-4 space-y-2">
        {admins.length > 0 && <p className="flex items-center gap-1.5 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700"><Crown className="w-4 h-4" />管理员：{admins.map(getMemberDisplayName).join('、')}</p>}
        {payer && <p className="rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">付费人 / 可指挥 Agent：{getMemberDisplayName(payer)}</p>}
        <AddContactMembers roomId={roomId} members={members} feedback={feedback} onMembersChanged={onMembersChanged} compact />
        <AddAvailableAgents roomId={roomId} roomAgents={roomAgents} feedback={feedback} onMembersChanged={onMembersChanged} compact />
        <h4 className="px-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">在线成员</h4>
        {orderedMembers.map((member: any) => <MemberListItem key={member.id || member.userId} member={member} room={room} openMemberProfile={openMemberProfile} mobile />)}
        {roomAgents.length > 0 && <><h4 className="px-1 pt-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">AI Agents</h4>{roomAgents.map((agent: any) => <AgentRow key={agent.id} agent={agent} room={room} openMemberProfile={openMemberProfile} restartAgent={restartAgent} openModelConfig={openModelConfig} removeAgent={removeAgent} handoffAgent={handoffAgent} mobile />)}</>}
      </div>
    </div>
  </div>
}

export function ProfileModal({ selectedProfile, setSelectedProfile, restartAgent }: any) {
  if (!selectedProfile) return null
  return <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => setSelectedProfile(null)}>
    <div className="fc-sheet-pop w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-2xl shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start justify-between mb-4"><div className="flex items-center gap-3 min-w-0">{selectedProfile.kind === 'agent' ? renderAgentAvatar(selectedProfile, 'w-14 h-14', 'w-7 h-7') : renderAvatar(selectedProfile.name, selectedProfile.avatar, 'w-14 h-14')}<div className="min-w-0"><p className="font-semibold text-gray-800 truncate">{selectedProfile.name}</p><p className="text-sm text-gray-400 truncate">{selectedProfile.subtitle}</p></div></div><button onClick={() => setSelectedProfile(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100"><X className="w-5 h-5" /></button></div>
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2"><span className="text-gray-500">类型</span><span className="font-medium text-gray-700 inline-flex items-center gap-1">{selectedProfile.kind === 'agent' ? <Bot className="w-4 h-4" /> : <UserRound className="w-4 h-4" />}{selectedProfile.kind === 'agent' ? 'AI Agent' : '项目成员'}</span></div>
        <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2"><span className="text-gray-500">状态</span><span className="font-medium text-gray-700 inline-flex items-center gap-1.5">{selectedProfile.kind === 'agent' && <span className={`w-2 h-2 rounded-full ${getAgentStatusDotClass(selectedProfile)}`}></span>}{selectedProfile.status}</span></div>
        {selectedProfile.kind === 'member' && <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2"><span className="text-gray-500">身份</span><IdentityBadge identityType={selectedProfile.identityType || selectedProfile.type} /></div>}
        {selectedProfile.kind === 'member' && <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2"><span className="text-gray-500">房间角色</span><MemberRoleBadge role={selectedProfile.roomRole} /></div>}
        {selectedProfile.kind === 'agent' && <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2"><span className="text-gray-500">房间状态</span><span className="font-medium text-gray-700 inline-flex items-center gap-1"><ShieldCheck className="w-4 h-4" />{selectedProfile.autoEnabled ? '当前协调者' : '可响应'}</span></div>}
        {selectedProfile.specialties?.length > 0 && <div className="flex flex-wrap gap-1.5 pt-1">{selectedProfile.specialties.map((s: string) => <span key={s} className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-full">{s}</span>)}</div>}
        {selectedProfile.kind === 'agent' && <button onClick={() => restartAgent?.(selectedProfile)} className="mt-2 w-full rounded-xl bg-blue-50 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-100">软重启 Agent</button>}
      </div>
    </div>
  </div>
}
