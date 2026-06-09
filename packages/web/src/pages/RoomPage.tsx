import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { api } from '../lib/api'
import { addClientLog, clearClientLogs, formatClientLogs, getClientLogs, subscribeClientLogs, type ClientLogEntry } from '../lib/clientLog'
import { useFeedback } from '../components/FeedbackProvider'
import { Bot, Clipboard, FileText, Folder, ListTodo, MessageCircle, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Pencil, Settings, ShieldCheck, Sparkles, Trash2, UserRound, Users, Wrench, X } from 'lucide-react'

interface Message {
  id: string
  actorId: string
  actorName: string
  actorRole: 'human' | 'ai'
  content: string
  kind?: 'text' | 'interaction_request' | 'system' | 'agent_receipt'
  payload?: any
  createdAt: number
}

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

interface Tab {
  id: string
  title?: string
  name?: string
  content: string
  icon?: string
  updated_at?: number
  updatedAt?: number
}

type Panel = 'chat' | 'files' | 'tabs' | 'tasks'

const LOCAL_MESSAGE_CACHE_LIMIT = 100
const getMessageCacheKey = (roomId: string) => `freechat:room:${roomId}:messages`

function mergeMessages(...groups: Message[][]): Message[] {
  const map = new Map<string, Message>()
  groups.flat().forEach((msg) => {
    if (msg?.id) map.set(msg.id, { ...map.get(msg.id), ...msg })
  })
  return Array.from(map.values())
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .slice(-LOCAL_MESSAGE_CACHE_LIMIT)
}

