import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { api } from '../lib/api'
import { addClientLog, clearClientLogs, formatClientLogs, getClientLogs, subscribeClientLogs, type ClientLogEntry } from '../lib/clientLog'
import { useFeedback } from '../components/FeedbackProvider'
import { Bot, CheckSquare, Clipboard, FileText, Folder, MessageCircle, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Pencil, Settings, ShieldCheck, Trash2, UserRound, Users, Wrench, X } from 'lucide-react'

interface Message {
  id: string
  actorId: string
  actorName: string
  actorRole: 'human' | 'ai'
  content: string
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
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const manuallyClosedRef = useRef(false)
  const wsConnectIdRef = useRef(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
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
    api.markConversationRead('project', roomId).catch(() => {})
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

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' })
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' }), 80)
    })
  }, [])

  useEffect(() => {
    if (messages.length === 0) return
    scrollToBottom(initialScrollDoneRef.current ? 'smooth' : 'auto')
    initialScrollDoneRef.current = true
  }, [messages.length, scrollToBottom])

  const loadRoom = async () => {
    try {
      const data = await api.getRoom(roomId!)
      setRoom(data.room)
      setMembers(data.members)
      // Load files and tabs
      try { const fd = await api.getFiles(roomId!); setFiles(fd.files || []) } catch (err: any) { addClientLog('error', 'ui', 'load files failed', { message: err?.message }) }
      try { const td = await api.getTabs(roomId!); setTabs(td.tabs || []) } catch (err: any) { addClientLog('error', 'ui', 'load tabs failed', { message: err?.message }) }
      try { const ra = await api.getRoomAgents(roomId!); setRoomAgents(ra.agents || []) } catch (err: any) { addClientLog('error', 'ui', 'load room agents failed', { message: err?.message }) }
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
        setMessages((prev) => {
          const next = mergeMessages(prev, [msg.payload])
          if (roomId) writeCachedMessages(roomId, next)
          return next
        })
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
      } else if (msg.action === 'agent.status_update') {
        setRoomAgents((prev) => prev.map((a) => a.id === msg.payload.agentId ? { ...a, ...msg.payload } : a))
      } else if (msg.action === 'task.list_result') {
        setTasks(msg.payload.tasks || [])
      } else if (msg.action === 'task.changed') {
        if (msg.payload.action === 'add') setTasks((prev) => [msg.payload.task, ...prev])
        else if (msg.payload.action === 'update') setTasks((prev) => prev.map((t) => (t.id === msg.payload.task.id ? msg.payload.task : t)))
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
    if (status === 'working') return 'bg-yellow-400 animate-pulse'
    if (status === 'offline') return 'bg-gray-400'
    if (status === 'error') return 'bg-red-500'
    return 'bg-green-400'
  }
  const defaultAssistant = roomAgents.find((agent) => agent.roleType === 'assistant') || roomAgents[0]

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
        name: target.name,
        subtitle: target.roleType === 'assistant' ? '助理 Agent' : '专家 Agent',
        roleType: target.roleType,
        status: getAgentStatusLabel(target),
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
  const createTask = () => {
    if (!newTaskTitle.trim()) return
    if (!sendWs('task.create', { title: newTaskTitle.trim(), status: 'todo' })) return
    setNewTaskTitle('')
  }

  const updateTaskStatus = (task: any, status: string) => {
    sendWs('task.update', { id: task.id, status })
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
    { key: 'done', label: '已完成', statuses: ['done', 'failed', 'cancelled'] },
  ]

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
      <header className="bg-white border-b border-gray-200 px-3 sm:px-4 py-3 flex items-center justify-between shrink-0">
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
          className="md:hidden flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-blue-50 text-blue-600 text-xs font-medium shrink-0"
        >
          <Users className="w-4 h-4" />
          {members.length + roomAgents.length}
        </button>
      </header>

      {/* Desktop tab bar */}
      <div className="hidden md:flex border-b border-gray-200 bg-white shrink-0">
        {panels.map((p) => (
          <button
            key={p.key}
            className={`px-4 py-2 text-sm font-medium ${activePanel === p.key ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActivePanel(p.key)}
          >
            {p.icon === 'message' && <MessageCircle className="inline w-4 h-4 mr-1" />}
            {p.icon === 'folder' && <Folder className="inline w-4 h-4 mr-1" />}
            {p.icon === 'panels' && <PanelsTopLeft className="inline w-4 h-4 mr-1" />}
            {p.icon === 'check' && <CheckSquare className="inline w-4 h-4 mr-1" />}
            {p.label}
          </button>
        ))}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {!showMembers && (
          <button
            onClick={() => setShowMembers(true)}
            className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 z-20 w-7 h-12 rounded-r-full bg-white border border-l-0 border-gray-200 shadow-md text-gray-400 hover:text-blue-600 items-center justify-center"
            title="展开成员面板"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}
        {/* Left: Panel content */}
        <div className="flex-1 flex flex-col overflow-hidden">
        {activePanel === 'chat' && (
          <div className="h-full flex flex-col">
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.map((msg) => {
                const isOwn = msg.actorId === user?.id
                const displayName = isOwn ? '我' : msg.actorName
                const avatar = isOwn ? user?.avatar : getActorAvatar(msg)
                const actorMember = isOwn ? user : getActorMember(msg)
                const actorAgent = msg.actorRole === 'ai' ? (getActorAgent(msg) || { name: displayName, roleType: 'assistant', status: 'active' }) : null
                return (
                  <div key={msg.id} className={`flex items-end gap-2 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                    {!isOwn && (msg.actorRole === 'ai' ? (
                      <button type="button" onClick={() => openMemberProfile(actorAgent, 'agent')} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-green-400 to-blue-500 flex items-center justify-center text-white shrink-0 hover:ring-2 hover:ring-blue-200"><Bot className="w-5 h-5 sm:w-6 sm:h-6" /></button>
                    ) : (
                      <button type="button" onClick={() => actorMember && openMemberProfile(actorMember, 'member')} className="shrink-0 hover:ring-2 hover:ring-blue-200 rounded-full">
                        {renderAvatar(displayName, avatar, 'w-10 h-10 sm:w-12 sm:h-12')}
                      </button>
                    ))}
                    <div className={`max-w-[78%] sm:max-w-[80%] rounded-xl px-3 sm:px-4 py-2 ${isOwn ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-800'}`}>
                      <button
                        type="button"
                        onClick={() => msg.actorRole === 'ai' ? openMemberProfile(actorAgent, 'agent') : actorMember && openMemberProfile(actorMember, 'member')}
                        className={`block text-xs mb-1 text-left ${isOwn ? 'text-blue-200' : 'text-gray-400 hover:text-blue-500'}`}
                      >
                        {msg.actorRole === 'ai' ? 'AI · ' : ''}{displayName}
                      </button>
                      <p className="text-sm whitespace-pre-wrap">{renderMessageContent(msg.content, isOwn)}</p>
                    </div>
                    {isOwn && (
                      <button type="button" onClick={() => actorMember && openMemberProfile(actorMember, 'member')} className="shrink-0 hover:ring-2 hover:ring-blue-200 rounded-full">
                        {renderAvatar(displayName, avatar, 'w-10 h-10 sm:w-12 sm:h-12')}
                      </button>
                    )}
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>
            <form onSubmit={sendMessage} className="p-4 bg-white border-t border-gray-200 shrink-0 relative">
              {showMentionPopup && (filteredMembers.length > 0 || filteredAgents.length > 0) && (
                <div className="absolute bottom-full left-4 right-4 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto z-10">
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
                          <div className="relative">
                            <div className="w-6 h-6 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center text-white text-xs">
                              <Bot className="w-4 h-4" />
                            </div>
                            <div className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 border border-white rounded-full ${
                              getAgentStatusDotClass(a)
                            }`}></div>
                          </div>
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
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={handleInputChange}
                  placeholder="输入消息，@提及成员..."
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
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
          <div className="h-full flex flex-col">
            <div className="p-4 bg-white border-b border-gray-200 shrink-0">
              {sendError && !wsNoticeDismissed && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <span>{sendError.replace('正在重连...', '实时同步暂不可用，但消息可正常发送')}</span>
                  <button type="button" onClick={() => setWsNoticeDismissed(true)} className="text-amber-500 hover:text-amber-700">×</button>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="新任务标题..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  onKeyDown={(e) => e.key === 'Enter' && createTask()}
                />
                <button onClick={createTask} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">创建</button>
              </div>
            </div>
            <div className="flex-1 overflow-x-auto overflow-y-auto p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 min-w-[800px] md:min-w-0">
                {kanbanCols.map((col) => (
                  <div key={col.key} className="bg-gray-100 rounded-lg p-3">
                    <h3 className="text-sm font-semibold text-gray-600 mb-3">{col.label}</h3>
                    <div className="space-y-2">
                      {tasks.filter((t) => col.statuses.includes(t.status)).map((task) => (
                        <div key={task.id} className="bg-white rounded-lg p-3 shadow-sm">
                          <p className="text-sm font-medium text-gray-800">{task.title}</p>
                          {task.assigneeName && <p className="text-xs text-gray-400 mt-1">👤 {task.assigneeName}</p>}
                          <div className="flex items-center gap-1 mt-2">
                            <span className={`text-xs px-2 py-0.5 rounded ${statusColors[task.status] || 'bg-gray-100'}`}>{task.status}</span>
                          </div>
                          <div className="flex gap-1 mt-2">
                            {col.key !== 'done' && (
                              <button onClick={() => updateTaskStatus(task, col.key === 'todo' ? 'doing' : col.key === 'doing' ? 'review' : 'done')} className="text-xs text-blue-500 hover:text-blue-700">→ 推进</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
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
                        <div className="relative">
                          <div className="w-9 h-9 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center text-white text-sm font-medium">
                            <Bot className="w-5 h-5" />
                          </div>
                          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 border-2 border-white rounded-full ${
                            getAgentStatusDotClass(agent)
                          }`}></div>
                        </div>
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
          <div className="w-full max-w-md bg-white rounded-t-2xl max-h-[75vh] overflow-y-auto animate-slideUp" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between rounded-t-2xl">
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
                <button key={member.id || member.userId} type="button" onClick={() => openMemberProfile(member, 'member')} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-blue-50 transition-colors text-left">
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
                    <button key={agent.id} type="button" onClick={() => openMemberProfile(agent, 'agent')} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-blue-50 transition-colors text-left">
                      <div className="relative">
                        <div className="w-11 h-11 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center text-white font-semibold">
                          <Bot className="w-5 h-5" />
                        </div>
                        <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 border-2 border-white rounded-full ${
                          getAgentStatusDotClass(agent)
                        }`}></div>
                      </div>
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
          <div className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3 min-w-0">
                {selectedProfile.kind === 'agent' ? (
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-green-400 to-blue-500 flex items-center justify-center text-white shrink-0"><Bot className="w-7 h-7" /></div>
                ) : renderAvatar(selectedProfile.name, selectedProfile.avatar, 'w-14 h-14')}
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
                <span className="font-medium text-gray-700">{selectedProfile.status}</span>
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
      <nav className="md:hidden flex border-t border-gray-200 bg-white shrink-0">
        {panels.map((p) => (
          <button
            key={p.key}
            className={`flex-1 py-2 text-center ${activePanel === p.key ? 'text-blue-600' : 'text-gray-400'}`}
            onClick={() => setActivePanel(p.key)}
          >
            <div className="flex justify-center mb-0.5">
              {p.icon === 'message' && <MessageCircle className="w-5 h-5" />}
              {p.icon === 'folder' && <Folder className="w-5 h-5" />}
              {p.icon === 'panels' && <PanelsTopLeft className="w-5 h-5" />}
              {p.icon === 'check' && <CheckSquare className="w-5 h-5" />}
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
