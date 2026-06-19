import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { api } from '../lib/api'
import { useFeedback } from '../components/FeedbackProvider'
import type { SwipeAction } from '../components/SwipeActionItem'
import { agentToForm, buildAgentPayload, emptyAgentForm, type AgentToolKey } from './home-agent-form'
import { ContactsSection } from './home/ContactsSection'
import { MarketSection } from './home/MarketSection'
import { HomeHeader } from './home/HomeHeader'
import { AddFriendModal, CreateRoomModal, JoinRoomModal } from './home/HomeModals'
import { DesktopTabs, MobileNav } from './home/HomeTabs'
import { MessagesSection } from './home/MessagesSection'
import { SettingsSection } from './home/SettingsSection'
import { BillingPanel } from '../features/settings/BillingPanel'
import { isBrowserNotificationEnabled, showBrowserNotification } from '../features/notifications/browser-notifications'
import { isStrongNotification, playNotificationSound, soundKindForNotification } from '../features/notifications/notification-sound'
import type { ContactKind, HomeTab, MarketKind, SelectedAgent } from './home/types'

export default function HomePage() {
  const [rooms, setRooms] = useState<any[]>([])
  const [conversations, setConversations] = useState<any[]>([])
  const [friends, setFriends] = useState<any[]>([])
  const [agents, setAgents] = useState<any[]>([])
  const [scenes, setScenes] = useState<any[]>([])
  const [selectedSceneId, setSelectedSceneId] = useState('')
  const [contactKind, setContactKind] = useState<ContactKind>('people')
  const [marketKind, setMarketKind] = useState<MarketKind>('agents')
  const [showCreateAgent, setShowCreateAgent] = useState(false)
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
  const [agentForm, setAgentForm] = useState(emptyAgentForm())
  const [friendRequests, setFriendRequests] = useState<{ received: any[]; sent: any[] }>({ received: [], sent: [] })
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([])
  const [selectedAgents, setSelectedAgents] = useState<SelectedAgent[]>([])
  const [activeHomeTab, setActiveHomeTab] = useState<HomeTab>('messages')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [showAddFriend, setShowAddFriend] = useState(false)
  const [showQuickActions, setShowQuickActions] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [notifications, setNotifications] = useState<any[]>([])
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0)
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(isBrowserNotificationEnabled())
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

  useEffect(() => {
    loadNotifications()
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('auth-storage') ? JSON.parse(localStorage.getItem('auth-storage')!).state.token : null
    if (!token) return
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`)
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.action === 'agent.status_update') {
        loadConversations()
        return
      }
      if (msg.action !== 'notification.created') return
      const notification = msg.payload?.notification
      if (!notification) return
      setNotifications((prev) => [notification, ...prev.filter((item) => item.id !== notification.id)].slice(0, 50))
      setNotificationUnreadCount((count) => count + 1)
      if (isStrongNotification(notification)) showBrowserNotification(notification)
      void playNotificationSound(soundKindForNotification(notification), `${notification.type}:${notification.roomId || 'global'}`)
      loadConversations()
    }
    return () => ws.close()
  }, [])

  useEffect(() => {
    if (activeHomeTab !== 'messages') return
    const timer = window.setInterval(() => loadConversations(), 10_000)
    return () => window.clearInterval(timer)
  }, [activeHomeTab])

  const loadHome = async () => {
    setLoading(true)
    await Promise.all([loadRooms(), loadFriends(), loadAgents(), loadScenes(), loadFriendRequests(), loadConversations()])
    setLoading(false)
  }

  const loadRooms = async () => {
    try { const data = await api.getRooms(); setRooms(data.rooms || []) } catch (err) { console.error(err) }
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

  const loadScenes = async () => {
    try { const data = await api.getScenes(); setScenes(data.scenes || []) } catch (err) { console.error(err) }
  }

  const loadFriendRequests = async () => {
    try { const data = await api.getFriendRequests(); setFriendRequests({ received: data.received || [], sent: data.sent || [] }) } catch (err) { console.error(err) }
  }

  const loadNotifications = async () => {
    try { const data = await api.getNotifications({ limit: 50 }); setNotifications(data.notifications || []); setNotificationUnreadCount(data.unreadCount || 0) } catch (err) { console.error(err) }
  }

  const markAllNotificationsRead = async () => {
    try { const data = await api.markNotificationsRead({ all: true }); setNotifications(data.notifications || []); setNotificationUnreadCount(data.unreadCount || 0) } catch (err: any) { feedback.error(err.message || '操作失败') }
  }

  const openNotification = async (notification: any) => {
    try {
      if (!notification.readAt) {
        const data = await api.markNotificationsRead({ ids: [notification.id] })
        setNotifications(data.notifications || [])
        setNotificationUnreadCount(data.unreadCount || 0)
      }
      setShowNotifications(false)
      if (notification.targetPath) navigate(notification.targetPath)
    } catch (err: any) { feedback.error(err.message || '操作失败') }
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
    setAgentForm(agentToForm(agent))
    setShowCreateAgent(true)
  }

  const toggleAgentTool = (key: AgentToolKey) => {
    setAgentForm((prev) => ({ ...prev, tools: { ...prev.tools, [key]: !prev.tools[key] } }))
  }

  const createAgentFromContacts = async () => {
    const name = agentForm.name.trim()
    if (!name) { feedback.warning('请输入 Agent 名称'); return }
    try {
      const body = buildAgentPayload(agentForm)
      if (editingAgentId) { await api.updateAgent(editingAgentId, body); feedback.success('Agent 已更新') }
      else { await api.createAgent(body); feedback.success('Agent 已创建') }
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
    const agent = agents.find((item) => item.id === agentId)
    const shouldAuto = agent?.roleType === 'assistant'
    setSelectedAgents((prev) => {
      if (prev.some((a) => a.agentId === agentId)) return prev.filter((a) => a.agentId !== agentId)
      const next = shouldAuto ? prev.map((a) => ({ ...a, autoEnabled: false })) : prev
      return [...next, { agentId, autoEnabled: shouldAuto }]
    })
  }

  const setAgentAutoEnabled = (agentId: string, autoEnabled: boolean) => {
    setSelectedAgents((prev) => prev.map((a) => a.agentId === agentId ? { ...a, autoEnabled } : a))
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const selectedAgentDetails = selectedAgents.map((item) => agents.find((agent) => agent.id === item.agentId)).filter(Boolean)
      const needsAgentFeeConfirm = !selectedSceneId && selectedAgentDetails.some((agent: any) => !agent.isOwner)
      if (needsAgentFeeConfirm) {
        const ok = await feedback.confirm({ title: '启用收费 Agent？', message: '所选 Agent 中包含非自有 Agent，Agent 实际运行时会按 token 收取服务费。确认继续？', confirmText: '确认创建' })
        if (!ok) return
      }
      const result = await api.createRoom({
        name: newName,
        description: newDesc,
        sceneId: selectedSceneId || undefined,
        memberIds: selectedFriendIds,
        agents: selectedSceneId ? [] : selectedAgents.map((a) => ({ agentId: a.agentId, roomRole: a.autoEnabled ? 'assistant' : 'specialist', autoEnabled: a.autoEnabled })),
      })
      setShowCreate(false)
      setNewName('')
      setNewDesc('')
      setSelectedFriendIds([])
      setSelectedAgents([])
      setSelectedSceneId('')
      loadRooms()
      if (result?.room?.id) navigate(`/room/${result.room.id}`)
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
      if (result?.room?.id) navigate(`/room/${result.room.id}`)
      else await loadRooms()
    } catch (err: any) {
      feedback.error('加入失败: ' + (err.message || JSON.stringify(err)))
    } finally {
      setJoining(false)
    }
  }

  const handleDeleteRoom = async (room: any, e: React.MouseEvent) => {
    e?.stopPropagation()
    if (!room.canDelete && room.memberRole !== 'owner') {
      feedback.warning('你没有权限删除该项目')
      return
    }
    const ok = await feedback.confirm({ title: `删除项目「${room.name}」？`, message: '项目会从列表隐藏，历史账单、流水和运行记录仍保留关联。', confirmText: '删除项目', danger: true })
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

  const openQuickAddFriend = () => {
    setShowQuickActions(false)
    setActiveHomeTab('contacts')
    setContactKind('people')
    setShowAddFriend(true)
  }
  const openQuickJoin = () => { setShowQuickActions(false); setShowJoin(true) }
  const openQuickCreate = () => { setShowQuickActions(false); setShowCreate(true) }

  return (
    <div className="min-h-screen bg-gray-50">
      <HomeHeader user={user} showQuickActions={showQuickActions} showNotifications={showNotifications} notifications={notifications} notificationUnreadCount={notificationUnreadCount} browserNotificationsEnabled={browserNotificationsEnabled} setShowQuickActions={setShowQuickActions} setShowNotifications={setShowNotifications} setBrowserNotificationsEnabled={setBrowserNotificationsEnabled} onShowJoin={openQuickJoin} onShowCreate={openQuickCreate} onShowAddFriend={openQuickAddFriend} onSettings={() => setActiveHomeTab('settings')} onLogout={handleLogout} onMarkAllNotificationsRead={markAllNotificationsRead} onOpenNotification={openNotification} />
      <main className="max-w-5xl mx-auto px-0 sm:px-4 py-0 sm:py-8 pb-20 sm:pb-8">
        <DesktopTabs activeHomeTab={activeHomeTab} setActiveHomeTab={setActiveHomeTab} />
        {activeHomeTab === 'messages' && (
          <MessagesSection conversations={conversations} deletingId={deletingId} openSwipeId={openSwipeId} setOpenSwipeId={setOpenSwipeId} loadConversations={loadConversations} getConversationActions={getConversationActions} toggleConversationPref={toggleConversationPref} deleteConversation={deleteConversation} navigateTo={navigate} />
        )}
        {activeHomeTab === 'contacts' && (
          <ContactsSection contactKind={contactKind} setContactKind={setContactKind} searchQ={searchQ} setSearchQ={setSearchQ} searchResults={searchResults} friends={friends} agents={agents} scenes={scenes} reloadScenes={loadScenes} reloadAgents={loadAgents} friendRequests={friendRequests} showCreateAgent={showCreateAgent} editingAgentId={editingAgentId} agentForm={agentForm} setAgentForm={setAgentForm} openCreateAgent={openCreateAgent} resetAgentEditor={resetAgentEditor} searchUsers={searchUsers} sendFriendRequest={sendFriendRequest} acceptFriendRequest={acceptFriendRequest} rejectFriendRequest={rejectFriendRequest} openDm={openDm} toggleAgentTool={toggleAgentTool} createAgentFromContacts={createAgentFromContacts} openEditAgent={openEditAgent} deleteAgentFromContacts={deleteAgentFromContacts} />
        )}
        {activeHomeTab === 'market' && <MarketSection marketKind={marketKind} setMarketKind={setMarketKind} agents={agents} scenes={scenes} reloadScenes={loadScenes} reloadAgents={loadAgents} showCreateAgent={showCreateAgent} editingAgentId={editingAgentId} agentForm={agentForm} setAgentForm={setAgentForm} openCreateAgent={openCreateAgent} resetAgentEditor={resetAgentEditor} toggleAgentTool={toggleAgentTool} createAgentFromContacts={createAgentFromContacts} openEditAgent={openEditAgent} deleteAgentFromContacts={deleteAgentFromContacts} />}
        {activeHomeTab === 'billing' && <BillingPanel />}
        {activeHomeTab === 'settings' && <SettingsSection user={user} onLogout={handleLogout} />}
      </main>
      <MobileNav activeHomeTab={activeHomeTab} setActiveHomeTab={setActiveHomeTab} />
      <JoinRoomModal show={showJoin} inviteCode={inviteCode} joining={joining} setInviteCode={setInviteCode} setShowJoin={setShowJoin} handleJoinRoom={handleJoinRoom} />
      <AddFriendModal show={showAddFriend} searchQ={searchQ} searchResults={searchResults} setSearchQ={setSearchQ} setShowAddFriend={setShowAddFriend} searchUsers={searchUsers} sendFriendRequest={sendFriendRequest} />
      <CreateRoomModal show={showCreate} newName={newName} newDesc={newDesc} friends={friends} agents={agents.filter((agent) => agent.canUse)} scenes={scenes.filter((scene) => scene.canUse)} selectedSceneId={selectedSceneId} setSelectedSceneId={setSelectedSceneId} selectedFriendIds={selectedFriendIds} selectedAgents={selectedAgents} setNewName={setNewName} setNewDesc={setNewDesc} setShowCreate={setShowCreate} setSelectedAgents={setSelectedAgents} handleCreate={handleCreate} toggleSelectedFriend={toggleSelectedFriend} toggleSelectedAgent={toggleSelectedAgent} setAgentAutoEnabled={setAgentAutoEnabled} />
    </div>
  )
}
