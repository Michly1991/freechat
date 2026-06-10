import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { api } from '../../lib/api'
import { addClientLog, formatClientLogs, getClientLogs, subscribeClientLogs, type ClientLogEntry } from '../../lib/clientLog'
import { useFeedback } from '../../components/FeedbackProvider'
import { PanelLeftOpen } from 'lucide-react'
import { AgentRecoveryBanner } from './components/AgentRecoveryBanner'
import { InteractionCard } from './components/InteractionCard'
import { RoomChatPanel } from './components/RoomChatPanel'
import { RoomFilesPanel } from './components/RoomFilesPanel'
import { RoomTabsPanel } from './components/RoomTabsPanel'
import { RoomTasksPanel } from './components/RoomTasksPanel'
import { DesktopMembersPanel, MobileMembersDrawer, ProfileModal } from './components/RoomMembers'
import { DesktopPanelTabs, DiagnosticsDialog, FileDialog, MobileBottomNav, RoomHeader } from './components/RoomShellChrome'
import { createRoomAgentActions } from './room-agent-actions'
import { createRoomFileActions, createRoomTabActions, createRoomTaskActions } from './room-actions'
import { createRoomRuntimeActions } from './room-realtime'
import { getAgentOnlineStatus, getAgentStatusDotClass, getAgentStatusLabel, getMemberAvatar, getMemberDisplayName, renderAgentAvatar, renderAvatar } from './room-ui-utils'
import { mergeMessages, readCachedMessages, writeCachedMessages, type FileNode, type Message, type Panel, type Tab } from '../room-page-model'
export function RoomPageImpl() {
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
  const [selectedMentions, setSelectedMentions] = useState<any[]>([])
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
  const { loadRoom, connectWs, sendWs, loadFiles, loadTabs } = createRoomRuntimeActions({
    roomId, navigate, feedback, user, activePanel, wsRef, reconnectTimerRef, reconnectAttemptsRef,
    manuallyClosedRef, wsConnectIdRef, isChatNearBottom, getCurrentToken, setRoom, setMembers,
    setFiles, setTabs, setRoomAgents, setTasks, setMessages, setWsStatus, setSendError,
    setPendingInteractions, setLastReadAt, setRoomNewMessageCount,
  })
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
    const addFiles = (nodes: FileNode[]) => nodes.forEach((node) => {
      if (node.type === 'directory') addFiles(node.children || [])
      else if (content.includes(`@${node.name}`) && !mentions.some((x) => (x.type === 'file' || x.role === 'file') && x.path === node.path)) mentions.push({ id: node.path, name: node.name, role: 'file', type: 'file', path: node.path })
    })
    addFiles(files)
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
  const defaultAssistant = roomAgents.find((agent) => agent.roleType === 'assistant') || roomAgents[0]
  const workingAgents = roomAgents.filter((agent) => getAgentOnlineStatus(agent) === 'working')
  const errorAgents = roomAgents.filter((agent) => getAgentOnlineStatus(agent) === 'error' || agent.status === 'error')
  const getActorMember = (msg: Message) => members.find((m) => (m.userId || m.id) === msg.actorId)
  const getActorAgent = (msg: Message) => roomAgents.find((a) => a.id === msg.actorId || a.name === msg.actorName)
  const getActorAvatar = (msg: Message) => getActorMember(msg)?.avatar || ''
  const openMemberProfile = (target: any, kind: 'member' | 'agent') => {
    if (kind === 'member') {
      setSelectedProfile({ kind, name: getMemberDisplayName(target), username: target.username, avatar: getMemberAvatar(target), subtitle: target.username ? `@${target.username}` : '项目成员', status: '在线' })
    } else {
      setSelectedProfile({ kind, id: target.id, name: target.name, subtitle: target.roleType === 'assistant' ? '助理 Agent' : '专家 Agent', roleType: target.roleType, status: getAgentStatusLabel(target), onlineStatus: getAgentOnlineStatus(target), specialties: target.specialties || [] })
    }
  }
  const renderAssigneeBadge = (item: any, compact = false) => {
    if (!item?.assigneeName) return null
    const labelClass = compact ? 'text-[10px] text-gray-400 gap-1.5' : 'text-xs text-gray-400 gap-1.5', avatarSize = compact ? 'w-4 h-4' : 'w-5 h-5', iconSize = compact ? 'w-2.5 h-2.5' : 'w-3 h-3'
    if (item.assigneeType === 'agent') { const agent = roomAgents.find((a) => a.id === item.assigneeId || a.name === item.assigneeName) || { name: item.assigneeName, roleType: item.assigneeName.includes('助理') ? 'assistant' : 'specialist', status: 'active' }; return <span className={`inline-flex items-center ${labelClass}`}>{renderAgentAvatar(agent, avatarSize, iconSize)}<span>{item.assigneeName}</span></span> }
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
  const allFiles = (nodes: FileNode[]): FileNode[] => nodes.flatMap((node) => node.type === 'directory' ? allFiles(node.children || []) : [node])
  const filteredFiles = allFiles(files).filter((f) => f.name.toLowerCase().includes(mentionFilter) || f.path.toLowerCase().includes(mentionFilter)).slice(0, 20)
  const insertMention = (target: any, type: 'member' | 'agent' | 'file') => {
    const name = type === 'member' ? getMemberDisplayName(target) : target.name
    const cursorPos = inputRef.current?.selectionStart || input.length
    const beforeCursor = input.slice(0, cursorPos)
    const afterCursor = input.slice(cursorPos)
    const atIdx = beforeCursor.lastIndexOf('@')
    const newInput = beforeCursor.slice(0, atIdx) + `@${name} ` + afterCursor
    setInput(newInput)
    setSelectedMentions((prev) => {
      const mention = type === 'file' ? { id: target.path, name, role: 'file', type: 'file', path: target.path } : { id: target.id || target.userId, name, role: type === 'agent' ? 'ai' as const : 'human' as const }
      return prev.some((m) => m.id === mention.id && m.role === mention.role) ? prev : [...prev, mention]
    })
    setShowMentionPopup(false)
    inputRef.current?.focus()
  }
  const { openFile, saveFile, deleteFile, createFile, createFolder, uploadLocalFile, submitFileDialog } = createRoomFileActions({
    roomId, fileDirty, currentFile, setCurrentFile, setFileDirty, fileDialogType, fileDialogPath,
    setFileDialogType, setFileDialogPath, feedback, loadFiles,
  })
  const { createTab, deleteTab, updateTab, beginEditTab } = createRoomTabActions({
    roomId, newTabName, newTabContent, setNewTabName, setNewTabContent, setShowCreateTab,
    setTabError, feedback, loadTabs, activeTabId, setActiveTabId, editingTabTitle,
    editingTabContent, setEditingTabId, setEditingTabTitle, setEditingTabContent,
  })
  const { createTask, updateTaskStatus, retryTaskFailedItems, deleteTask, toggleTaskExpanded, createSubtask, updateSubtaskStatus, retrySubtask, deleteSubtask } = createRoomTaskActions({
    newTaskTitle, setNewTaskTitle, setCreatingTask, newSubtaskTitles, setNewSubtaskTitles,
    feedback, sendWs, setExpandedTaskIds,
  })
  const { restartAgent, restartAllErrorAgents } = createRoomAgentActions({ errorAgents, feedback, sendWs })
  const renderInteractionCard = (msg: Message) => (
    <InteractionCard
      msg={msg}
      roomId={roomId}
      interactionSelections={interactionSelections}
      setInteractionSelections={setInteractionSelections}
      interactionInputs={interactionInputs}
      setInteractionInputs={setInteractionInputs}
      submittingInteractions={submittingInteractions}
      setSubmittingInteractions={setSubmittingInteractions}
      setMessages={setMessages}
      api={api}
      feedback={feedback}
    />
  )
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
      <RoomHeader
        room={room}
        roomId={roomId}
        members={members}
        roomAgents={roomAgents}
        workingAgents={workingAgents}
        defaultAssistant={defaultAssistant}
        openMemberProfile={openMemberProfile}
        setShowDiagnostics={setShowDiagnostics}
        setShowMobileMembers={setShowMobileMembers}
        navigate={navigate}
      />
      <DesktopPanelTabs activePanel={activePanel} setActivePanel={setActivePanel} />
      <AgentRecoveryBanner errorAgents={errorAgents} restartAllAgents={restartAllErrorAgents} />
      {activePanel === 'chat' && pendingInteractions.length > 0 && (
        <div className="mx-3 mb-2 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>？有 {pendingInteractions.length} 个待你处理的请求</span>
          <button onClick={() => document.getElementById(`interaction-${pendingInteractions[pendingInteractions.length - 1]?.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-amber-700">查看</button>
        </div>
      )}
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
        <div className="flex-1 flex flex-col overflow-hidden">
        {activePanel === 'chat' && (
          <RoomChatPanel messages={messages} user={user} unreadMarkerAt={unreadMarkerAt} messagesScrollRef={messagesScrollRef} messagesEndRef={messagesEndRef} roomNewMessageCount={roomNewMessageCount} scrollToBottomAndRead={scrollToBottomAndRead} sendMessage={sendMessage} showMentionPopup={showMentionPopup} filteredMembers={filteredMembers} filteredAgents={filteredAgents} filteredFiles={filteredFiles} insertMention={insertMention} inputRef={inputRef} input={input} handleInputChange={handleInputChange} sendError={sendError} wsNoticeDismissed={wsNoticeDismissed} setWsNoticeDismissed={setWsNoticeDismissed} renderInteractionCard={renderInteractionCard} getActorAvatar={getActorAvatar} getActorMember={getActorMember} getActorAgent={getActorAgent} openMemberProfile={openMemberProfile} />
        )}
        {activePanel === 'files' && (
          <RoomFilesPanel files={files} currentFile={currentFile} setCurrentFile={setCurrentFile} fileDirty={fileDirty} setFileDirty={setFileDirty} openFile={openFile} saveFile={saveFile} deleteFile={deleteFile} createFile={createFile} createFolder={createFolder} uploadLocalFile={uploadLocalFile} />
        )}
        {activePanel === 'tabs' && (
          <RoomTabsPanel
            tabs={tabs}
            activeTabId={activeTabId}
            setActiveTabId={setActiveTabId}
            showCreateTab={showCreateTab}
            setShowCreateTab={setShowCreateTab}
            newTabName={newTabName}
            setNewTabName={setNewTabName}
            newTabContent={newTabContent}
            setNewTabContent={setNewTabContent}
            createTab={createTab}
            deleteTab={deleteTab}
            editingTabId={editingTabId}
            setEditingTabId={setEditingTabId}
            editingTabTitle={editingTabTitle}
            setEditingTabTitle={setEditingTabTitle}
            editingTabContent={editingTabContent}
            setEditingTabContent={setEditingTabContent}
            updateTab={updateTab}
            beginEditTab={beginEditTab}
            tabError={tabError}
          />
        )}
        {activePanel === 'tasks' && (
          <RoomTasksPanel
            tasks={tasks}
            sendError={sendError}
            wsNoticeDismissed={wsNoticeDismissed}
            setWsNoticeDismissed={setWsNoticeDismissed}
            newTaskTitle={newTaskTitle}
            setNewTaskTitle={setNewTaskTitle}
            creatingTask={creatingTask}
            createTask={createTask}
            expandedTaskIds={expandedTaskIds}
            toggleTaskExpanded={toggleTaskExpanded}
            newSubtaskTitles={newSubtaskTitles}
            setNewSubtaskTitles={setNewSubtaskTitles}
            showArchivedTasks={showArchivedTasks}
            setShowArchivedTasks={setShowArchivedTasks}
            updateTaskStatus={updateTaskStatus}
            retryTaskFailedItems={retryTaskFailedItems}
            deleteTask={deleteTask}
            createSubtask={createSubtask}
            updateSubtaskStatus={updateSubtaskStatus}
            retrySubtask={retrySubtask}
            deleteSubtask={deleteSubtask}
            renderAssigneeBadge={renderAssigneeBadge}
          />
        )}
        </div>
        <DesktopMembersPanel
          showMembers={showMembers}
          setShowMembers={setShowMembers}
          members={members}
          roomAgents={roomAgents}
          openMemberProfile={openMemberProfile}
          restartAgent={restartAgent}
        />
      </div>
      <MobileMembersDrawer
        showMobileMembers={showMobileMembers}
        setShowMobileMembers={setShowMobileMembers}
        members={members}
        roomAgents={roomAgents}
        openMemberProfile={openMemberProfile}
        restartAgent={restartAgent}
      />
      <ProfileModal
        selectedProfile={selectedProfile}
        setSelectedProfile={setSelectedProfile}
        restartAgent={restartAgent}
      />
      <MobileBottomNav activePanel={activePanel} setActivePanel={setActivePanel} roomNewMessageCount={roomNewMessageCount} />
      <FileDialog
        fileDialogType={fileDialogType}
        fileDialogPath={fileDialogPath}
        setFileDialogPath={setFileDialogPath}
        setFileDialogType={setFileDialogType}
        submitFileDialog={submitFileDialog}
      />
      <DiagnosticsDialog
        showDiagnostics={showDiagnostics}
        setShowDiagnostics={setShowDiagnostics}
        wsStatus={wsStatus}
        hasToken={!!getCurrentToken()}
        roomId={roomId}
        clientLogs={clientLogs}
        diagnosticsText={diagnosticsText}
        copyDiagnostics={copyDiagnostics}
      />
    </div>
  )
}
