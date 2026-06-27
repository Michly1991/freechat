import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { api } from '../../lib/api'
import { addClientLog } from '../../lib/clientLog'
import { useFeedback } from '../../components/FeedbackProvider'
import { PanelLeftOpen } from 'lucide-react'
import { AgentRecoveryBanner } from './components/AgentRecoveryBanner'
import { InteractionCard } from './components/InteractionCard'
import { RoomMainPanel } from './components/RoomMainPanel'
import { DesktopMembersPanel, MobileMembersDrawer, ProfileModal } from './components/RoomMembers'
import { RoomSettingsSidePanel } from './components/RoomSettingsSidePanel'
import { AgentModelDialog } from './components/AgentModelDialog'
import { DesktopPanelTabs, FileDialog, MobileBottomNav, RoomHeader } from './components/RoomShellChrome'
import { createRoomAgentActions } from './room-agent-actions'
import { createRoomFileActions, createRoomTabActions, createRoomTaskActions } from './room-actions'
import { createRoomRuntimeActions } from './room-realtime'
import { createMessagePaginationActions, INITIAL_MESSAGE_LIMIT } from './room-message-pagination'
import { getAgentOnlineStatus, getMemberDisplayName } from './room-ui-utils'
import { createRoomProfileController } from './room-profile-controller'
import { useStreamingVoicePlayback } from '../../features/voice/useStreamingVoicePlayback'
import { mergeMessages, readCachedMessages, writeCachedMessages, type FileNode, type Message, type Panel, type Tab } from '../room-page-model'