function readCachedMessages(roomId: string): Message[] {
  try {
    const raw = localStorage.getItem(getMessageCacheKey(roomId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? mergeMessages(parsed) : []
  } catch {
    return []
  }
}

function writeCachedMessages(roomId: string, messages: Message[]) {
  try {
    localStorage.setItem(getMessageCacheKey(roomId), JSON.stringify(mergeMessages(messages)))
  } catch {
    // localStorage may be full or disabled; UI should still work.
  }
}

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const { user, token } = useAuthStore()
  const feedback = useFeedback()
  const [room, setRoom] = useState<any>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [members, setMembers] = useState<any[]>([])
  const [roomAgents, setRoomAgents] = useState<any[]>([])
  const [activePanel, setActivePanel] = useState<Panel>('chat')
  const [tasks, setTasks] = useState<any[]>([])
  const [files, setFiles] = useState<FileNode[]>([])
  const [currentFile, setCurrentFile] = useState<{ path: string; content: string } | null>(null)
  const [fileDirty, setFileDirty] = useState(false)
  const [fileDialogType, setFileDialogType] = useState<'file' | 'folder' | null>(null)
  const [fileDialogPath, setFileDialogPath] = useState('')
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [showMentionPopup, setShowMentionPopup] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [selectedMentions, setSelectedMentions] = useState<Array<{ id: string; name: string; role: 'human' | 'ai' }>>([])
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [creatingTask, setCreatingTask] = useState(false)
  const [expandedTaskIds, setExpandedTaskIds] = useState<string[]>([])
  const [newSubtaskTitles, setNewSubtaskTitles] = useState<Record<string, string>>({})
  const [showArchivedTasks, setShowArchivedTasks] = useState(false)
  const [newTabName, setNewTabName] = useState('')
  const [newTabContent, setNewTabContent] = useState('')
  const [showCreateTab, setShowCreateTab] = useState(false)
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingTabTitle, setEditingTabTitle] = useState('')
  const [editingTabContent, setEditingTabContent] = useState('')
  const [tabError, setTabError] = useState('')
  const [showMembers, setShowMembers] = useState(true)
  const [showMobileMembers, setShowMobileMembers] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState<any | null>(null)
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('connecting')
  const [sendError, setSendError] = useState('')
  const [wsNoticeDismissed, setWsNoticeDismissed] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [clientLogs, setClientLogs] = useState<ClientLogEntry[]>(getClientLogs())
  const [lastReadAt, setLastReadAt] = useState<number>(() => {
    try { return Number(sessionStorage.getItem(`freechat:room:${roomId}:lastReadAt`) || 0) } catch { return 0 }
  })
  const [unreadMarkerAt, setUnreadMarkerAt] = useState<number | null>(null)
  const [roomNewMessageCount, setRoomNewMessageCount] = useState(0)
  const [interactionSelections, setInteractionSelections] = useState<Record<string, string[]>>({})
  const [interactionInputs, setInteractionInputs] = useState<Record<string, Record<string, string>>>({})
  const [submittingInteractions, setSubmittingInteractions] = useState<Record<string, boolean>>({})
  const [pendingInteractions, setPendingInteractions] = useState<any[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const manuallyClosedRef = useRef(false)
  const wsConnectIdRef = useRef(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const initialScrollDoneRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const getCurrentToken = () => {
    if (token) return token
    try {
      return JSON.parse(localStorage.getItem('auth-storage') || '{}')?.state?.token || ''
    } catch {
      return ''
    }
  }

  useEffect(() => {
    const unsubscribe = subscribeClientLogs(setClientLogs)
    return () => { unsubscribe() }
  }, [])

  useEffect(() => {
    addClientLog('info', 'auth', 'auth state changed', { token: getCurrentToken() ? 'present' : 'missing', user: user?.username || user?.nickname || null })
  }, [token, user?.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        setShowDiagnostics((value) => !value)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!roomId) return
    initialScrollDoneRef.current = false
    const storedLastReadAt = Number(sessionStorage.getItem(`freechat:room:${roomId}:lastReadAt`) || 0)
    setLastReadAt(storedLastReadAt)
    setUnreadMarkerAt(storedLastReadAt || null)
    setRoomNewMessageCount(0)
    window.setTimeout(() => {
      api.markConversationRead('project', roomId).then(() => {
        const now = Date.now()
        setLastReadAt(now)
        sessionStorage.setItem(`freechat:room:${roomId}:lastReadAt`, String(now))
      }).catch(() => {})
    }, 1800)
    const cachedMessages = readCachedMessages(roomId)
    if (cachedMessages.length > 0) setMessages(cachedMessages)
    manuallyClosedRef.current = false
    addClientLog('info', 'ui', 'room page mounted', { roomId, host: window.location.host, href: window.location.href })
    loadRoom()
    connectWs()
    return () => {
      manuallyClosedRef.current = true
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current)
      const ws = wsRef.current
      wsRef.current = null
      if (ws) {
        ws.onopen = null
        ws.onmessage = null
        ws.onerror = null
        ws.onclose = null
        addClientLog('info', 'ws', 'cleanup close old websocket')
      ws.close()
      }
    }
  }, [roomId])

  const isChatNearBottom = () => {
    const el = messagesScrollRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' })
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' }), 80)
    })
  }, [])

  const scrollToBottomAndRead = () => {
    scrollToBottom('smooth')
    setRoomNewMessageCount(0)
    if (roomId) {
      api.markConversationRead('project', roomId).then(() => {
        const now = Date.now()
        setLastReadAt(now)
        setUnreadMarkerAt(null)
        sessionStorage.setItem(`freechat:room:${roomId}:lastReadAt`, String(now))
      }).catch(() => {})
    }
  }

  useEffect(() => {
    if (messages.length === 0) return
    if (!initialScrollDoneRef.current) {
      if (unreadMarkerAt) {
        const firstUnread = messages.find((m) => m.actorId !== user?.id && (m.createdAt || 0) > unreadMarkerAt)
        if (firstUnread) {
          requestAnimationFrame(() => document.getElementById(`msg-${firstUnread.id}`)?.scrollIntoView({ behavior: 'auto', block: 'center' }))
        } else {
          scrollToBottom('auto')
        }
      } else {
        scrollToBottom('auto')
      }
      initialScrollDoneRef.current = true
      return
    }
    if (isChatNearBottom()) scrollToBottom('smooth')
  }, [messages.length, scrollToBottom, unreadMarkerAt, user?.id])

  const loadRoom = async () => {
    try {
      const data = await api.getRoom(roomId!)
      setRoom(data.room)
      setMembers(data.members)
      // Load files and tabs
      try { const fd = await api.getFiles(roomId!); setFiles(fd.files || []) } catch (err: any) { addClientLog('error', 'ui', 'load files failed', { message: err?.message }) }
      try { const td = await api.getTabs(roomId!); setTabs(td.tabs || []) } catch (err: any) { addClientLog('error', 'ui', 'load tabs failed', { message: err?.message }) }
      try { const ra = await api.getRoomAgents(roomId!); setRoomAgents(ra.agents || []) } catch (err: any) { addClientLog('error', 'ui', 'load room agents failed', { message: err?.message }) }
      try { const td = await api.getRoomTasks(roomId!); setTasks(td.tasks || []) } catch (err: any) { addClientLog('error', 'ui', 'load tasks failed', { message: err?.message }) }
      try {
        const md = await api.getRoomMessages(roomId!, 100)
        setMessages((prev) => {
          const next = mergeMessages(prev, md.messages || [])
          if (roomId) writeCachedMessages(roomId, next)
          return next
        })
      } catch (err: any) { addClientLog('error', 'ui', 'load messages failed', { message: err?.message }) }
    } catch (err: any) {
      addClientLog('error', 'ui', 'load room failed, navigate home', { message: err?.message })
      navigate('/')
    }
  }

  const scheduleReconnect = () => {
    if (manuallyClosedRef.current) return
    if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current)
    const delay = Math.min(5000, 1000 * Math.max(1, reconnectAttemptsRef.current))
    addClientLog('warn', 'ws', 'reconnect scheduled', { delay, attempts: reconnectAttemptsRef.current })
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectAttemptsRef.current += 1
      connectWs()
    }, delay)
  }

  const connectWs = () => {
    if (!roomId) return
    const currentToken = getCurrentToken()
    if (!currentToken) {
      setWsStatus('closed')
      setSendError('登录状态未就绪，请刷新或重新登录')
      addClientLog('error', 'ws', 'connect skipped: token missing', { roomId })
      return
    }
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      addClientLog('info', 'ws', 'connect skipped: socket already active', { readyState: wsRef.current.readyState })
      return
    }

    setWsStatus('connecting')
    const connectId = ++wsConnectIdRef.current
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(currentToken)}`
    addClientLog('info', 'ws', 'connecting', { url: `${protocol}//${window.location.host}/ws`, token: 'present', roomId, connectId })
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    ws.onopen = () => {
      if (wsConnectIdRef.current !== connectId) return
      reconnectAttemptsRef.current = 0
      addClientLog('info', 'ws', 'open', { connectId })
      setWsStatus('open')
      setSendError('')
      addClientLog('info', 'ws', 'send room.join/chat.history/task.list', { roomId })
      ws.send(JSON.stringify({ action: 'room.join', payload: { room_id: roomId } }))
      ws.send(JSON.stringify({ action: 'chat.history', payload: { room_id: roomId, limit: 100 } }))
      ws.send(JSON.stringify({ action: 'task.list', payload: { room_id: roomId } }))
    }
    ws.onmessage = (event) => {
      if (wsConnectIdRef.current !== connectId) return
      const msg = JSON.parse(event.data)
      addClientLog('info', 'ws', 'message received', { action: msg.action, type: msg.type })
      if (msg.action === 'chat.message') {
        const isIncoming = msg.payload?.actorId !== user?.id
        const nearBottom = isChatNearBottom()
        if (isIncoming && activePanel === 'chat') {
          if (nearBottom) {
            api.markConversationRead('project', roomId!).then(() => {
              const now = Date.now()
              setLastReadAt(now)
              sessionStorage.setItem(`freechat:room:${roomId}:lastReadAt`, String(now))
            }).catch(() => {})
          } else {
            setRoomNewMessageCount((count) => count + 1)
          }
        }
        setMessages((prev) => {
          const next = mergeMessages(prev, [msg.payload])
          if (roomId) writeCachedMessages(roomId, next)
          return next
        })
      } else if (msg.action === 'interaction.created') {
        if (msg.payload?.interaction?.status === 'pending') setPendingInteractions((prev) => [msg.payload.interaction, ...prev.filter((item) => item.id !== msg.payload.interaction.id)])
      } else if (msg.action === 'interaction.updated') {
        setMessages((prev) => prev.map((m) => (m.payload?.interactionId === msg.payload.interaction.id ? { ...m, payload: { ...(m.payload || {}), interaction: msg.payload.interaction } } : m)))
        setPendingInteractions((prev) => msg.payload.interaction.status === 'pending' ? [msg.payload.interaction, ...prev.filter((item) => item.id !== msg.payload.interaction.id)] : prev.filter((item) => item.id !== msg.payload.interaction.id))
      } else if (msg.action === 'chat.history_result') {
        setMessages((prev) => {
          const next = mergeMessages(prev, msg.payload.messages || [])
          if (roomId) writeCachedMessages(roomId, next)
          return next
        })
      } else if (msg.action === 'chat.edited') {
        setMessages((prev) => {
          const next = mergeMessages(prev.map((m) => (m.id === msg.payload.id ? { ...m, ...msg.payload } : m)))
          if (roomId) writeCachedMessages(roomId, next)
          return next
        })
      } else if (msg.action === 'chat.deleted') {
        setMessages((prev) => {
          const next = prev.filter((m) => m.id !== msg.payload.message_id)
          if (roomId) writeCachedMessages(roomId, next)
          return next
        })
      } else if (msg.action === 'room.members_update') {
        setMembers(msg.payload.members || [])
        if (Array.isArray(msg.payload.agents)) setRoomAgents(msg.payload.agents)
      } else if (msg.action === 'agent.status_update') {
        setRoomAgents((prev) => prev.map((a) => a.id === msg.payload.agentId ? { ...a, ...msg.payload } : a))
      } else if (msg.action === 'task.list_result') {
        setTasks(msg.payload.tasks || [])
      } else if (msg.action === 'task.changed') {
        if (msg.payload.action === 'add') setTasks((prev) => prev.some((t) => t.id === msg.payload.task.id) ? prev.map((t) => (t.id === msg.payload.task.id ? msg.payload.task : t)) : [msg.payload.task, ...prev])
        else if (msg.payload.action === 'update') setTasks((prev) => prev.some((t) => t.id === msg.payload.task.id) ? prev.map((t) => (t.id === msg.payload.task.id ? msg.payload.task : t)) : [msg.payload.task, ...prev])
        else if (msg.payload.action === 'delete') setTasks((prev) => prev.filter((t) => t.id !== msg.payload.task_id))
      } else if (msg.action === 'files.updated') {
        loadFiles()
      } else if (msg.action === 'tabs.updated') {
        loadTabs()
      }
    }
    ws.onerror = () => {
      if (wsConnectIdRef.current !== connectId) return
      addClientLog('error', 'ws', 'error event', { connectId })
      setWsStatus('error')
      setSendError('连接异常，正在尝试重连...')
    }
    ws.onclose = (event) => {
      if (wsConnectIdRef.current !== connectId) return
      if (wsRef.current === ws) wsRef.current = null
      addClientLog('warn', 'ws', 'close', { code: event.code, reason: event.reason, wasClean: event.wasClean, connectId })
      if (manuallyClosedRef.current) return

      setWsStatus('closed')
      if (event.code === 4001) {
        setSendError(event.reason || '登录已过期，请重新登录')
        return
      }

      setSendError(event.reason ? `连接已断开：${event.reason}，正在重连...` : '连接已断开，正在重连...')
      scheduleReconnect()
    }
  }

  const sendWs = (action: string, payload: any): boolean => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addClientLog('warn', 'ws', 'send skipped: socket not open', { action, readyState: wsRef.current?.readyState ?? null })
      setSendError('连接未就绪，请稍后再试，正在重连...')
      connectWs()
      return false
    }

    try {
      addClientLog('info', 'ws', 'send', { action })
      wsRef.current.send(JSON.stringify({ action, payload }))
      setSendError('')
      return true
    } catch {
      addClientLog('error', 'ws', 'send failed', { action })
      setSendError('发送失败，正在重连...')
      try { wsRef.current.close() } catch {}
      connectWs()
      return false
    }
  }

  const loadFiles = useCallback(async () => {
    if (!roomId) return
    try { const fd = await api.getFiles(roomId); setFiles(fd.files || []) } catch (err: any) { feedback.error(err?.message || '加载文件失败'); addClientLog('error', 'ui', 'load files failed', { message: err?.message }) }
  }, [roomId])

  const loadTabs = useCallback(async () => {
    if (!roomId) return
    try { const td = await api.getTabs(roomId); setTabs(td.tabs || []) } catch (err: any) { feedback.error(err?.message || '加载标签失败'); addClientLog('error', 'ui', 'load tabs failed', { message: err?.message }) }
  }, [roomId])

  const buildMentionsForSend = (content: string) => {
    const mentions = [...selectedMentions]

    members.forEach((m) => {
      const id = m.id || m.userId
      const name = getMemberDisplayName(m)
      if (id && content.includes(`@${name}`) && !mentions.some((x) => x.id === id)) {
        mentions.push({ id, name, role: 'human' })
      }
    })

    roomAgents.forEach((a) => {
      if (a.id && content.includes(`@${a.name}`) && !mentions.some((x) => x.id === a.id)) {
        mentions.push({ id: a.id, name: a.name, role: 'ai' })
      }
    })

    return mentions.filter((m) => content.includes(`@${m.name}`))
  }

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    const content = input.trim()
    if (!content || !roomId) return
    const mentions = buildMentionsForSend(content)

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      if (!sendWs('chat.send', { content, mentions })) return
    } else {
      try {
        addClientLog('warn', 'ui', 'send message via http fallback', { roomId })
        const res = await api.sendRoomMessage(roomId, { content, mentions })
        setMessages((prev) => {
          const next = mergeMessages(prev, [res.message])
          writeCachedMessages(roomId, next)
          return next
        })
        setSendError('')
        setWsNoticeDismissed(true)
      } catch (err: any) {
        setSendError(err?.message || '发送失败')
        connectWs()
        return
      }
    }

    setInput('')
    scrollToBottom('smooth')
    setSelectedMentions([])
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInput(val)
    // Check for @mention
    const cursorPos = e.target.selectionStart || 0
    const beforeCursor = val.slice(0, cursorPos)
    const atMatch = beforeCursor.match(/@([^@\s]*)$/)
    if (atMatch) {
      setShowMentionPopup(true)
      setMentionFilter(atMatch[1].toLowerCase())
    } else {
      setShowMentionPopup(false)
    }
  }


  const getAgentOnlineStatus = (agent: any) => agent.onlineStatus || (
    agent.status === 'working' ? 'working' :
    agent.status === 'inactive' ? 'offline' :
    agent.status === 'error' ? 'error' : 'online'
  )
  const getAgentStatusLabel = (agent: any) => {
    const status = getAgentOnlineStatus(agent)
    if (status === 'working') return '工作中'
    if (status === 'offline') return '离线'
    if (status === 'error') return '异常'
    return '在线'
  }
  const getAgentStatusDotClass = (agent: any) => {
    const status = getAgentOnlineStatus(agent)
    if (status === 'working') return 'bg-yellow-400 agent-breathing shadow-[0_0_0_4px_rgba(250,204,21,0.25)]'
    if (status === 'offline') return 'bg-gray-400'
    if (status === 'error') return 'bg-red-500'
    return 'bg-green-400'
  }
  const defaultAssistant = roomAgents.find((agent) => agent.roleType === 'assistant') || roomAgents[0]
  const workingAgents = roomAgents.filter((agent) => getAgentOnlineStatus(agent) === 'working')

  const getMemberDisplayName = (member: any) => member.nickname || member.username || member.displayName || '未命名用户'
  const getMemberAvatar = (member: any) => member.avatar || ''
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
      })
    } else {
      setSelectedProfile({
        kind,
        id: target.id,
        name: target.name,
        subtitle: target.roleType === 'assistant' ? '助理 Agent' : '专家 Agent',
        roleType: target.roleType,
        status: getAgentStatusLabel(target),
        onlineStatus: getAgentOnlineStatus(target),
        specialties: target.specialties || [],
      })
    }
  }
  const renderAvatar = (name: string, avatar?: string, size = 'w-9 h-9') => avatar ? (
    <img src={avatar} alt={name} className={`${size} rounded-full object-cover border border-gray-200 shrink-0`} />
  ) : (
    <div className={`${size} rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-sm font-semibold shrink-0`}>
      {(name || '?')[0].toUpperCase()}
    </div>
  )
  const renderAgentAvatar = (agent: any, size = 'w-9 h-9', iconSize = 'w-5 h-5') => {
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
  const renderAssigneeBadge = (item: any, compact = false) => {
    if (!item?.assigneeName) return null
    const labelClass = compact ? 'text-[10px] text-gray-400 gap-1.5' : 'text-xs text-gray-400 gap-1.5'
    const avatarSize = compact ? 'w-4 h-4' : 'w-5 h-5'
    const iconSize = compact ? 'w-2.5 h-2.5' : 'w-3 h-3'
    if (item.assigneeType === 'agent') {
      const agent = roomAgents.find((a) => a.id === item.assigneeId || a.name === item.assigneeName) || { name: item.assigneeName, roleType: item.assigneeName.includes('助理') ? 'assistant' : 'specialist', status: 'active' }
      return <span className={`inline-flex items-center ${labelClass}`}>{renderAgentAvatar(agent, avatarSize, iconSize)}<span>{item.assigneeName}</span></span>
    }
    const member = members.find((m) => (m.userId || m.id) === item.assigneeId || getMemberDisplayName(m) === item.assigneeName)
    return <span className={`inline-flex items-center ${labelClass}`}>{renderAvatar(item.assigneeName, member?.avatar, avatarSize)}<span>{item.assigneeName}</span></span>
  }

  const filteredMembers = members.filter((m) => {
    const id = m.id || m.userId
    if (id === user?.id) return false
    return getMemberDisplayName(m).toLowerCase().includes(mentionFilter)
  })

  const filteredAgents = roomAgents.filter((a) =>
    (a.name || '').toLowerCase().includes(mentionFilter)
  )

  const insertMention = (target: any, type: 'member' | 'agent') => {
    const name = type === 'member' ? getMemberDisplayName(target) : target.name
    const cursorPos = inputRef.current?.selectionStart || input.length
    const beforeCursor = input.slice(0, cursorPos)
    const afterCursor = input.slice(cursorPos)
    const atIdx = beforeCursor.lastIndexOf('@')
    const newInput = beforeCursor.slice(0, atIdx) + `@${name} ` + afterCursor
    setInput(newInput)
    setSelectedMentions((prev) => {
      const mention = { id: target.id || target.userId, name, role: type === 'agent' ? 'ai' as const : 'human' as const }
      return prev.some((m) => m.id === mention.id) ? prev : [...prev, mention]
    })
    setShowMentionPopup(false)
    inputRef.current?.focus()
  }

  // File operations
  const openFile = async (node: FileNode) => {
    if (node.type === 'directory') return
    if (fileDirty && currentFile) {
      const ok = await feedback.confirm({ title: '切换文件？', message: '当前文件有未保存内容，切换后会丢失修改。', confirmText: '继续切换' })
      if (!ok) return
    }
    try {
      const data = await api.getFileContent(roomId!, node.path)
      setCurrentFile({ path: node.path, content: data.content })
      setFileDirty(false)
    } catch (err: any) {
      feedback.error(err?.message || '打开文件失败')
      addClientLog('error', 'ui', 'open file failed', { path: node.path, message: err?.message })
    }
  }

  const saveFile = async () => {
    if (!currentFile || !roomId) return
    try {
      await api.saveFile(roomId, currentFile.path, currentFile.content)
      setFileDirty(false)
      feedback.success('文件已保存')
      loadFiles()
    } catch (err: any) {
      feedback.error(err?.message || '保存文件失败')
      addClientLog('error', 'ui', 'save file failed', { path: currentFile.path, message: err?.message })
    }
  }

  const deleteFile = async (path: string) => {
    if (!roomId) return
    const ok = await feedback.confirm({ title: '删除文件？', message: `确定删除 ${path} 吗？`, confirmText: '删除', danger: true })
    if (!ok) return
    try {
      await api.deleteFile(roomId, path)
      feedback.success('文件已删除')
      loadFiles()
      if (currentFile?.path === path) { setCurrentFile(null); setFileDirty(false) }
    } catch (err: any) {
      feedback.error(err?.message || '删除文件失败')
    }
  }

  const createFile = () => {
    setFileDialogType('file')
    setFileDialogPath('')
  }

  const createFolder = () => {
    setFileDialogType('folder')
    setFileDialogPath('')
  }

  const submitFileDialog = async () => {
    if (!roomId || !fileDialogType) return
    const name = fileDialogPath.trim().replace(/^\/+/, '')
    if (!name) { feedback.warning('路径不能为空'); return }
    if (name.includes('..')) { feedback.error('路径不能包含 ..'); return }
    try {
      if (fileDialogType === 'file') await api.saveFile(roomId, name, '')
      else await api.mkdir(roomId, name)
      feedback.success(fileDialogType === 'file' ? '文件已创建' : '目录已创建')
      setFileDialogType(null)
      setFileDialogPath('')
      loadFiles()
    } catch (err: any) {
      feedback.error(err?.message || '创建失败')
    }
  }

  // Tab operations
  const createTab = async () => {
    if (!newTabName.trim() || !roomId) return
    try {
      setTabError('')
      await api.createTab(roomId, { title: newTabName, content: newTabContent || '<h1>Hello</h1>' })
      setNewTabName('')
      setNewTabContent('')
      setShowCreateTab(false)
      feedback.success('标签页已创建')
      loadTabs()
    } catch (err: any) {
      const msg = err?.message || '创建标签失败'
      setTabError(msg)
      feedback.error(msg)
    }
  }

  const deleteTab = async (tabId: string) => {
    if (!roomId) return
    const ok = await feedback.confirm({ title: '删除标签页？', message: '确定删除这个标签页吗？', confirmText: '删除', danger: true })
    if (!ok) return
    try {
      setTabError('')
      await api.deleteTab(roomId, tabId)
      feedback.success('标签页已删除')
      loadTabs()
      if (activeTabId === tabId) setActiveTabId(null)
    } catch (err: any) {
      const msg = err?.message || '删除标签失败'
      setTabError(msg)
      feedback.error(msg)
    }
  }

  const updateTab = async (tabId: string) => {
    if (!roomId) return
    try {
      setTabError('')
      await api.updateTab(roomId, tabId, { title: editingTabTitle, content: editingTabContent })
      feedback.success('标签页已保存')
      loadTabs()
      setEditingTabId(null)
    } catch (err: any) {
      const msg = err?.message || '保存标签失败'
      setTabError(msg)
      feedback.error(msg)
    }
  }

  // Task operations
  const createTask = async () => {
    const title = newTaskTitle.trim()
    if (!title) {
      feedback.warning('请输入任务标题')
      return
    }
    setCreatingTask(true)
    try {
      if (!sendWs('task.create', { title, status: 'todo' })) {
        feedback.error('实时连接不可用，任务创建失败')
        return
      }
      setNewTaskTitle('')
      feedback.success('任务已创建')
    } finally {
      setCreatingTask(false)
    }
  }

  const updateTaskStatus = (task: any, status: string) => {
    if (!sendWs('task.update', { id: task.id, status })) {
      feedback.error('实时连接不可用，任务更新失败')
    }
  }

  const deleteTask = async (task: any) => {
    const ok = await feedback.confirm({ title: '删除任务？', message: `确定删除「${task.title}」吗？`, confirmText: '删除', danger: true })
    if (!ok) return
    if (!sendWs('task.delete', { id: task.id })) {
      feedback.error('实时连接不可用，删除任务失败')
      return
    }
    feedback.success('任务已删除')
  }

  const toggleTaskExpanded = (taskId: string) => {
    setExpandedTaskIds((prev) => prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId])
  }

  const createSubtask = (task: any) => {
    const title = (newSubtaskTitles[task.id] || '').trim()
    if (!title) {
      feedback.warning('请输入子任务标题')
      return
    }
    if (!sendWs('task.subtask.add', { taskId: task.id, title })) {
      feedback.error('实时连接不可用，子任务创建失败')
      return
    }
    setNewSubtaskTitles((prev) => ({ ...prev, [task.id]: '' }))
    feedback.success('子任务已创建')
  }

  const updateSubtaskStatus = (subtask: any, status: string) => {
    if (!sendWs('task.subtask.update', { id: subtask.id, status })) {
      feedback.error('实时连接不可用，子任务更新失败')
    }
  }

  const deleteSubtask = async (subtask: any) => {
    const ok = await feedback.confirm({ title: '删除子任务？', message: `确定删除「${subtask.title}」吗？`, confirmText: '删除', danger: true })
    if (!ok) return
    if (!sendWs('task.subtask.delete', { id: subtask.id })) {
      feedback.error('实时连接不可用，子任务删除失败')
    }
  }

  const statusColors: Record<string, string> = {
    todo: 'bg-gray-100 text-gray-700',
    assigned: 'bg-blue-100 text-blue-700',
    doing: 'bg-yellow-100 text-yellow-700',
    review: 'bg-purple-100 text-purple-700',
    blocked: 'bg-red-100 text-red-700',
    done: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-400',
  }

  const kanbanCols = [
    { key: 'todo', label: '待办', statuses: ['todo', 'assigned'] },
    { key: 'doing', label: '进行中', statuses: ['doing', 'blocked'] },
    { key: 'review', label: '待审核', statuses: ['review'] },
  ]
  const archivedTaskStatuses = ['done', 'failed', 'cancelled']

  const getEffectiveTaskStatus = (task: any) => {
    const summary = task.subtaskSummary || {}
    const hasChildProgress = (summary.doing || 0) > 0 || (summary.review || 0) > 0 || (summary.blocked || 0) > 0 || (summary.done || 0) > 0
    if ((task.status === 'todo' || task.status === 'assigned') && hasChildProgress) return 'doing'
    return task.status
  }

  const getNextTaskStatus = (task: any, colKey?: string) => {
    const status = getEffectiveTaskStatus(task)
    if (status === 'todo' || status === 'assigned') return 'doing'
    if (status === 'doing' || status === 'blocked') return 'review'
    if (status === 'review') return 'done'
    if (colKey === 'todo') return 'doing'
    if (colKey === 'doing') return 'review'
    if (colKey === 'review') return 'done'
    return null
  }

  const getTaskAdvanceLabel = (task: any) => {
    const status = getEffectiveTaskStatus(task)
    if (status === 'todo' || status === 'assigned') return '开始处理'
    if (status === 'doing' || status === 'blocked') return '提交审核'
    if (status === 'review') return '标记完成'
    return ''
  }

  const renderTaskCard = (task: any, colKey?: string) => {
    const nextStatus = getNextTaskStatus(task, colKey)
    const label = getTaskAdvanceLabel(task)
    const subtasks = task.subtasks || []
    const summary = task.subtaskSummary || { total: 0, done: 0, doing: 0, review: 0, blocked: 0, progress: 0 }
    const expanded = expandedTaskIds.includes(task.id)
    const summaryParts = [
      summary.todo ? `待办${summary.todo}` : '',
      summary.assigned ? `已分配${summary.assigned}` : '',
      summary.doing ? `进行中${summary.doing}` : '',
      summary.review ? `待审${summary.review}` : '',
      summary.blocked ? `阻塞${summary.blocked}` : '',
      summary.failed ? `失败${summary.failed}` : '',
    ].filter(Boolean)
    return (
      <div key={task.id} className={`fc-enter fc-card-hover bg-white rounded-xl p-3 sm:p-3 shadow-sm border ${getEffectiveTaskStatus(task) === 'review' ? 'border-purple-200 fc-review-glow' : 'border-gray-100'}`}>
        <p className="text-sm font-medium text-gray-800 leading-5 break-words">{task.title}</p>
        {task.description && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{task.description}</p>}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[getEffectiveTaskStatus(task)] || 'bg-gray-100'}`}>{getEffectiveTaskStatus(task)}</span>
          {renderAssigneeBadge(task)}
        </div>
        <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${task.progressNote ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-400'}`}>
          <span className="font-medium">最近进展：</span>{task.progressNote || '暂无进展'}
        </div>
        {summary.total > 0 && (
          <button type="button" onClick={() => toggleTaskExpanded(task.id)} className="mt-3 w-full text-left">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>子任务 {summary.done}/{summary.total}</span>
              <span>{summary.progress}%</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div className={`h-full rounded-full fc-progress-bar ${summary.progress > 0 ? 'fc-progress-shine' : ''} ${summary.blocked ? 'bg-red-400' : 'bg-blue-500'}`} style={{ width: `${summary.progress}%` }} />
            </div>
            {summaryParts.length > 0 && <p className="mt-1 text-[11px] text-gray-400 truncate">{summaryParts.join(' · ')}</p>}
          </button>
        )}
        <div className="mt-3 flex gap-2">
          {nextStatus && label && (
            <button onClick={() => updateTaskStatus(task, nextStatus)} className="fc-pressable flex-1 sm:flex-none rounded-lg bg-blue-50 px-3 py-2 text-sm sm:text-xs font-medium text-blue-600 hover:bg-blue-100 active:bg-blue-200">{label}</button>
          )}
          <button onClick={() => toggleTaskExpanded(task.id)} className="fc-pressable rounded-lg bg-gray-50 px-3 py-2 text-sm sm:text-xs font-medium text-gray-500 hover:bg-gray-100">{expanded ? '收起' : '子任务'}</button>
          <button onClick={() => deleteTask(task)} className="fc-pressable rounded-lg bg-red-50 px-3 py-2 text-sm sm:text-xs font-medium text-red-500 hover:bg-red-100 active:bg-red-200">删除</button>
        </div>
        {expanded && (
          <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
            {subtasks.length === 0 ? <p className="text-xs text-gray-400">暂无子任务</p> : subtasks.map((subtask: any) => (
              <div key={subtask.id} className="fc-enter rounded-lg bg-gray-50 p-2 transition-colors hover:bg-blue-50/60">
                <div className="flex items-start gap-2">
                  <button onClick={() => updateSubtaskStatus(subtask, subtask.status === 'done' ? 'todo' : 'done')} className={`fc-pressable mt-0.5 w-5 h-5 rounded border text-xs flex items-center justify-center ${subtask.status === 'done' ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-gray-300 text-transparent'}`}>✓</button>
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs font-medium break-words ${subtask.status === 'done' ? 'line-through text-gray-400' : 'text-gray-700'}`}>{subtask.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusColors[subtask.status] || 'bg-gray-100'}`}>{subtask.status}</span>
                      {renderAssigneeBadge(subtask, true)}
                    </div>
                  </div>
                  <button onClick={() => deleteSubtask(subtask)} className="text-xs text-red-400 px-1">×</button>
                </div>
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <input value={newSubtaskTitles[task.id] || ''} onChange={(e) => setNewSubtaskTitles((prev) => ({ ...prev, [task.id]: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && createSubtask(task)} placeholder="新增子任务..." className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={() => createSubtask(task)} className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-600">添加</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const renderInteractionCard = (msg: Message) => {
    const interaction = msg.payload?.interaction
    if (!interaction) return null
    const selected = interactionSelections[interaction.id] || []
    const inputValues = interactionInputs[interaction.id] || {}
    const isPending = interaction.status === 'pending'
    const isMulti = interaction.type === 'multi_choice'
    const taskPlan = interaction.type === 'task_plan' ? interaction.payload?.taskPlan : null
    const isSubmitting = !!submittingInteractions[interaction.id]
    const canChange = interaction.status === 'resolved' && interaction.responsePolicy?.allowChange && !interaction.consumedAt
    const tone = interaction.priority === 'danger' ? 'red' : interaction.priority === 'important' ? 'amber' : interaction.type === 'multi_choice' ? 'purple' : 'blue'
    const setInputValue = (optionValue: string, text: string) => {
      setInteractionInputs((prev) => ({
        ...prev,
        [interaction.id]: { ...(prev[interaction.id] || {}), [optionValue]: text },
      }))
    }
    const validateInputs = (values: string[]) => {
      for (const value of values) {
        const opt = interaction.options?.find((item: any) => item.value === value)
        if (!opt?.input?.enabled) continue
        const text = String(inputValues[value] || '').trim()
        if (opt.input.required && !text) {
          feedback.warning(`请补充：${opt.label}`)
          return false
        }
        if (opt.input.maxLength && text.length > opt.input.maxLength) {
          feedback.warning(`${opt.label} 的补充内容过长`)
          return false
        }
      }
      return true
    }
    const respond = async (value: string | string[]) => {
      if (!roomId || (!isPending && !canChange) || isSubmitting) return
      const values = Array.isArray(value) ? value : [value]
      if (values.length === 0) return
      if (!validateInputs(values)) return
      const inputs = Object.fromEntries(values.filter((v) => String(inputValues[v] || '').trim()).map((v) => [v, String(inputValues[v]).trim()]))
      try {
        setSubmittingInteractions((prev) => ({ ...prev, [interaction.id]: true }))
        const res = await api.respondInteraction(roomId, interaction.id, value, inputs)
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, payload: { ...(m.payload || {}), interaction: res.interaction } } : m)))
        feedback.success('已提交选择')
      } catch (err: any) {
        feedback.error(err?.message || '提交失败')
      } finally {
        setSubmittingInteractions((prev) => ({ ...prev, [interaction.id]: false }))
      }
    }
    const toggle = (value: string) => {
      setInteractionSelections((prev) => {
        const cur = prev[interaction.id] || []
        return { ...prev, [interaction.id]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] }
      })
    }
    const selectSingle = (value: string) => {
      setInteractionSelections((prev) => ({ ...prev, [interaction.id]: [value] }))
    }
    const renderOptionInput = (opt: any) => {
      if (!opt.input?.enabled) return null
      const commonProps = {
        value: inputValues[opt.value] || '',
        onChange: (e: any) => setInputValue(opt.value, e.target.value),
        placeholder: opt.input.placeholder || '请补充说明',
        maxLength: opt.input.maxLength,
        className: 'mt-2 w-full rounded-lg border border-blue-100 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500',
      }
      return opt.input.multiline ? <textarea {...commonProps} rows={3} /> : <input {...commonProps} />
    }
    return (
      <div id={`interaction-${interaction.id}`} className={`fc-enter fc-card-hover max-w-[92%] sm:max-w-[520px] rounded-2xl border p-4 shadow-sm ${isPending || canChange ? (tone === 'red' ? 'border-red-200 bg-red-50' : tone === 'amber' ? 'border-amber-200 bg-amber-50' : tone === 'purple' ? 'border-purple-200 bg-purple-50' : 'border-blue-200 bg-blue-50') : 'border-gray-200 bg-gray-50'}`}>
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold ${(isPending || canChange) ? (tone === 'red' ? 'bg-red-600 text-white' : tone === 'amber' ? 'bg-amber-500 text-white' : tone === 'purple' ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white') : 'bg-green-500 text-white'}`}>{interaction.status === 'resolved' && !canChange ? '✓' : interaction.priority === 'danger' ? '!' : interaction.type === 'task_plan' ? '计' : interaction.type === 'multi_choice' ? '☑' : '?'}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-gray-800">{interaction.title}</h4>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${isPending ? 'bg-white/70 text-gray-700' : canChange ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-500'}`}>{isSubmitting ? '提交中' : isPending ? '待处理' : canChange ? '可修改' : '已处理'}</span>
            </div>
            {interaction.description && <p className="mt-1 text-sm text-gray-600 whitespace-pre-wrap">{interaction.description}</p>}
            {taskPlan && (
              <div className="mt-3 rounded-xl bg-white/80 border border-amber-100 p-3 text-sm text-gray-700 space-y-3">
                <div>
                  <div className="font-medium text-gray-800">父任务：{taskPlan.title}</div>
                  {taskPlan.description && <div className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{taskPlan.description}</div>}
                  <div className="text-xs text-gray-400 mt-1">优先级：{taskPlan.priority || 'medium'}</div>
                </div>
                <div className="space-y-2">
                  {(taskPlan.items || []).map((item: any, index: number) => (
                    <div key={index} className="rounded-lg border border-gray-100 bg-white px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-gray-800">{index + 1}. {item.title}</div>
                        {item.assignee && <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600">{item.assignee}</span>}
                      </div>
                      {item.description && <div className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{item.description}</div>}
                      {item.dependsOn !== undefined && <div className="text-[11px] text-amber-600 mt-1">依赖步骤 {Number(item.dependsOn) + 1}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(isPending || canChange) ? (
              isMulti ? (
                <div className="mt-3 space-y-2">
                  {interaction.options?.map((opt: any) => (
                    <div key={opt.value} className="rounded-xl bg-white px-3 py-2 text-sm text-gray-700 border border-blue-100">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)} />
                        <span>{opt.label}</span>
                        {opt.input?.required && <span className="text-red-400">*</span>}
                      </label>
                      {selected.includes(opt.value) && renderOptionInput(opt)}
                    </div>
                  ))}
                  <button onClick={() => respond(selected)} disabled={selected.length === 0 || isSubmitting} className="fc-pressable w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50">{isSubmitting ? '提交中...' : canChange ? '修改选择' : '提交选择'}</button>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {interaction.options?.map((opt: any) => {
                    const active = selected[0] === opt.value
                    return (
                      <div key={opt.value} className={`fc-pressable rounded-xl border px-3 py-2 ${active ? 'border-blue-300 bg-white shadow-sm' : 'border-blue-100 bg-white/80 hover:bg-white'}`}>
                        <button disabled={isSubmitting} onClick={() => opt.input?.enabled ? selectSingle(opt.value) : respond(opt.value)} className="flex w-full items-center justify-between text-left text-sm font-medium text-gray-700 disabled:opacity-60">
                          <span>{opt.label} {opt.input?.required && <span className="text-red-400">*</span>}</span>
                          <span className={`h-4 w-4 rounded-full border ${active ? 'border-blue-600 bg-blue-600' : 'border-gray-300'}`}></span>
                        </button>
                        {active && renderOptionInput(opt)}
                      </div>
                    )
                  })}
                  {selected[0] && interaction.options?.find((opt: any) => opt.value === selected[0])?.input?.enabled && (
                    <button disabled={isSubmitting} onClick={() => respond(selected[0])} className="fc-pressable w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50">{isSubmitting ? '提交中...' : canChange ? '修改选择' : '提交选择'}</button>
                  )}
                </div>
              )
            ) : (
              <div className="mt-3 rounded-xl bg-white px-3 py-2 text-sm text-gray-600 space-y-1">
                <div>结果：{Array.isArray(interaction.result?.labels) ? interaction.result.labels.join('、') : interaction.result?.value || interaction.status}</div>
                {interaction.result?.inputs && Object.keys(interaction.result.inputs).length > 0 && (
                  <div className="text-xs text-gray-500">
                    {Object.entries(interaction.result.inputs).map(([key, text]: any) => {
                      const label = interaction.options?.find((opt: any) => opt.value === key)?.label || key
                      return <div key={key}>{label}：{text}</div>
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Render content with @mentions highlighted
  const renderMessageContent = (content: string, isOwn = false) => {
    const parts = content.split(/(@[^@\s]+)/g)
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return <span key={i} className={`inline-block px-1 rounded text-xs font-medium ${isOwn ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-700'}`}>{part}</span>
      }
      return <span key={i}>{part}</span>
    })
  }

  // File tree renderer
  const renderFileTree = (nodes: FileNode[], depth = 0) => (
    <div className={depth > 0 ? 'ml-4' : ''}>
      {nodes.map((node) => (
        <div key={node.path}>
          <div
            className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-blue-50 ${currentFile?.path === node.path ? 'bg-blue-100' : ''}`}
            onClick={() => node.type === 'directory' ? null : openFile(node)}
          >
            <span className="text-sm text-gray-500">{node.type === 'directory' ? <Folder className="w-4 h-4" /> : <FileText className="w-4 h-4" />}</span>
            <span className="text-sm flex-1 truncate">{node.name}</span>
            {node.type === 'file' && (
              <button onClick={(e) => { e.stopPropagation(); deleteFile(node.path) }} className="text-xs text-red-400 hover:text-red-600">×</button>
            )}
          </div>
          {node.type === 'directory' && node.children && renderFileTree(node.children, depth + 1)}
        </div>
      ))}
    </div>
  )

  // Mobile bottom nav
  const getTabTitle = (tab: Tab) => tab.title || tab.name || '未命名'
  const beginEditTab = (tab: Tab) => {
    setEditingTabId(tab.id)
    setEditingTabTitle(getTabTitle(tab))
    setEditingTabContent(tab.content || '')
    setTabError('')
  }

  const panels: { key: Panel; label: string; icon: string }[] = [
    { key: 'chat', label: '聊天', icon: 'message' },
    { key: 'files', label: '文件', icon: 'folder' },
    { key: 'tabs', label: '标签', icon: 'panels' },
    { key: 'tasks', label: '任务', icon: 'check' },
  ]


  const diagnosticsText = formatClientLogs(clientLogs)
  const copyDiagnostics = async () => {
    const status = [
      `Host: ${window.location.host}`,
      `Room: ${roomId || ''}`,
      `WebSocket: ${wsStatus}`,
      `Token: ${getCurrentToken() ? 'present' : 'missing'}`,
      `User: ${user?.username || user?.nickname || ''}`,
      '',
      diagnosticsText,
    ].join('\n')
    await navigator.clipboard?.writeText(status)
    addClientLog('info', 'ui', 'diagnostics copied')
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 relative">
      {/* Header */}
      <header className="fc-mobile-glass bg-white border-b border-gray-200 px-3 sm:px-4 py-3 flex items-center justify-between shrink-0 sticky top-0 z-30">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700 shrink-0">← 返回</button>
          <h1 className="font-semibold text-gray-800 truncate">{room?.name || '加载中...'}</h1>
          {defaultAssistant && (
            <button
              type="button"
              onClick={() => openMemberProfile(defaultAssistant, 'agent')}
              className="hidden sm:flex items-center gap-1.5 rounded-full bg-gray-50 border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-blue-50 hover:text-blue-600 shrink-0"
              title={`助理${getAgentStatusLabel(defaultAssistant)}`}
            >
              <span className={`w-2 h-2 rounded-full ${getAgentStatusDotClass(defaultAssistant)}`}></span>
              <span>助理{getAgentStatusLabel(defaultAssistant)}</span>
            </button>
          )}
          <button onClick={() => setShowDiagnostics(true)} className="text-gray-400 hover:text-gray-600 text-sm ml-1 shrink-0" title="诊断日志（Ctrl/⌘+Shift+D）"><Wrench className="w-4 h-4" /></button>
          <button onClick={() => navigate(`/room/${roomId}/settings`)} className="text-gray-400 hover:text-gray-600 text-sm ml-1 shrink-0"><Settings className="w-4 h-4" /></button>
        </div>
        <button
          onClick={() => setShowMobileMembers(true)}
          className="fc-pressable md:hidden relative flex items-center gap-1.5 px-3 py-2 rounded-full bg-blue-50 text-blue-600 text-xs font-medium shrink-0 shadow-sm active:bg-blue-100"
        >
          <Users className="w-4 h-4" />
          {members.length + roomAgents.length}
          {workingAgents.length > 0 && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-yellow-400 agent-breathing shadow-[0_0_0_4px_rgba(250,204,21,0.25)]" />}
        </button>
      </header>

      {/* Desktop tab bar */}
      <div className="hidden md:flex border-b border-gray-200 bg-white shrink-0">
        {panels.map((p) => (
          <button
            key={p.key}
            className={`fc-pressable px-4 py-2 text-sm font-medium transition-colors ${activePanel === p.key ? 'text-blue-600 border-b-2 border-blue-600 fc-tab-active' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
            onClick={() => setActivePanel(p.key)}
          >
            {p.icon === 'message' && <MessageCircle className="inline w-4 h-4 mr-1" />}
            {p.icon === 'folder' && <Folder className="inline w-4 h-4 mr-1" />}
            {p.icon === 'panels' && <PanelsTopLeft className="inline w-4 h-4 mr-1" />}
            {p.icon === 'check' && <ListTodo className="inline w-4 h-4 mr-1" />}
            {p.label}
          </button>
        ))}
      </div>

      {activePanel === 'chat' && pendingInteractions.length > 0 && (
        <div className="mx-3 mb-2 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>？有 {pendingInteractions.length} 个待你处理的请求</span>
          <button onClick={() => document.getElementById(`interaction-${pendingInteractions[pendingInteractions.length - 1]?.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-amber-700">查看</button>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {!showMembers && (
          <button
            onClick={() => setShowMembers(true)}
            className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 z-20 w-7 h-12 rounded-r-full bg-white border border-l-0 border-gray-200 shadow-md text-gray-400 hover:text-blue-600 items-center justify-center"
            title="展开成员面板"
          >
            <PanelLeftOpen className="w-4 h-4" />
            {workingAgents.length > 0 && <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-yellow-400 agent-breathing shadow-[0_0_0_4px_rgba(250,204,21,0.25)]" />}
          </button>
        )}
        {/* Left: Panel content */}
        <div className="flex-1 flex flex-col overflow-hidden">
        {activePanel === 'chat' && (
          <div className="h-full flex flex-col">
            <div ref={messagesScrollRef} className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 sm:py-4 space-y-3 relative bg-gradient-to-b from-gray-50/70 to-white sm:bg-none">
              {messages.map((msg) => {
                const isOwn = msg.actorId === user?.id
                const displayName = isOwn ? '我' : msg.actorName
                const avatar = isOwn ? user?.avatar : getActorAvatar(msg)
                const actorMember = isOwn ? user : getActorMember(msg)
                const actorAgent = msg.actorRole === 'ai' ? (getActorAgent(msg) || { name: displayName, roleType: 'assistant', status: 'active' }) : null
                const showUnreadMarker = unreadMarkerAt && !isOwn && (msg.createdAt || 0) > unreadMarkerAt && !messages.slice(0, messages.findIndex((m) => m.id === msg.id)).some((m) => m.actorId !== user?.id && (m.createdAt || 0) > unreadMarkerAt)
                const isAgentReceipt = msg.kind === 'agent_receipt'
                return (
                    <div key={msg.id} id={`msg-${msg.id}`} className="fc-enter">
                      {showUnreadMarker && (
                        <div className="my-3 flex items-center gap-3 text-xs text-blue-500">
                          <span className="h-px flex-1 bg-blue-100"></span>
                          <span>以下是未读消息</span>
                          <span className="h-px flex-1 bg-blue-100"></span>
                        </div>
                      )}
                  <div className={`flex items-end gap-2 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                    {!isOwn && (msg.actorRole === 'ai' ? (
                      <button type="button" onClick={() => openMemberProfile(actorAgent, 'agent')} className="shrink-0 hover:ring-2 hover:ring-blue-200 rounded-full">
                        {renderAgentAvatar(actorAgent, 'w-10 h-10 sm:w-12 sm:h-12', 'w-5 h-5 sm:w-6 sm:h-6')}
                      </button>
                    ) : (
                      <button type="button" onClick={() => actorMember && openMemberProfile(actorMember, 'member')} className="shrink-0 hover:ring-2 hover:ring-blue-200 rounded-full">
                        {renderAvatar(displayName, avatar, 'w-10 h-10 sm:w-12 sm:h-12')}
                      </button>
                    ))}
                    <div className={`max-w-[84%] sm:max-w-[80%] rounded-2xl sm:rounded-xl px-3 sm:px-4 py-2 shadow-sm ${isAgentReceipt ? 'bg-gray-50 border border-dashed border-gray-200 text-gray-500' : (isOwn ? 'bg-blue-600 text-white shadow-blue-500/10' : 'bg-white border border-gray-200 text-gray-800')}`}>
                      <button
                        type="button"
                        onClick={() => msg.actorRole === 'ai' ? openMemberProfile(actorAgent, 'agent') : actorMember && openMemberProfile(actorMember, 'member')}
                        className={`block text-xs mb-1 text-left ${isAgentReceipt ? 'text-gray-400' : (isOwn ? 'text-blue-200' : 'text-gray-400 hover:text-blue-500')}`}
                      >
                        {msg.actorRole === 'ai' ? 'AI · ' : ''}{displayName}
                      </button>
                      {msg.kind === 'interaction_request' ? renderInteractionCard(msg) : <p className={`${isAgentReceipt ? 'text-xs' : 'text-sm'} whitespace-pre-wrap`}>{renderMessageContent(msg.content, isOwn)}</p>}
                    </div>
                    {isOwn && (
                      <button type="button" onClick={() => actorMember && openMemberProfile(actorMember, 'member')} className="shrink-0 hover:ring-2 hover:ring-blue-200 rounded-full">
                        {renderAvatar(displayName, avatar, 'w-10 h-10 sm:w-12 sm:h-12')}
                      </button>
                    )}
                  </div>
                    </div>
                )
              })}
              <div ref={messagesEndRef} />
              {roomNewMessageCount > 0 && (
                <button onClick={scrollToBottomAndRead} className="fc-pressable sticky bottom-2 mx-auto block rounded-full bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-lg shadow-blue-500/20">
                  有 {roomNewMessageCount} 条新消息
                </button>
              )}
            </div>
            <form onSubmit={sendMessage} className="fc-mobile-glass p-3 sm:p-4 bg-white border-t border-gray-200 shrink-0 relative safe-area-inset-bottom">
              {showMentionPopup && (filteredMembers.length > 0 || filteredAgents.length > 0) && (
                <div className="fc-sheet-pop absolute bottom-full left-3 right-3 sm:left-4 sm:right-4 bg-white border border-gray-200 rounded-2xl shadow-xl max-h-72 overflow-y-auto z-10 mb-2">
                  {filteredMembers.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50">成员</div>
                      {filteredMembers.map((m) => (
                        <div key={m.id || m.userId} className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm flex items-center gap-2" onClick={() => insertMention(m, 'member')}>
                          {renderAvatar(getMemberDisplayName(m), getMemberAvatar(m), 'w-6 h-6')}
                          <span className="flex-1">{getMemberDisplayName(m)}</span>
                        </div>
                      ))}
                    </>
                  )}
                  {filteredAgents.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50">AI Agents</div>
                      {filteredAgents.map((a) => (
                        <div key={a.id} className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm flex items-center gap-2" onClick={() => insertMention(a, 'agent')}>
                          {renderAgentAvatar(a, 'w-6 h-6', 'w-4 h-4')}
                          <span className="flex-1">{a.name}</span>
                          <span className="text-xs text-gray-400">
                            {getAgentStatusLabel(a)}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
              {sendError && !wsNoticeDismissed && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <span>{sendError.replace('正在重连...', '实时同步暂不可用，但消息可正常发送')}</span>
                  <button type="button" onClick={() => setWsNoticeDismissed(true)} className="text-amber-500 hover:text-amber-700">×</button>
                </div>
              )}
              <div className="flex gap-2 items-center rounded-2xl bg-gray-50 border border-gray-200 p-1.5 shadow-inner focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-300 transition-all">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={handleInputChange}
                  placeholder="输入消息，@提及成员..."
                  className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-base sm:text-sm border-0 rounded-xl focus:ring-0 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="fc-pressable fc-mobile-touch bg-blue-600 text-white px-4 sm:px-6 py-2 rounded-xl hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed shadow-sm shadow-blue-500/20"
                >
                  发送
                </button>
              </div>
            </form>
          </div>
        )}

        {activePanel === 'files' && (
          <div className="h-full flex">
            <div className={`${currentFile ? 'hidden sm:block' : 'block'} w-full sm:w-64 border-r border-gray-200 bg-white overflow-y-auto p-3 shrink-0`}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-700">文件</h3>
                  <p className="text-xs text-gray-400 mt-0.5">仅显示已加入当前 Tab 配置的文件</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={createFile} className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100">+文件</button>
                  <button onClick={createFolder} className="text-xs bg-gray-50 text-gray-600 px-2 py-1 rounded hover:bg-gray-100">+目录</button>
                </div>
              </div>
              {files.length > 0 ? renderFileTree(files) : (
                <div className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-400 text-center">
                  当前 Tab 没有配置要显示的文件
                </div>
              )}
            </div>
            <div className={`${currentFile ? 'flex' : 'hidden sm:flex'} flex-1 flex-col overflow-hidden`}>
              {currentFile ? (
                <>
                  <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
                    <div className="flex items-center gap-2 min-w-0">
                      <button onClick={() => setCurrentFile(null)} className="sm:hidden text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">← 文件列表</button>
                      <span className="text-sm text-gray-600 font-mono truncate">{currentFile.path}{fileDirty ? ' *' : ''}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveFile} className="text-xs bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600">保存</button>
                      <button onClick={() => setCurrentFile(null)} className="hidden sm:inline text-xs bg-gray-200 text-gray-600 px-3 py-1 rounded hover:bg-gray-300">关闭</button>
                    </div>
                  </div>
                  <textarea
                    value={currentFile.content}
                    onChange={(e) => { setCurrentFile({ ...currentFile, content: e.target.value }); setFileDirty(true) }}
                    className="flex-1 p-4 font-mono text-sm resize-none focus:outline-none"
                  />
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-400">
                  <p>选择一个文件以查看/编辑</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activePanel === 'tabs' && (
          <div className="h-full flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200 overflow-x-auto shrink-0">
              {tabs.map((tab) => (
                <div key={tab.id} className={`flex items-center gap-1 px-3 py-1 rounded-t text-sm cursor-pointer ${activeTabId === tab.id ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
                  <span onClick={() => setActiveTabId(tab.id)}>{tab.icon || '📄'} {getTabTitle(tab)}</span>
                  <button onClick={() => editingTabId === tab.id ? setEditingTabId(null) : beginEditTab(tab)} className="text-xs text-gray-400 hover:text-gray-600"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => deleteTab(tab.id)} className="text-xs text-red-400 hover:text-red-600">×</button>
                </div>
              ))}
              <button onClick={() => setShowCreateTab(!showCreateTab)} className="text-sm text-blue-500 hover:text-blue-700 px-2">+ 新建</button>
            </div>
            {showCreateTab && (
              <div className="p-4 bg-white border-b border-gray-200 space-y-2">
                <input value={newTabName} onChange={(e) => setNewTabName(e.target.value)} placeholder="标签名称" className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
                <textarea value={newTabContent} onChange={(e) => setNewTabContent(e.target.value)} placeholder="HTML 内容" className="w-full px-3 py-2 border border-gray-300 rounded text-sm h-24 font-mono" />
                <button onClick={createTab} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">创建</button>
              </div>
            )}
            {tabError && <div className="px-4 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100">{tabError}</div>}
            <div className="flex-1 overflow-hidden">
              {activeTabId && tabs.find((t) => t.id === activeTabId) ? (
                editingTabId === activeTabId ? (
                  <div className="h-full flex flex-col">
                    <div className="flex flex-col sm:flex-row gap-2 p-3 bg-white border-b border-gray-200">
                      <input
                        value={editingTabTitle}
                        onChange={(e) => setEditingTabTitle(e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
                        placeholder="标签标题"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => updateTab(activeTabId)} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">保存</button>
                        <button onClick={() => setEditingTabId(null)} className="bg-gray-100 text-gray-600 px-4 py-2 rounded text-sm hover:bg-gray-200">取消</button>
                      </div>
                    </div>
                    <textarea
                      value={editingTabContent}
                      onChange={(e) => setEditingTabContent(e.target.value)}
                      className="flex-1 p-4 font-mono text-sm resize-none focus:outline-none"
                    />
                  </div>
                ) : (
                  <iframe srcDoc={tabs.find((t) => t.id === activeTabId)!.content} className="w-full h-full border-0" sandbox="allow-scripts" title="tab-content" />
                )
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-400 h-full">
                  <p>选择一个标签页或创建新的</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activePanel === 'tasks' && (
          <div className="h-full flex flex-col bg-gray-50">
            <div className="p-3 sm:p-4 bg-white border-b border-gray-200 shrink-0">
              {sendError && !wsNoticeDismissed && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <span>{sendError.replace('正在重连...', '实时同步暂不可用，但消息可正常发送')}</span>
                  <button type="button" onClick={() => setWsNoticeDismissed(true)} className="text-amber-500 hover:text-amber-700">×</button>
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="输入新任务标题..."
                  className="flex-1 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  onKeyDown={(e) => e.key === 'Enter' && createTask()}
                  disabled={creatingTask}
                />
                <button
                  onClick={createTask}
                  disabled={creatingTask}
                  className="bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60"
                >
                  {creatingTask ? '创建中...' : '创建任务'}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 bg-gradient-to-b from-gray-50/80 to-white md:bg-none">
              {(() => {
                const activeTasks = tasks.filter((t) => !archivedTaskStatuses.includes(t.status))
                const archivedTasks = tasks.filter((t) => archivedTaskStatuses.includes(t.status))
                if (tasks.length === 0) {
                  return (
                    <div className="h-full flex items-center justify-center text-center text-gray-400">
                      <div>
                        <ListTodo className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                        <p className="text-sm">暂无任务，先创建一个吧</p>
                      </div>
                    </div>
                  )
                }
                return (
                  <div className="space-y-4">
                    {activeTasks.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-400">暂无进行中的任务</div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
                        {kanbanCols.map((col) => {
                          const colTasks = activeTasks.filter((t) => col.statuses.includes(getEffectiveTaskStatus(t)))
                          return (
                            <section key={col.key} className="fc-mobile-card bg-white md:bg-gray-100 rounded-2xl md:rounded-lg border md:border-0 border-gray-100 p-3 shadow-sm md:shadow-none">
                              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center justify-between">
                                <span>{col.label}</span>
                                <span className="text-xs font-normal text-gray-400 bg-gray-100 md:bg-white px-2 py-0.5 rounded-full">{colTasks.length}</span>
                              </h3>
                              <div className="space-y-2">
                                {colTasks.length === 0 ? (
                                  <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 py-6 text-center text-xs text-gray-400">暂无任务</div>
                                ) : (
                                  colTasks.map((task) => renderTaskCard(task, col.key))
                                )}
                              </div>
                            </section>
                          )
                        })}
                      </div>
                    )}
                    {archivedTasks.length > 0 && (
                      <section className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
                        <button type="button" onClick={() => setShowArchivedTasks((value) => !value)} className="w-full flex items-center justify-between text-left text-sm font-semibold text-gray-600">
                          <span>已归档</span>
                          <span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{archivedTasks.length} · {showArchivedTasks ? '收起' : '展开'}</span>
                        </button>
                        {showArchivedTasks && (
                          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                            {archivedTasks.map((task) => renderTaskCard(task, 'done'))}
                          </div>
                        )}
                      </section>
                    )}
                  </div>
                )
              })()}
            </div>
          </div>
        )}
        </div>

        {/* Left: Members panel (desktop) */}
        {showMembers && (
          <div className="order-first w-64 border-r border-gray-200 bg-white overflow-y-auto shrink-0 hidden md:block relative">
            <button
              onClick={() => setShowMembers(false)}
              className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-12 rounded-full bg-white border border-gray-200 shadow-sm text-gray-400 hover:text-blue-600 flex items-center justify-center"
              title="收起成员面板"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
            <div className="p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center justify-between">
                房间成员
                <span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{members.length}</span>
              </h3>
              <div className="space-y-1">
                {members.map((member) => (
                  <button key={member.id || member.userId} type="button" onClick={() => openMemberProfile(member, 'member')} className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-blue-50 transition-colors text-left">
                    <div className="relative">
                      {renderAvatar(getMemberDisplayName(member), getMemberAvatar(member), 'w-9 h-9')}
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 border-2 border-white rounded-full"></div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {getMemberDisplayName(member)}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {member.username && member.username !== getMemberDisplayName(member) ? `@${member.username}` : '在线'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>

              {roomAgents.length > 0 && (
                <>
                  <h3 className="text-sm font-semibold text-gray-700 mt-6 mb-4 flex items-center justify-between">
                    AI Agents
                    <span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{roomAgents.length}</span>
                  </h3>
                  <div className="space-y-1">
                    {roomAgents.map((agent) => (
                      <button key={agent.id} type="button" onClick={() => openMemberProfile(agent, 'agent')} className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-blue-50 transition-colors text-left">
                        {renderAgentAvatar(agent, 'w-9 h-9', 'w-5 h-5')}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {agent.name}
                          </p>
                          <p className="text-xs text-gray-400 flex items-center gap-1">
                            {agent.roleType === 'assistant' ? <ShieldCheck className="w-3 h-3" /> : <Wrench className="w-3 h-3" />}
                            <span>{agent.roleType === 'assistant' ? '助理' : '专家'}</span>
                            <span>· {getAgentStatusLabel(agent)}</span>
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mobile members drawer */}
      {showMobileMembers && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setShowMobileMembers(false)}>
          <div className="w-full max-w-md bg-white rounded-t-3xl max-h-[82vh] overflow-y-auto animate-slideUp shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 fc-mobile-glass bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between rounded-t-3xl z-10">
              <div>
                <h3 className="font-semibold text-gray-800">成员与 AI</h3>
                <p className="text-xs text-gray-400">成员 {members.length} · Agent {roomAgents.length}</p>
              </div>
              <button onClick={() => setShowMobileMembers(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-2">
              <h4 className="px-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">在线成员</h4>
              {members.map((member) => (
                <button key={member.id || member.userId} type="button" onClick={() => openMemberProfile(member, 'member')} className="fc-pressable w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-blue-50 transition-colors text-left active:bg-blue-100/70">
                  <div className="relative">
                    {renderAvatar(getMemberDisplayName(member), getMemberAvatar(member), 'w-11 h-11')}
                    <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-400 border-2 border-white rounded-full"></div>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-800">{getMemberDisplayName(member)}</p>
                    <p className="text-sm text-gray-400">
                      {member.username && member.username !== getMemberDisplayName(member) ? `@${member.username}` : '在线'}
                    </p>
                  </div>
                </button>
              ))}
              {roomAgents.length > 0 && (
                <>
                  <h4 className="px-1 pt-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">AI Agents</h4>
                  {roomAgents.map((agent) => (
                    <button key={agent.id} type="button" onClick={() => openMemberProfile(agent, 'agent')} className="fc-pressable w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-blue-50 transition-colors text-left active:bg-blue-100/70">
                      {renderAgentAvatar(agent, 'w-11 h-11', 'w-5 h-5')}
                      <div className="flex-1">
                        <p className="font-medium text-gray-800">{agent.name}</p>
                        <p className="text-sm text-gray-400 flex items-center gap-1">
                          {agent.roleType === 'assistant' ? <ShieldCheck className="w-3 h-3" /> : <Wrench className="w-3 h-3" />}
                          <span>{agent.roleType === 'assistant' ? '助理' : '专家'}</span>
                          <span>· {getAgentStatusLabel(agent)}</span>
                        </p>
                        {agent.specialties && agent.specialties.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {agent.specialties.map((s: string) => (
                              <span key={s} className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{s}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedProfile && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => setSelectedProfile(null)}>
          <div className="fc-sheet-pop w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-2xl shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3 min-w-0">
                {selectedProfile.kind === 'agent' ? renderAgentAvatar(selectedProfile, 'w-14 h-14', 'w-7 h-7') : renderAvatar(selectedProfile.name, selectedProfile.avatar, 'w-14 h-14')}
                <div className="min-w-0">
                  <p className="font-semibold text-gray-800 truncate">{selectedProfile.name}</p>
                  <p className="text-sm text-gray-400 truncate">{selectedProfile.subtitle}</p>
                </div>
              </div>
              <button onClick={() => setSelectedProfile(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
                <span className="text-gray-500">类型</span>
                <span className="font-medium text-gray-700 inline-flex items-center gap-1">
                  {selectedProfile.kind === 'agent' ? <Bot className="w-4 h-4" /> : <UserRound className="w-4 h-4" />}
                  {selectedProfile.kind === 'agent' ? 'AI Agent' : '项目成员'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
                <span className="text-gray-500">状态</span>
                <span className="font-medium text-gray-700 inline-flex items-center gap-1.5">
                  {selectedProfile.kind === 'agent' && <span className={`w-2 h-2 rounded-full ${getAgentStatusDotClass(selectedProfile)}`}></span>}
                  {selectedProfile.status}
                </span>
              </div>
              {selectedProfile.kind === 'agent' && (
                <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
                  <span className="text-gray-500">角色</span>
                  <span className="font-medium text-gray-700 inline-flex items-center gap-1">
                    {selectedProfile.roleType === 'assistant' ? <ShieldCheck className="w-4 h-4" /> : <Wrench className="w-4 h-4" />}
                    {selectedProfile.roleType === 'assistant' ? '助理' : '专家'}
                  </span>
                </div>
              )}
              {selectedProfile.specialties?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {selectedProfile.specialties.map((s: string) => <span key={s} className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-full">{s}</span>)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom tab nav */}
      <nav className="fc-mobile-glass md:hidden flex border-t border-gray-200 bg-white shrink-0 safe-area-inset-bottom shadow-[0_-8px_24px_rgba(15,23,42,0.06)]">
        {panels.map((p) => (
          <button
            key={p.key}
            className={`fc-pressable flex-1 py-2 text-center transition-colors ${activePanel === p.key ? 'text-blue-600 fc-tab-active' : 'text-gray-400'}`}
            onClick={() => setActivePanel(p.key)}
          >
            <div className="flex justify-center mb-0.5">
              <span className="relative">
                {p.icon === 'message' && <MessageCircle className="w-5 h-5" />}
                {p.key === 'chat' && roomNewMessageCount > 0 && <span className="absolute -right-2 -top-2 min-w-[16px] rounded-full bg-red-500 px-1 text-[10px] leading-4 text-white">{roomNewMessageCount > 99 ? '99+' : roomNewMessageCount}</span>}
              </span>
              {p.icon === 'folder' && <Folder className="w-5 h-5" />}
              {p.icon === 'panels' && <PanelsTopLeft className="w-5 h-5" />}
              {p.icon === 'check' && <ListTodo className="w-5 h-5" />}
            </div>
            <div className="text-xs">{p.label}</div>
          </button>
        ))}
      </nav>

      {fileDialogType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl">
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">{fileDialogType === 'file' ? '新建文件' : '新建目录'}</h3>
              <p className="mt-1 text-xs text-gray-500">支持路径，例如 docs/report.md 或 docs</p>
            </div>
            <div className="p-5">
              <input
                autoFocus
                value={fileDialogPath}
                onChange={(e) => setFileDialogPath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitFileDialog()}
                placeholder={fileDialogType === 'file' ? 'docs/report.md' : 'docs'}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100">
              <button onClick={() => setFileDialogType(null)} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm hover:bg-gray-200">取消</button>
              <button onClick={submitFileDialog} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">创建</button>
            </div>
          </div>
        </div>
      )}

      {showDiagnostics && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-3">
          <div className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-xl bg-white shadow-2xl flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div>
                <h3 className="font-semibold text-gray-800">诊断日志</h3>
                <p className="text-xs text-gray-500">仅保存在当前浏览器内存，不包含完整 token</p>
              </div>
              <button onClick={() => setShowDiagnostics(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 border-b border-gray-100 p-4 text-xs">
              <div><span className="text-gray-400">WS</span><div className="font-mono">{wsStatus}</div></div>
              <div><span className="text-gray-400">Token</span><div className="font-mono">{getCurrentToken() ? 'present' : 'missing'}</div></div>
              <div><span className="text-gray-400">Room</span><div className="font-mono truncate">{roomId}</div></div>
              <div><span className="text-gray-400">Host</span><div className="font-mono truncate">{window.location.host}</div></div>
              <div><span className="text-gray-400">Logs</span><div className="font-mono">{clientLogs.length}</div></div>
            </div>
            <div className="flex gap-2 border-b border-gray-100 p-3">
              <button onClick={copyDiagnostics} className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"><Clipboard className="w-3.5 h-3.5" />复制日志</button>
              <button onClick={() => clearClientLogs()} className="inline-flex items-center gap-1 rounded bg-gray-100 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200"><Trash2 className="w-3.5 h-3.5" />清空</button>
            </div>
            <pre className="flex-1 overflow-auto bg-gray-950 p-4 text-[11px] leading-relaxed text-gray-100 whitespace-pre-wrap">
{diagnosticsText || '暂无日志'}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
