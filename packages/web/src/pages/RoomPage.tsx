import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { api } from '../lib/api'
import { Bot, CheckSquare, FileText, Folder, MessageCircle, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Pencil, Settings, ShieldCheck, UserRound, Users, Wrench, X } from 'lucide-react'

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
  name: string
  content: string
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
  const [room, setRoom] = useState<any>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [members, setMembers] = useState<any[]>([])
  const [roomAgents, setRoomAgents] = useState<any[]>([])
  const [activePanel, setActivePanel] = useState<Panel>('chat')
  const [tasks, setTasks] = useState<any[]>([])
  const [files, setFiles] = useState<FileNode[]>([])
  const [currentFile, setCurrentFile] = useState<{ path: string; content: string } | null>(null)
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
  const [showMembers, setShowMembers] = useState(true)
  const [showMobileMembers, setShowMobileMembers] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState<any | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!roomId) return
    api.markConversationRead('project', roomId).catch(() => {})
    const cachedMessages = readCachedMessages(roomId)
    if (cachedMessages.length > 0) setMessages(cachedMessages)
    loadRoom()
    connectWs()
    return () => { wsRef.current?.close() }
  }, [roomId])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const loadRoom = async () => {
    try {
      const data = await api.getRoom(roomId!)
      setRoom(data.room)
      setMembers(data.members)
      // Load files and tabs
      try { const fd = await api.getFiles(roomId!); setFiles(fd.files || []) } catch {}
      try { const td = await api.getTabs(roomId!); setTabs(td.tabs || []) } catch {}
      try { const ra = await api.getRoomAgents(roomId!); setRoomAgents(ra.agents || []) } catch {}
    } catch { navigate('/') }
  }

  const connectWs = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${token}`)
    wsRef.current = ws
    ws.onopen = () => {
      ws.send(JSON.stringify({ action: 'room.join', payload: { room_id: roomId } }))
      ws.send(JSON.stringify({ action: 'chat.history', payload: { room_id: roomId, limit: 100 } }))
      ws.send(JSON.stringify({ action: 'task.list', payload: { room_id: roomId } }))
    }
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
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
        setRoomAgents((prev) => prev.map((a) => a.id === msg.payload.agentId ? { ...a, status: msg.payload.status } : a))
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
  }

  const loadFiles = useCallback(async () => {
    if (!roomId) return
    try { const fd = await api.getFiles(roomId); setFiles(fd.files || []) } catch {}
  }, [roomId])

  const loadTabs = useCallback(async () => {
    if (!roomId) return
    try { const td = await api.getTabs(roomId); setTabs(td.tabs || []) } catch {}
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

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    const content = input.trim()
    if (!content || !wsRef.current) return
    wsRef.current.send(JSON.stringify({ action: 'chat.send', payload: { content, mentions: buildMentionsForSend(content) } }))
    setInput('')
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
        status: target.status === 'active' ? '在线' : target.status === 'working' ? '工作中' : '离线',
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
    try {
      const data = await api.getFileContent(roomId!, node.path)
      setCurrentFile({ path: node.path, content: data.content })
    } catch {}
  }

  const saveFile = async () => {
    if (!currentFile) return
    try {
      await api.saveFile(roomId!, currentFile.path, currentFile.content)
      loadFiles()
    } catch {}
  }

  const deleteFile = async (path: string) => {
    if (!confirm('确定删除此文件？')) return
    try { await api.deleteFile(roomId!, path); loadFiles(); if (currentFile?.path === path) setCurrentFile(null) } catch {}
  }

  const createFile = async () => {
    const name = prompt('输入文件名（含路径）:')
    if (!name) return
    try { await api.saveFile(roomId!, name, ''); loadFiles() } catch {}
  }

  const createFolder = async () => {
    const name = prompt('输入文件夹名:')
    if (!name) return
    try { await api.mkdir(roomId!, name); loadFiles() } catch {}
  }

  // Tab operations
  const createTab = async () => {
    if (!newTabName.trim()) return
    try {
      await api.createTab(roomId!, { title: newTabName, content: newTabContent || '<h1>Hello</h1>' })
      setNewTabName('')
      setNewTabContent('')
      setShowCreateTab(false)
      loadTabs()
    } catch {}
  }

  const deleteTab = async (tabId: string) => {
    try { await api.deleteTab(roomId!, tabId); loadTabs(); if (activeTabId === tabId) setActiveTabId(null) } catch {}
  }

  const updateTab = async (tabId: string, content: string) => {
    try { await api.updateTab(roomId!, tabId, { content }); loadTabs(); setEditingTabId(null) } catch {}
  }

  // Task operations
  const createTask = () => {
    if (!newTaskTitle.trim() || !wsRef.current) return
    wsRef.current.send(JSON.stringify({ action: 'task.create', payload: { title: newTaskTitle.trim(), status: 'todo' } }))
    setNewTaskTitle('')
  }

  const updateTaskStatus = (task: any, status: string) => {
    if (!wsRef.current) return
    wsRef.current.send(JSON.stringify({ action: 'task.update', payload: { id: task.id, status } }))
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
  const panels: { key: Panel; label: string; icon: string }[] = [
    { key: 'chat', label: '聊天', icon: 'message' },
    { key: 'files', label: '文件', icon: 'folder' },
    { key: 'tabs', label: '标签', icon: 'panels' },
    { key: 'tasks', label: '任务', icon: 'check' },
  ]

  return (
    <div className="h-screen flex flex-col bg-gray-50 relative">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-3 sm:px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700 shrink-0">← 返回</button>
          <h1 className="font-semibold text-gray-800 truncate">{room?.name || '加载中...'}</h1>
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
                              a.status === 'active' ? 'bg-green-400' :
                              a.status === 'working' ? 'bg-yellow-400' : 'bg-gray-400'
                            }`}></div>
                          </div>
                          <span className="flex-1">{a.name}</span>
                          <span className="text-xs text-gray-400">
                            {a.status === 'active' ? '在线' : a.status === 'working' ? '工作中' : '离线'}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
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
                <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors">发送</button>
              </div>
            </form>
          </div>
        )}

        {activePanel === 'files' && (
          <div className="h-full flex">
            <div className="w-64 border-r border-gray-200 bg-white overflow-y-auto p-3 shrink-0 hidden sm:block">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">文件</h3>
                <div className="flex gap-1">
                  <button onClick={createFile} className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100">+文件</button>
                  <button onClick={createFolder} className="text-xs bg-gray-50 text-gray-600 px-2 py-1 rounded hover:bg-gray-100">+目录</button>
                </div>
              </div>
              {renderFileTree(files)}
            </div>
            <div className="flex-1 flex flex-col overflow-hidden">
              {currentFile ? (
                <>
                  <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
                    <span className="text-sm text-gray-600 font-mono">{currentFile.path}</span>
                    <div className="flex gap-2">
                      <button onClick={saveFile} className="text-xs bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600">保存</button>
                      <button onClick={() => setCurrentFile(null)} className="text-xs bg-gray-200 text-gray-600 px-3 py-1 rounded hover:bg-gray-300">关闭</button>
                    </div>
                  </div>
                  <textarea
                    value={currentFile.content}
                    onChange={(e) => setCurrentFile({ ...currentFile, content: e.target.value })}
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
                  <span onClick={() => setActiveTabId(tab.id)}>{tab.name}</span>
                  <button onClick={() => setEditingTabId(editingTabId === tab.id ? null : tab.id)} className="text-xs text-gray-400 hover:text-gray-600"><Pencil className="w-4 h-4" /></button>
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
            <div className="flex-1 overflow-hidden">
              {activeTabId && tabs.find((t) => t.id === activeTabId) ? (
                editingTabId === activeTabId ? (
                  <div className="h-full flex flex-col">
                    <textarea
                      defaultValue={tabs.find((t) => t.id === activeTabId)!.content}
                      className="flex-1 p-4 font-mono text-sm resize-none focus:outline-none"
                      onBlur={(e) => updateTab(activeTabId, e.target.value)}
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
                            agent.status === 'active' ? 'bg-green-400' :
                            agent.status === 'working' ? 'bg-yellow-400' : 'bg-gray-400'
                          }`}></div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {agent.name}
                          </p>
                          <p className="text-xs text-gray-400 flex items-center gap-1">
                            {agent.roleType === 'assistant' ? <ShieldCheck className="w-3 h-3" /> : <Wrench className="w-3 h-3" />}
                            <span>{agent.roleType === 'assistant' ? '助理' : '专家'}</span>
                            {agent.status === 'active' && <span>· 在线</span>}
                            {agent.status === 'working' && <span>· 工作中</span>}
                            {agent.status === 'inactive' && <span>· 离线</span>}
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
                          agent.status === 'active' ? 'bg-green-400' :
                          agent.status === 'working' ? 'bg-yellow-400' : 'bg-gray-400'
                        }`}></div>
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-gray-800">{agent.name}</p>
                        <p className="text-sm text-gray-400 flex items-center gap-1">
                          {agent.roleType === 'assistant' ? <ShieldCheck className="w-3 h-3" /> : <Wrench className="w-3 h-3" />}
                          <span>{agent.roleType === 'assistant' ? '助理' : '专家'}</span>
                          {agent.status === 'active' && <span>· 在线</span>}
                          {agent.status === 'working' && <span>· 工作中</span>}
                          {agent.status === 'inactive' && <span>· 离线</span>}
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
    </div>
  )
}
