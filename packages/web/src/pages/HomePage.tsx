import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { api } from '../lib/api'
import { useFeedback } from '../components/FeedbackProvider'
import { BellOff, MessageCircle, Pin, Plus, Settings, Users, FolderKanban, Bot, Pencil, Trash2 } from 'lucide-react'
import { SwipeActionItem, type SwipeAction } from '../components/SwipeActionItem'

export default function HomePage() {
  const [rooms, setRooms] = useState<any[]>([])
  const [conversations, setConversations] = useState<any[]>([])
  const [friends, setFriends] = useState<any[]>([])
  const [agents, setAgents] = useState<any[]>([])
  const [contactKind, setContactKind] = useState<'people' | 'agents'>('people')
  const [showCreateAgent, setShowCreateAgent] = useState(false)
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
  const [agentForm, setAgentForm] = useState({
    name: '',
    roleType: 'assistant' as 'assistant' | 'specialist',
    description: '',
    specialties: '',
    systemPrompt: '',
    tools: { chat: true, task: true, file: true, tab: true, interaction: true, members: true },
  })
  const [friendRequests, setFriendRequests] = useState<{ received: any[]; sent: any[] }>({ received: [], sent: [] })
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([])
  const [selectedAgents, setSelectedAgents] = useState<{ agentId: string; autoEnabled: boolean }[]>([])
  const [activeHomeTab, setActiveHomeTab] = useState<'messages' | 'contacts' | 'settings'>('messages')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [showQuickActions, setShowQuickActions] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null)
  const navigate = useNavigate()
  const feedback = useFeedback()
  const { user, logout } = useAuthStore()

  useEffect(() => {
    loadHome()
  }, [])

  const loadHome = async () => {
    setLoading(true)
    await Promise.all([loadRooms(), loadFriends(), loadAgents(), loadFriendRequests(), loadConversations()])
    setLoading(false)
  }

  const loadRooms = async () => {
    try {
      const data = await api.getRooms()
      setRooms(data.rooms || [])
    } catch (err) {
      console.error(err)
    }
  }

  const loadConversations = async () => {
    try { const data = await api.getConversations(); setConversations(data.conversations || []) } catch (err) { console.error(err) }
  }

  const loadFriends = async () => {
    try { const data = await api.getFriends(); setFriends(data.friends || []) } catch (err) { console.error(err) }
  }

  const loadAgents = async () => {
    try { const data = await api.getAgents(); setAgents(data.agents || []) } catch (err) { console.error(err) }
  }

  const loadFriendRequests = async () => {
    try { const data = await api.getFriendRequests(); setFriendRequests({ received: data.received || [], sent: data.sent || [] }) } catch (err) { console.error(err) }
  }

  const searchUsers = async () => {
    if (!searchQ.trim()) return
    try { const data = await api.searchUsers(searchQ.trim()); setSearchResults(data.users || []) } catch (err: any) { feedback.error(err.message || '操作失败') }
  }

  const sendFriendRequest = async (targetUserId: string) => {
    try { await api.sendFriendRequest(targetUserId); feedback.success('好友申请已发送'); searchUsers(); loadFriendRequests() } catch (err: any) { feedback.error(err.message || '操作失败') }
  }

  const acceptFriendRequest = async (requestId: string) => {
    try { await api.acceptFriendRequest(requestId); loadFriends(); loadFriendRequests() } catch (err: any) { feedback.error(err.message || '操作失败') }
  }

  const rejectFriendRequest = async (requestId: string) => {
    try { await api.rejectFriendRequest(requestId); loadFriendRequests() } catch (err: any) { feedback.error(err.message || '操作失败') }
  }

  const openDm = async (friendId: string) => {
    try { const data = await api.openDm(friendId); navigate(`/dm/${data.conversation.id}`) } catch (err: any) { feedback.error(err.message || '操作失败') }
  }

  const emptyAgentForm = () => ({ name: '', roleType: 'assistant' as 'assistant' | 'specialist', description: '', specialties: '', systemPrompt: '', tools: { chat: true, task: true, file: true, tab: true, interaction: true, members: true } })

  const resetAgentEditor = () => {
    setEditingAgentId(null)
    setShowCreateAgent(false)
    setAgentForm(emptyAgentForm())
  }

  const openCreateAgent = () => {
    setEditingAgentId(null)
    setAgentForm(emptyAgentForm())
    setShowCreateAgent(true)
  }

  const openEditAgent = (agent: any) => {
    setEditingAgentId(agent.id)
    setAgentForm({
      name: agent.name || '',
      roleType: agent.roleType || 'specialist',
      description: agent.description || '',
      specialties: (agent.specialties || []).join(', '),
      systemPrompt: agent.config?.systemPrompt || '',
      tools: { chat: true, task: true, file: true, tab: true, interaction: true, members: true, ...(agent.config?.tools || {}) },
    })
    setShowCreateAgent(true)
  }

  const toggleAgentTool = (key: keyof typeof agentForm.tools) => {
    setAgentForm((prev) => ({ ...prev, tools: { ...prev.tools, [key]: !prev.tools[key] } }))
  }

  const createAgentFromContacts = async () => {
    const name = agentForm.name.trim()
    if (!name) { feedback.warning('请输入 Agent 名称'); return }
    try {
      const body = {
        name,
        roleType: agentForm.roleType,
        deployment: 'server' as const,
        description: agentForm.description,
        specialties: agentForm.specialties.split(',').map((s) => s.trim()).filter(Boolean),
        config: {
          systemPrompt: agentForm.systemPrompt,
          behavior: { replyMode: agentForm.roleType === 'assistant' ? 'auto_when_relevant' : 'mention_only', silentAllowed: true },
          tools: agentForm.tools,
        },
      }
      if (editingAgentId) {
        await api.updateAgent(editingAgentId, body)
        feedback.success('Agent 已更新')
      } else {
        await api.createAgent(body)
        feedback.success('Agent 已创建')
      }
      resetAgentEditor()
      loadAgents()
    } catch (err: any) { feedback.error(err.message || (editingAgentId ? '更新失败' : '创建失败')) }
  }

  const deleteAgentFromContacts = async (agent: any) => {
    const ok = await feedback.confirm({ title: '删除 Agent？', message: `确定删除「${agent.name}」吗？已加入项目的关联也会移除。`, confirmText: '删除', danger: true })
    if (!ok) return
    try { await api.deleteAgent(agent.id); feedback.success('Agent 已删除'); loadAgents() } catch (err: any) { feedback.error(err.message || '删除失败') }
  }

  const toggleConversationPref = async (conv: any, key: 'pinned' | 'muted' | 'hidden', e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      await api.updateConversationPrefs(conv.type, conv.id, { [key]: !conv[key] })
      if (key === 'pinned') feedback.success(conv.pinned ? '已取消置顶' : '已置顶')
      if (key === 'muted') feedback.success(conv.muted ? '已取消免打扰' : '已设为免打扰')
      if (key === 'hidden') feedback.success('会话已隐藏')
      loadConversations()
    } catch (err: any) { feedback.error(err.message || '操作失败') }
  }

  const hideConversation = async (conv: any) => {
    await toggleConversationPref(conv, 'hidden')
  }

  const deleteConversation = async (conv: any, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (conv.type === 'project') {
      await handleDeleteRoom(conv, e as any)
      return
    }
    const ok = await feedback.confirm({ title: '不显示这个私聊？', message: '当前会话会从消息列表隐藏，之后可从通讯录重新打开。', confirmText: '不显示', danger: true })
    if (!ok) return
    await api.updateConversationPrefs(conv.type, conv.id, { hidden: true })
    feedback.success('私聊已隐藏')
    loadConversations()
  }

  const getConversationActions = (conv: any): SwipeAction[] => [
    { label: conv.pinned ? '取消置顶' : '置顶', color: 'blue', onClick: () => toggleConversationPref(conv, 'pinned') },
    { label: '不显示', color: 'gray', onClick: () => hideConversation(conv) },
    { label: conv.type === 'project' ? '删除' : '隐藏', color: 'red', onClick: () => deleteConversation(conv) },
  ]

  const toggleSelectedFriend = (friendId: string) => {
    setSelectedFriendIds((prev) => prev.includes(friendId) ? prev.filter((id) => id !== friendId) : [...prev, friendId])
  }

  const toggleSelectedAgent = (agentId: string) => {
    setSelectedAgents((prev) => prev.some((a) => a.agentId === agentId) ? prev.filter((a) => a.agentId !== agentId) : [...prev, { agentId, autoEnabled: false }])
  }

  const setAgentAutoEnabled = (agentId: string, autoEnabled: boolean) => {
    setSelectedAgents((prev) => prev.map((a) => a.agentId === agentId ? { ...a, autoEnabled } : a))
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const result = await api.createRoom({
        name: newName,
        description: newDesc,
        memberIds: selectedFriendIds,
        agents: selectedAgents.map((a) => ({ agentId: a.agentId, roomRole: a.autoEnabled ? 'assistant' : 'specialist', autoEnabled: a.autoEnabled })),
      })
      setShowCreate(false)
      setNewName('')
      setNewDesc('')
      setSelectedFriendIds([])
      setSelectedAgents([])
      loadRooms()
      // 创建成功后跳转到房间
      if (result?.room?.id) {
        navigate(`/room/${result.room.id}`)
      }
    } catch (err: any) {
      console.error('创建失败:', err)
      feedback.error('创建失败: ' + (err.message || JSON.stringify(err)))
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault()
    const code = inviteCode.trim()
    if (!code) return

    try {
      setJoining(true)
      const result = await api.joinRoom(code)
      setShowJoin(false)
      setInviteCode('')
      if (result?.room?.id) {
        navigate(`/room/${result.room.id}`)
      } else {
        await loadRooms()
      }
    } catch (err: any) {
      feedback.error('加入失败: ' + (err.message || JSON.stringify(err)))
    } finally {
      setJoining(false)
    }
  }

  const handleDeleteRoom = async (room: any, e: React.MouseEvent) => {
    e?.stopPropagation()
    if (!room.canDelete && room.memberRole !== 'owner') {
      feedback.warning('你没有权限永久删除该项目')
      return
    }

    const ok = await feedback.confirm({ title: `永久删除项目「${room.name}」？`, message: '这会硬删除房间、消息、任务、标签页、邀请、文件和默认助理 Agent，删除后不可恢复。', confirmText: '永久删除', danger: true })
    if (!ok) return

    try {
      setDeletingId(room.id)
      await api.deleteRoom(room.id)
      feedback.success('项目已删除')
      setRooms((prev) => prev.filter((r) => r.id !== room.id))
      setConversations((prev) => prev.filter((conv) => !(conv.type === 'project' && conv.id === room.id)))
    } catch (err: any) {
      feedback.error('删除失败: ' + (err.message || JSON.stringify(err)))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-3 sm:px-4 py-3 sm:py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800">FreeChat</h1>
          <div className="flex items-center gap-3 sm:gap-4 relative">
            <button
              onClick={() => setShowQuickActions((v) => !v)}
              className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center text-xl leading-none hover:bg-blue-700"
              title="新建/加入"
            >
              <Plus className="w-5 h-5" />
            </button>
            {showQuickActions && (
              <div className="absolute right-0 top-11 w-40 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-20">
                <button
                  onClick={() => { setShowQuickActions(false); setShowJoin(true) }}
                  className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
                >
                  加入项目
                </button>
                <button
                  onClick={() => { setShowQuickActions(false); setShowCreate(true) }}
                  className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
                >
                  新建项目
                </button>
              </div>
            )}
            <button
              onClick={() => navigate('/settings')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-800"
            >
              {user?.avatar ? (
                <img src={user.avatar} alt="头像" className="w-8 h-8 rounded-full object-cover border border-gray-200" />
              ) : (
                <span className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-sm font-semibold">
                  {(user?.nickname || user?.username || '?')[0].toUpperCase()}
                </span>
              )}
              <span className="hidden sm:inline">{user?.nickname || user?.username}</span>
            </button>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-0 sm:px-4 py-0 sm:py-8 pb-20 sm:pb-8">
        <div className="hidden sm:flex bg-white rounded-xl border border-gray-200 p-1 mb-6 w-fit">
          <button
            onClick={() => setActiveHomeTab('messages')}
            className={`flex-1 sm:flex-none px-6 py-2 rounded-lg text-sm font-medium transition-colors ${activeHomeTab === 'messages' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
          >
            消息
          </button>
          <button
            onClick={() => setActiveHomeTab('contacts')}
            className={`flex-1 sm:flex-none px-6 py-2 rounded-lg text-sm font-medium transition-colors ${activeHomeTab === 'contacts' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
          >
            通讯录
          </button>
          <button
            onClick={() => setActiveHomeTab('settings')}
            className={`flex-1 sm:flex-none px-6 py-2 rounded-lg text-sm font-medium transition-colors ${activeHomeTab === 'settings' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
          >
            设置
          </button>
        </div>

        {activeHomeTab === 'messages' && (
          <section className="bg-white sm:rounded-xl sm:border border-gray-200 overflow-hidden mb-4 sm:mb-6">
            <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">消息</h2>
              <button onClick={loadConversations} className="text-xs text-gray-400 hover:text-gray-600">刷新</button>
            </div>
            {conversations.length === 0 ? (
              <div className="p-8 text-center text-gray-400">暂无会话，去通讯录找好友聊天，或创建一个项目</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {conversations.map((conv) => {
                  const item = (
                    <div onClick={() => openSwipeId === `${conv.type}-${conv.id}` ? setOpenSwipeId(null) : navigate(conv.targetPath)} className={`px-3 sm:px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-gray-50 active:bg-gray-100 ${conv.pinned ? 'bg-yellow-50/60' : 'bg-white'}`}>
                      {conv.type === 'dm' ? (
                        conv.avatar ? <img src={conv.avatar} className="w-12 h-12 rounded-full object-cover" /> : <span className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 text-white flex items-center justify-center font-semibold">{(conv.title || '?')[0].toUpperCase()}</span>
                      ) : (
                        <span className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-400 to-blue-500 text-white flex items-center justify-center"><FolderKanban className="w-6 h-6" /></span>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-800 truncate">{conv.title}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${conv.type === 'dm' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>{conv.type === 'dm' ? '私聊' : '项目'}</span>
                          {conv.pinned && <span className="text-[10px] text-yellow-600 inline-flex items-center gap-0.5"><Pin className="w-3 h-3" />置顶</span>}
                          {conv.muted && <span className="text-[10px] text-gray-400 inline-flex items-center gap-0.5"><BellOff className="w-3 h-3" />免打扰</span>}
                        </div>
                        <p className="text-sm text-gray-400 truncate mt-1">
                          {conv.lastMessage ? `${conv.lastMessage.actorName}: ${conv.lastMessage.content}` : conv.subtitle}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        {conv.unreadCount > 0 && <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${conv.muted ? 'bg-gray-200 text-gray-500' : 'bg-red-500 text-white'}`}>{conv.unreadCount > 99 ? '99+' : conv.unreadCount}</span>}
                        <div className="hidden sm:flex gap-2 text-xs text-gray-400">
                          <button onClick={(e) => toggleConversationPref(conv, 'pinned', e)}>{conv.pinned ? '取消置顶' : '置顶'}</button>
                          <button onClick={(e) => toggleConversationPref(conv, 'hidden', e)}>不显示</button>
                          <button disabled={deletingId === conv.id} onClick={(e) => deleteConversation(conv, e)} className="text-red-400 hover:text-red-600 disabled:opacity-60">{deletingId === conv.id ? '删除中...' : (conv.type === 'project' ? '删除' : '隐藏')}</button>
                        </div>
                        <span className="sm:hidden text-xs text-gray-300">左滑</span>
                      </div>
                    </div>
                  )
                  return (
                    <SwipeActionItem key={`${conv.type}-${conv.id}`} id={`${conv.type}-${conv.id}`} openId={openSwipeId} setOpenId={setOpenSwipeId} actions={getConversationActions(conv)}>
                      {item}
                    </SwipeActionItem>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {activeHomeTab === 'contacts' && (
        <section className="bg-white sm:rounded-xl sm:border border-gray-200 p-4 sm:p-5 mb-4 sm:mb-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-lg font-semibold text-gray-800">通讯录</h2>
            {contactKind === 'agents' && (
              <button onClick={() => showCreateAgent && !editingAgentId ? resetAgentEditor() : openCreateAgent()} className="inline-flex items-center gap-1 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700">
                <Plus className="w-4 h-4" /> 新建 Agent
              </button>
            )}
          </div>
          <div className="flex bg-gray-100 rounded-xl p-1 mb-4 w-fit">
            <button onClick={() => setContactKind('people')} className={`px-4 py-2 rounded-lg text-sm ${contactKind === 'people' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>人员</button>
            <button onClick={() => setContactKind('agents')} className={`px-4 py-2 rounded-lg text-sm ${contactKind === 'agents' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>Agent</button>
          </div>

          {contactKind === 'people' && (
            <>
              <div className="flex gap-2 mb-3">
                <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchUsers()} placeholder="搜索用户名/昵称添加好友" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                <button onClick={searchUsers} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">搜索</button>
              </div>
              {searchResults.length > 0 && (
                <div className="space-y-2 mb-4">
                  {searchResults.map((u) => (
                    <div key={u.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50">
                      <div className="flex items-center gap-2">
                        {u.avatar ? <img src={u.avatar} className="w-8 h-8 rounded-full object-cover" /> : <span className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs">{(u.nickname || u.username || '?')[0].toUpperCase()}</span>}
                        <span className="text-sm font-medium">{u.nickname || u.username}</span>
                        <span className="text-xs text-gray-400">@{u.username}</span>
                      </div>
                      {u.friendStatus === 'none' && <button onClick={() => sendFriendRequest(u.id)} className="text-xs text-blue-600 hover:text-blue-700">加好友</button>}
                      {u.friendStatus === 'friends' && <span className="text-xs text-green-600">已是好友</span>}
                      {u.friendStatus === 'pending_sent' && <span className="text-xs text-gray-400">已申请</span>}
                      {u.friendStatus === 'pending_received' && <span className="text-xs text-orange-500">待你处理</span>}
                      {u.friendStatus === 'self' && <span className="text-xs text-gray-400">自己</span>}
                    </div>
                  ))}
                </div>
              )}
              {friendRequests.received.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-medium text-gray-600 mb-2">好友申请</h3>
                  <div className="space-y-2">
                    {friendRequests.received.map((r) => (
                      <div key={r.id} className="flex items-center justify-between p-2 rounded-lg bg-orange-50">
                        <span className="text-sm">{r.user.nickname || r.user.username} 请求添加你为好友</span>
                        <div className="flex gap-2">
                          <button onClick={() => acceptFriendRequest(r.id)} className="text-xs text-green-600">同意</button>
                          <button onClick={() => rejectFriendRequest(r.id)} className="text-xs text-red-500">拒绝</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {friends.length === 0 ? <p className="text-sm text-gray-400">暂无好友，先搜索添加一个吧</p> : friends.map((f) => (
                  <div key={f.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100">
                    <div className="flex items-center gap-2 min-w-0">
                      {f.avatar ? <img src={f.avatar} className="w-9 h-9 rounded-full object-cover" /> : <span className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 text-white flex items-center justify-center text-sm">{(f.nickname || f.username || '?')[0].toUpperCase()}</span>}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{f.nickname || f.username}</p>
                        <p className="text-xs text-gray-400 truncate">@{f.username}</p>
                      </div>
                    </div>
                    <button onClick={() => openDm(f.id)} className="text-xs text-blue-600 hover:text-blue-700">发消息</button>
                  </div>
                ))}
              </div>
            </>
          )}

          {contactKind === 'agents' && (
            <div className="space-y-4">
              {showCreateAgent && (
                <div className="p-4 border border-blue-100 bg-blue-50/50 rounded-xl space-y-3">
                  <div className="text-sm font-semibold text-gray-700">{editingAgentId ? '编辑 Agent' : '新建 Agent'}</div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <input value={agentForm.name} onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })} className="px-3 py-2 border border-gray-300 rounded text-sm" placeholder="Agent 名称，例如：需求分析师" />
                    <select value={agentForm.roleType} onChange={(e) => setAgentForm({ ...agentForm, roleType: e.target.value as any })} className="px-3 py-2 border border-gray-300 rounded text-sm">
                      <option value="assistant">业务助理</option>
                      <option value="specialist">业务专家</option>
                    </select>
                  </div>
                  <input value={agentForm.description} onChange={(e) => setAgentForm({ ...agentForm, description: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="职责描述" />
                  <input value={agentForm.specialties} onChange={(e) => setAgentForm({ ...agentForm, specialties: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="专长，逗号分隔" />
                  <textarea value={agentForm.systemPrompt} onChange={(e) => setAgentForm({ ...agentForm, systemPrompt: e.target.value })} rows={4} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="系统提示词" />
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                    {(['chat', 'task', 'file', 'tab', 'interaction', 'members'] as const).map((key) => (
                      <label key={key} className="flex items-center gap-2 bg-white border border-gray-200 rounded px-3 py-2">
                        <input type="checkbox" checked={agentForm.tools[key]} onChange={() => toggleAgentTool(key)} />{key}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={createAgentFromContacts} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">{editingAgentId ? '保存修改' : '保存 Agent'}</button>
                    <button onClick={resetAgentEditor} className="bg-gray-100 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-200">取消</button>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {agents.length === 0 ? <p className="text-sm text-gray-400">暂无 Agent，点击右上角新建一个。</p> : agents.map((a) => (
                  <div key={a.id} className="p-3 rounded-xl border border-gray-100 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-blue-500 text-white flex items-center justify-center shrink-0"><Bot className="w-5 h-5" /></span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{a.name}</p>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-600">{a.roleType === 'assistant' ? '助理' : '专家'}</span>
                        </div>
                        {a.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{a.description}</p>}
                        {a.specialties?.length > 0 && <p className="text-xs text-gray-400 mt-1 truncate">{a.specialties.join('、')}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => openEditAgent(a)} className="text-blue-500 hover:text-blue-700 p-1" title="编辑 Agent"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => deleteAgentFromContacts(a)} className="text-red-400 hover:text-red-600 p-1" title="删除 Agent"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
        )}

        {activeHomeTab === 'settings' && (
          <section className="bg-white sm:rounded-xl sm:border border-gray-200 p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-3">
              {user?.avatar ? <img src={user.avatar} className="w-14 h-14 rounded-full object-cover" /> : <span className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 text-white flex items-center justify-center text-xl font-semibold">{(user?.nickname || user?.username || '?')[0].toUpperCase()}</span>}
              <div>
                <p className="font-semibold text-gray-800">{user?.nickname || user?.username}</p>
                <p className="text-sm text-gray-400">@{user?.username}</p>
              </div>
            </div>
            <button onClick={() => navigate('/settings')} className="w-full text-left px-4 py-3 rounded-lg border border-gray-100 hover:bg-gray-50">个人设置</button>
            <button onClick={handleLogout} className="w-full text-left px-4 py-3 rounded-lg border border-red-100 text-red-600 hover:bg-red-50">退出登录</button>
          </section>
        )}

      </main>

      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 safe-area-inset-bottom">
        <div className="grid grid-cols-3 h-16">
          {[
            { key: 'messages', label: '消息', Icon: MessageCircle },
            { key: 'contacts', label: '通讯录', Icon: Users },
            { key: 'settings', label: '设置', Icon: Settings },
          ].map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setActiveHomeTab(key as any)}
              className={`flex flex-col items-center justify-center gap-0.5 text-xs ${activeHomeTab === key ? 'text-blue-600' : 'text-gray-500'}`}
            >
              <Icon className="w-5 h-5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>

      {showJoin && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-xl p-4 sm:p-6 w-full max-w-md max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">加入项目</h3>
            <form onSubmit={handleJoinRoom} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  邀请码
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder="输入别人发给你的邀请码"
                  autoFocus
                  required
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => { setShowJoin(false); setInviteCode('') }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={joining}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
                >
                  {joining ? '加入中...' : '加入'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-xl p-4 sm:p-6 w-full max-w-md max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">新建项目</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  项目名称
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder="输入项目名称"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  描述（可选）
                </label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder="项目描述"
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  选择协作者（可选）
                </label>
                {friends.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs text-gray-500 mb-1">人员</p>
                    <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                      {friends.map((f) => (
                        <label key={f.id} className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer text-sm">
                          <input type="checkbox" checked={selectedFriendIds.includes(f.id)} onChange={() => toggleSelectedFriend(f.id)} />
                          {f.avatar ? <img src={f.avatar} className="w-6 h-6 rounded-full object-cover" /> : <span className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs">{(f.nickname || f.username || '?')[0].toUpperCase()}</span>}
                          <span>{f.nickname || f.username}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {agents.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Agent</p>
                    <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                      {agents.map((a) => {
                        const selected = selectedAgents.find((item) => item.agentId === a.id)
                        return (
                          <div key={a.id} className="flex items-center justify-between gap-2 p-2 rounded hover:bg-gray-50 text-sm">
                            <label className="flex items-center gap-2 min-w-0 cursor-pointer flex-1">
                              <input type="checkbox" checked={!!selected} onChange={() => toggleSelectedAgent(a.id)} />
                              <span className="truncate">{a.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 shrink-0">{a.roleType === 'assistant' ? '助理' : '专家'}</span>
                            </label>
                            {selected && (
                              <select value={selected.autoEnabled ? 'auto' : 'specialist'} onChange={(e) => setAgentAutoEnabled(a.id, e.target.value === 'auto')} className="text-xs border border-gray-200 rounded px-2 py-1">
                                <option value="specialist">专家</option>
                                <option value="auto">自动助理</option>
                              </select>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {selectedAgents.filter((a) => a.autoEnabled).length > 1 && <p className="text-xs text-orange-500 mt-1">只会启用第一个自动助理，其他会自动作为专家加入。</p>}
                  </div>
                )}
                {friends.length === 0 && agents.length === 0 && <p className="text-sm text-gray-400">通讯录暂无可选协作者。</p>}
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setSelectedAgents([]) }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  创建
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