export function RoomPageImpl() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const { user, token } = useAuthStore()
  const feedback = useFeedback()
  const [room, setRoom] = useState<any>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([])
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
  const [showRoomSettings, setShowRoomSettings] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState<any | null>(null)
  const [modelConfigAgent, setModelConfigAgent] = useState<any | null>(null)
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('connecting')
  const [sendError, setSendError] = useState('')
  const [wsNoticeDismissed, setWsNoticeDismissed] = useState(false)
  const [lastReadAt, setLastReadAt] = useState<number>(() => {
    try { return Number(sessionStorage.getItem(`freechat:room:${roomId}:lastReadAt`) || 0) } catch { return 0 }
  })
  const [unreadMarkerAt, setUnreadMarkerAt] = useState<number | null>(null)
  const [roomNewMessageCount, setRoomNewMessageCount] = useState(0), [hasMoreMessages, setHasMoreMessages] = useState(true), [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [interactionSelections, setInteractionSelections] = useState<Record<string, string[]>>({})
  const [interactionInputs, setInteractionInputs] = useState<Record<string, Record<string, string>>>({})
  const [submittingInteractions, setSubmittingInteractions] = useState<Record<string, boolean>>({})
  const [pendingInteractions, setPendingInteractions] = useState<any[]>([])
  const [voiceChatEnabled, setVoiceChatEnabled] = useState(false)
  const [voiceAvailable, setVoiceAvailable] = useState(false)
  const [voicePlaybackBusy, setVoicePlaybackBusy] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error'>('idle')
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const manuallyClosedRef = useRef(false)
  const wsConnectIdRef = useRef(0)
  const messagesEndRef = useRef<HTMLDivElement>(null), messagesScrollRef = useRef<HTMLDivElement>(null), initialScrollDoneRef = useRef(false), suppressNextAutoScrollRef = useRef(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const getCurrentToken = () => {
    if (token) return token
    try {
      return JSON.parse(localStorage.getItem('auth-storage') || '{}')?.state?.token || ''
    } catch {
      return ''
    }
  }
  useEffect(() => {
    if (!roomId) return
    initialScrollDoneRef.current = false
    const storedLastReadAt = Number(sessionStorage.getItem(`freechat:room:${roomId}:lastReadAt`) || 0)
    setLastReadAt(storedLastReadAt)
    setUnreadMarkerAt(storedLastReadAt || null)
    setRoomNewMessageCount(0)
    setHasMoreMessages(true)
    setLoadingOlderMessages(false)
    window.setTimeout(() => {
      api.markConversationRead('project', roomId).then(() => {
        const now = Date.now()
        setLastReadAt(now)
        sessionStorage.setItem(`freechat:room:${roomId}:lastReadAt`, String(now))
      }).catch(() => {})
    }, 1800)
    const cachedMessages = readCachedMessages(roomId)
    if (cachedMessages.length > 0) setMessages(cachedMessages.slice(-INITIAL_MESSAGE_LIMIT))
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
      scrollToBottom('auto')
      initialScrollDoneRef.current = true
      return
    }
    if (suppressNextAutoScrollRef.current) {
      suppressNextAutoScrollRef.current = false
      return
    }
    if (isChatNearBottom()) scrollToBottom('smooth')
  }, [messages.length, scrollToBottom])

  useEffect(() => {
    if (activePanel !== 'chat' || messages.length === 0) return
    scrollToBottom('auto')
  }, [activePanel, messages.length, scrollToBottom])

  useEffect(() => {
    let cancelled = false
    api.getVoiceConfigs()
      .then(({ configs }) => {
        if (cancelled) return
        const active = (configs || []).filter((cfg: any) => cfg.status !== 'deleted')
        const hasAsr = active.some((cfg: any) => cfg.asrEnabled)
        const hasTts = active.some((cfg: any) => cfg.ttsEnabled)
        const available = hasAsr && hasTts
        setVoiceAvailable(available)
        if (!available) setVoiceChatEnabled(false)
      })
      .catch(() => {
        if (!cancelled) { setVoiceAvailable(false); setVoiceChatEnabled(false) }
      })
    return () => { cancelled = true }
  }, [])

  const { handleMessagesScroll } = createMessagePaginationActions({
    roomId,
    messages,
    messagesScrollRef,
    initialScrollDoneRef,
    suppressNextAutoScrollRef,
    hasMoreMessages,
    loadingOlderMessages,
    setHasMoreMessages,
    setLoadingOlderMessages,
    setMessages,
    feedback,
  })

  useEffect(() => {
    const el = messagesScrollRef.current
    if (el && initialScrollDoneRef.current && !loadingOlderMessages && hasMoreMessages && messages.length > 0 && el.scrollHeight <= el.clientHeight + 24) void handleMessagesScroll()
  }, [messages.length, hasMoreMessages, loadingOlderMessages, handleMessagesScroll])

  const { primeVoicePlayback, interruptVoicePlayback, handleIncomingMessage, handleAgentStreamDelta, handleAgentStreamCompleted } = useStreamingVoicePlayback({ roomId, enabled: voiceChatEnabled, feedback, setVoicePlaybackBusy, setVoiceStatus })
  const { loadRoom, connectWs, sendWs, loadFiles, loadTabs } = createRoomRuntimeActions({
    roomId, navigate, feedback, user, activePanel, wsRef, reconnectTimerRef, reconnectAttemptsRef,
    manuallyClosedRef, wsConnectIdRef, isChatNearBottom, getCurrentToken, setRoom, setMembers,
    setFiles, setTabs, setActiveTabId, setRoomAgents, setTasks, setMessages, setWsStatus, setSendError,
    setPendingInteractions, setLastReadAt, setRoomNewMessageCount, setHasMoreMessages,
    onIncomingMessage: handleIncomingMessage,
    onAgentStreamDelta: handleAgentStreamDelta,
    onAgentStreamCompleted: handleAgentStreamCompleted,
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
  const sendTextMessage = async (rawContent: string) => {
    const content = rawContent.trim()
    if ((!content && pendingAttachments.length === 0) || !roomId) return false
    const mentions = buildMentionsForSend(content)
    if (pendingAttachments.length > 0) {
      try {
        const res = await api.sendRoomMessageWithFiles(roomId, content, pendingAttachments)
        setMessages((prev) => { const next = mergeMessages(prev, [res.message]); writeCachedMessages(roomId, next); return next })
        setPendingAttachments([])
      } catch (err: any) {
        setSendError(err?.message || '发送失败')
        return false
      }
    } else if (wsRef.current?.readyState === WebSocket.OPEN) {
      if (!sendWs('chat.send', { content, mentions })) return false
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
        return false
      }
    }
    scrollToBottom('smooth')
    setSelectedMentions([])
    return true
  }
  const addPendingAttachments = (list: FileList | null) => {
    if (!list?.length) return
    setPendingAttachments((prev) => [...prev, ...Array.from(list)].slice(0, 10))
  }
  const removePendingAttachment = (index: number) => setPendingAttachments((prev) => prev.filter((_, i) => i !== index))
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (await sendTextMessage(input)) setInput('')
  }
  const handleVoiceTranscript = async (text: string) => {
    setVoiceStatus('thinking')
    if (await sendTextMessage(text)) setInput('')
    else setVoiceStatus('error')
  }
  const enableVoiceChat = () => {
    setVoiceChatEnabled(true)
    setVoiceStatus('idle')
    primeVoicePlayback()
  }
  const disableVoiceChat = () => {
    setVoiceChatEnabled(false)
    interruptVoicePlayback()
    setVoiceStatus('idle')
  }
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
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
  const visibleRoomAgents = (() => {
    const primaryAssistant = roomAgents.find((agent) => agent.roleType === 'assistant' && agent.roomRole === 'assistant' && agent.autoEnabled)
    if (!primaryAssistant) return roomAgents
    return roomAgents.filter((agent) => !(agent.roleType === 'assistant' && agent.name === primaryAssistant.name && agent.id !== primaryAssistant.id && agent.roomRole !== 'assistant'))
  })()
  const defaultAssistant = visibleRoomAgents.find((agent) => room?.currentAssistantAgentId ? agent.id === room.currentAssistantAgentId : agent.autoEnabled) || visibleRoomAgents[0]
  const workingAgents = visibleRoomAgents.filter((agent) => getAgentOnlineStatus(agent) === 'working')
  const errorAgents = visibleRoomAgents.filter((agent) => getAgentOnlineStatus(agent) === 'error' || agent.status === 'error')
  const { getActorMember, getActorAgent, getActorAvatar, openMemberProfile, renderAssigneeBadge } = createRoomProfileController({ members, roomAgents: visibleRoomAgents, setSelectedProfile })
  const filteredMembers = members.filter((m) => {
    const id = m.id || m.userId
    if (id === user?.id) return false
    return getMemberDisplayName(m).toLowerCase().includes(mentionFilter)
  })
  const filteredAgents = visibleRoomAgents.filter((a) =>
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
    roomId, newTaskTitle, setNewTaskTitle, setCreatingTask, newSubtaskTitles, setNewSubtaskTitles,
    feedback, setExpandedTaskIds, setTasks,
  })
  const { restartAgent, restartAllErrorAgents } = createRoomAgentActions({ roomId, errorAgents, workingAgents, feedback, refreshAgents: loadRoom })
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
  return (
    <div className="h-screen flex flex-col bg-gray-50 relative">
      <RoomHeader
        room={room}
        members={members}
        roomAgents={visibleRoomAgents}
        workingAgents={workingAgents}
        defaultAssistant={defaultAssistant}
        openMemberProfile={openMemberProfile}
        setShowMobileMembers={setShowMobileMembers}
        openSettings={() => setShowRoomSettings(true)}
        navigate={navigate}
      />
      <DesktopPanelTabs activePanel={activePanel} setActivePanel={setActivePanel} agentWorking={workingAgents.length > 0} />
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
          <RoomMainPanel
            {...{ roomId, activePanel, messages, user, unreadMarkerAt, messagesScrollRef, messagesEndRef, roomNewMessageCount, scrollToBottomAndRead, sendMessage, pendingAttachments, onAddAttachments: addPendingAttachments, onRemoveAttachment: removePendingAttachment, showMentionPopup, filteredMembers, filteredAgents, filteredFiles, insertMention, inputRef, input, handleInputChange, voiceAvailable, voiceChatEnabled, voiceStatus, voiceBusy: voicePlaybackBusy, onVoiceEnable: enableVoiceChat, onVoiceDisable: disableVoiceChat, onVoiceTranscript: handleVoiceTranscript, onVoiceRecordingChange: (recording: boolean) => { if (recording) setVoiceStatus('listening') }, onVoiceBusyChange: (busy: boolean) => { if (busy) setVoiceStatus('transcribing') }, sendError, wsNoticeDismissed, setWsNoticeDismissed, renderInteractionCard, getActorAvatar, getActorMember, getActorAgent, openMemberProfile, handleMessagesScroll, loadingOlderMessages, hasMoreMessages, files, currentFile, setCurrentFile, fileDirty, setFileDirty, openFile, saveFile, deleteFile, createFile, createFolder, uploadLocalFile, activeTabId, tabs, roomAgents: visibleRoomAgents, feedback, showCreateTab, setShowCreateTab, newTabName, setNewTabName, newTabContent, setNewTabContent, createTab, deleteTab, editingTabId, setEditingTabId, editingTabTitle, setEditingTabTitle, editingTabContent, setEditingTabContent, updateTab, beginEditTab, tabError, tasks, newTaskTitle, setNewTaskTitle, creatingTask, createTask, expandedTaskIds, toggleTaskExpanded, newSubtaskTitles, setNewSubtaskTitles, showArchivedTasks, setShowArchivedTasks, updateTaskStatus, retryTaskFailedItems, deleteTask, createSubtask, updateSubtaskStatus, retrySubtask, deleteSubtask, renderAssigneeBadge, setActiveTabId, restartAgent }}
          />
        </div>
        <DesktopMembersPanel
          showMembers={showMembers}
          setShowMembers={setShowMembers}
          members={members}
          roomAgents={visibleRoomAgents}
          openMemberProfile={openMemberProfile}
          restartAgent={restartAgent}
          openModelConfig={setModelConfigAgent}
          roomId={roomId}
          room={room}
          user={user}
          feedback={feedback}
          onMembersChanged={loadRoom}
        />
      </div>
      <MobileMembersDrawer
        showMobileMembers={showMobileMembers}
        setShowMobileMembers={setShowMobileMembers}
        members={members}
        roomAgents={visibleRoomAgents}
        openMemberProfile={openMemberProfile}
        restartAgent={restartAgent}
        openModelConfig={setModelConfigAgent}
        roomId={roomId}
        room={room}
        user={user}
        feedback={feedback}
        onMembersChanged={loadRoom}
      />
      <ProfileModal
        selectedProfile={selectedProfile}
        setSelectedProfile={setSelectedProfile}
        restartAgent={restartAgent}
      />
      <AgentModelDialog roomId={roomId} agent={modelConfigAgent} onClose={() => setModelConfigAgent(null)} onSaved={loadRoom} feedback={feedback} />
      <MobileBottomNav activePanel={activePanel} setActivePanel={setActivePanel} roomNewMessageCount={roomNewMessageCount} agentWorking={workingAgents.length > 0} />
      <RoomSettingsSidePanel
        open={showRoomSettings}
        onClose={() => setShowRoomSettings(false)}
        roomId={roomId}
        room={room ? { ...room, members } : room}
        roomAgents={visibleRoomAgents}
        user={user}
        feedback={feedback}
        restartAgent={restartAgent}
        onRoomChanged={loadRoom}
      />
      <FileDialog
        fileDialogType={fileDialogType}
        fileDialogPath={fileDialogPath}
        setFileDialogPath={setFileDialogPath}
        setFileDialogType={setFileDialogType}
        submitFileDialog={submitFileDialog}
      />
    </div>
  )
}
