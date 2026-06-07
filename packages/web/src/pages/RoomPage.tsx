import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { api } from '../lib/api'

interface Message {
  id: string
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

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const { user, token } = useAuthStore()
  const [room, setRoom] = useState<any>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [members, setMembers] = useState<any[]>([])
  const [activePanel, setActivePanel] = useState<Panel>('chat')
  const [tasks, setTasks] = useState<any[]>([])
  const [files, setFiles] = useState<FileNode[]>([])
  const [currentFile, setCurrentFile] = useState<{ path: string; content: string } | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [showMentionPopup, setShowMentionPopup] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTabName, setNewTabName] = useState('')
  const [newTabContent, setNewTabContent] = useState('')
  const [showCreateTab, setShowCreateTab] = useState(false)
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [showMembers, setShowMembers] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!roomId) return
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
    } catch { navigate('/') }
  }

  const connectWs = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${token}`)
    wsRef.current = ws
    ws.onopen = () => {
      ws.send(JSON.stringify({ action: 'room.join', payload: { room_id: roomId } }))
      ws.send(JSON.stringify({ action: 'chat.history', payload: { room_id: roomId } }))
      ws.send(JSON.stringify({ action: 'task.list', payload: { room_id: roomId } }))
    }
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.action === 'chat.message') {
        setMessages((prev) => [...prev, msg.payload])
      } else if (msg.action === 'chat.history_result') {
        setMessages(msg.payload.messages || [])
      } else if (msg.action === 'chat.edited') {
        setMessages((prev) => prev.map((m) => (m.id === msg.payload.id ? { ...m, ...msg.payload } : m)))
      } else if (msg.action === 'chat.deleted') {
        setMessages((prev) => prev.filter((m) => m.id !== msg.payload.message_id))
      } else if (msg.action === 'room.members_update') {
        setMembers(msg.payload.members || [])
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

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || !wsRef.current) return
    wsRef.current.send(JSON.stringify({ action: 'chat.send', payload: { content: input.trim() } }))
    setInput('')
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInput(val)
    // Check for @mention
    const cursorPos = e.target.selectionStart || 0
    const beforeCursor = val.slice(0, cursorPos)
    const atMatch = beforeCursor.match(/@(\w*)$/)
    if (atMatch) {
      setShowMentionPopup(true)
      setMentionFilter(atMatch[1].toLowerCase())
    } else {
      setShowMentionPopup(false)
    }
  }

  const insertMention = (member: any) => {
    const cursorPos = inputRef.current?.selectionStart || input.length
    const beforeCursor = input.slice(0, cursorPos)
    const afterCursor = input.slice(cursorPos)
    const atIdx = beforeCursor.lastIndexOf('@')
    const newInput = beforeCursor.slice(0, atIdx) + `@${member.nickname || member.username} ` + afterCursor
    setInput(newInput)
    setShowMentionPopup(false)
    inputRef.current?.focus()
  }

  const filteredMembers = members.filter((m) =>
    (m.nickname || m.username || '').toLowerCase().includes(mentionFilter)
  )

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
      await api.createTab(roomId!, { name: newTabName, content: newTabContent || '<h1>Hello</h1>' })
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
  const renderMessageContent = (content: string) => {
    const parts = content.split(/(@\w+)/g)
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return <span key={i} className="inline-block bg-blue-100 text-blue-700 px-1 rounded text-xs font-medium">{part}</span>
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
            <span className="text-sm">{node.type === 'directory' ? '📁' : '📄'}</span>
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
    { key: 'chat', label: '聊天', icon: '💬' },
    { key: 'files', label: '文件', icon: '📁' },
    { key: 'tabs', label: '标签', icon: '📑' },
    { key: 'tasks', label: '任务', icon: '✅' },
  ]

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700">← 返回</button>
          <h1 className="font-semibold text-gray-800">{room?.name || '加载中...'}</h1>
          <button onClick={() => navigate(`/room/${roomId}/settings`)} className="text-gray-400 hover:text-gray-600 text-sm ml-2">⚙️</button>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className="w-2 h-2 bg-green-400 rounded-full"></span>
          <span className="hidden sm:inline">{members.length} 人在线</span>
        </div>
      </header>

      {/* Desktop tab bar */}
      <div className="hidden md:flex border-b border-gray-200 bg-white shrink-0">
        {panels.map((p) => (
          <button
            key={p.key}
            className={`px-4 py-2 text-sm font-medium ${activePanel === p.key ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActivePanel(p.key)}
          >
            {p.icon} {p.label}
          </button>
        ))}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Panel content */}
        <div className="flex-1 flex flex-col overflow-hidden">
        {activePanel === 'chat' && (
          <div className="h-full flex flex-col">
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.actorRole === 'ai' ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[80%] rounded-xl px-4 py-2 ${msg.actorRole === 'ai' ? 'bg-white border border-gray-200' : 'bg-blue-600 text-white'}`}>
                    <div className={`text-xs mb-1 ${msg.actorRole === 'ai' ? 'text-gray-400' : 'text-blue-200'}`}>
                      {msg.actorRole === 'ai' ? '🤖 ' : ''}{msg.actorName}
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{renderMessageContent(msg.content)}</p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <form onSubmit={sendMessage} className="p-4 bg-white border-t border-gray-200 shrink-0 relative">
              {showMentionPopup && filteredMembers.length > 0 && (
                <div className="absolute bottom-full left-4 right-4 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto z-10">
                  {filteredMembers.map((m) => (
                    <div key={m.id} className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm" onClick={() => insertMention(m)}>
                      {m.nickname || m.username}
                    </div>
                  ))}
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
                  <button onClick={() => setEditingTabId(editingTabId === tab.id ? null : tab.id)} className="text-xs text-gray-400 hover:text-gray-600">✏️</button>
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

        {/* Right: Members panel (desktop) */}
        {showMembers && (
          <div className="w-64 border-l border-gray-200 bg-white overflow-y-auto shrink-0 hidden md:block">
            <div className="p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center justify-between">
                房间成员
                <span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{members.length}</span>
              </h3>
              <div className="space-y-1">
                {members.map((member) => (
                  <div key={member.id || member.userId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors">
                    <div className="relative">
                      <div className="w-9 h-9 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white text-sm font-medium">
                        {(member.nickname || member.username || '?')[0].toUpperCase()}
                      </div>
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 border-2 border-white rounded-full"></div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {member.nickname || member.username}
                      </p>
                      <p className="text-xs text-gray-400">
                        {member.role === 'owner' ? '👑 房主' : member.role === 'editor' ? '✏️ 编辑者' : '👁 查看者'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile members drawer */}
      {showMembers && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setShowMembers(false)}>
          <div className="w-full max-w-md bg-white rounded-t-2xl max-h-[70vh] overflow-y-auto animate-slideUp" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between rounded-t-2xl">
              <h3 className="font-semibold text-gray-800">成员列表 <span className="text-sm font-normal text-gray-400">({members.length})</span></h3>
              <button onClick={() => setShowMembers(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-1">
              {members.map((member) => (
                <div key={member.id || member.userId} className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors">
                  <div className="relative">
                    <div className="w-11 h-11 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white font-semibold">
                      {(member.nickname || member.username || '?')[0].toUpperCase()}
                    </div>
                    <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-400 border-2 border-white rounded-full"></div>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-800">{member.nickname || member.username}</p>
                    <p className="text-sm text-gray-400">
                      {member.role === 'owner' ? '👑 房主' : member.role === 'editor' ? '✏️ 编辑者' : '👁 查看者'}
                    </p>
                  </div>
                </div>
              ))}
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
            <div className="text-lg">{p.icon}</div>
            <div className="text-xs">{p.label}</div>
          </button>
        ))}
      </nav>
    </div>
  )
}
