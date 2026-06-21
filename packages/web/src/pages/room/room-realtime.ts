import { api } from '../../lib/api'
import { addClientLog } from '../../lib/clientLog'
import { playNotificationSound } from '../../features/notifications/notification-sound'
import { mergeMessages, writeCachedMessages } from '../room-page-model'

export function createRoomRuntimeActions(deps: any) {
  const { roomId, navigate, feedback, user, activePanel, wsRef, reconnectTimerRef, reconnectAttemptsRef, manuallyClosedRef, wsConnectIdRef, isChatNearBottom, getCurrentToken, setRoom, setMembers, setFiles, setTabs, setActiveTabId, setRoomAgents, setTasks, setMessages, setWsStatus, setSendError, setPendingInteractions, setLastReadAt, setRoomNewMessageCount, setHasMoreMessages, onIncomingMessage, onAgentStreamDelta, onAgentStreamCompleted } = deps

  const loadFiles = async () => { if (!roomId) return; try { const fd = await api.getFiles(roomId); setFiles(fd.files || []) } catch (err: any) { feedback.error(err?.message || '加载文件失败'); addClientLog('error', 'ui', 'load files failed', { message: err?.message }) } }
  const applyTabs = (td: { tabs?: any[]; defaultTabId?: string | null }) => {
    const nextTabs = td.tabs || []
    setTabs(nextTabs)
    setActiveTabId?.((current: string | null) => {
      if (current && nextTabs.some((tab: any) => tab.id === current)) return current
      if (td.defaultTabId && nextTabs.some((tab: any) => tab.id === td.defaultTabId)) return td.defaultTabId
      return nextTabs[0]?.id || null
    })
  }
  const loadTabs = async () => { if (!roomId) return; try { applyTabs(await api.getTabs(roomId)) } catch (err: any) { feedback.error(err?.message || '加载页面失败'); addClientLog('error', 'ui', 'load pages failed', { message: err?.message }) } }

  const loadRoom = async () => {
    try {
      const data = await api.getRoom(roomId!)
      setRoom(data.room); setMembers(data.members)
      try { const fd = await api.getFiles(roomId!); setFiles(fd.files || []) } catch (err: any) { addClientLog('error', 'ui', 'load files failed', { message: err?.message }) }
      try { applyTabs(await api.getTabs(roomId!)) } catch (err: any) { addClientLog('error', 'ui', 'load tabs failed', { message: err?.message }) }
      try { const ra = await api.getRoomAgents(roomId!); setRoomAgents(ra.agents || []) } catch (err: any) { addClientLog('error', 'ui', 'load room agents failed', { message: err?.message }) }
      try { const td = await api.getRoomTasks(roomId!); setTasks(td.tasks || []) } catch (err: any) { addClientLog('error', 'ui', 'load tasks failed', { message: err?.message }) }
      try { const md = await api.getRoomMessages(roomId!, 10); setHasMoreMessages?.(md.hasMore !== false); setMessages((prev: any[]) => { const next = mergeMessages(prev, md.messages || []); if (roomId) writeCachedMessages(roomId, next); return next }) } catch (err: any) { addClientLog('error', 'ui', 'load messages failed', { message: err?.message }) }
    } catch (err: any) { addClientLog('error', 'ui', 'load room failed, navigate home', { message: err?.message }); navigate('/') }
  }

  const scheduleReconnect = () => {
    if (manuallyClosedRef.current) return
    if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current)
    const delay = Math.min(5000, 1000 * Math.max(1, reconnectAttemptsRef.current))
    addClientLog('warn', 'ws', 'reconnect scheduled', { delay, attempts: reconnectAttemptsRef.current })
    reconnectTimerRef.current = window.setTimeout(() => { reconnectAttemptsRef.current += 1; connectWs() }, delay)
  }

  const connectWs = () => {
    if (!roomId) return
    const currentToken = getCurrentToken()
    if (!currentToken) { setWsStatus('closed'); setSendError('登录状态未就绪，请刷新或重新登录'); addClientLog('error', 'ws', 'connect skipped: token missing', { roomId }); return }
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) { addClientLog('info', 'ws', 'connect skipped: socket already active', { readyState: wsRef.current.readyState }); return }
    setWsStatus('connecting')
    const connectId = ++wsConnectIdRef.current
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(currentToken)}`
    addClientLog('info', 'ws', 'connecting', { url: `${protocol}//${window.location.host}/ws`, token: 'present', roomId, connectId })
    const ws = new WebSocket(wsUrl); wsRef.current = ws
    ws.onopen = () => { if (wsConnectIdRef.current !== connectId) return; reconnectAttemptsRef.current = 0; addClientLog('info', 'ws', 'open', { connectId }); setWsStatus('open'); setSendError(''); addClientLog('info', 'ws', 'send room.join/chat.history', { roomId }); ws.send(JSON.stringify({ action: 'room.join', payload: { room_id: roomId } })); ws.send(JSON.stringify({ action: 'chat.history', payload: { room_id: roomId, limit: 10 } })) }
    ws.onmessage = (event) => handleWsMessage(event, connectId)
    ws.onerror = () => { if (wsConnectIdRef.current !== connectId) return; addClientLog('error', 'ws', 'error event', { connectId }); setWsStatus('error'); setSendError('连接异常，正在尝试重连...') }
    ws.onclose = (event) => { if (wsConnectIdRef.current !== connectId) return; if (wsRef.current === ws) wsRef.current = null; addClientLog('warn', 'ws', 'close', { code: event.code, reason: event.reason, wasClean: event.wasClean, connectId }); if (manuallyClosedRef.current) return; setWsStatus('closed'); if (event.code === 4001) { setSendError(event.reason || '登录已过期，请重新登录'); return } setSendError(event.reason ? `连接已断开：${event.reason}，正在重连...` : '连接已断开，正在重连...'); scheduleReconnect() }
  }

  const handleWsMessage = (event: MessageEvent, connectId: number) => {
    if (wsConnectIdRef.current !== connectId) return
    const msg = JSON.parse(event.data)
    addClientLog('info', 'ws', 'message received', { action: msg.action, type: msg.type })
    if (msg.action === 'chat.message') {
      const isIncoming = msg.payload?.actorId !== user?.id, nearBottom = isChatNearBottom()
      const kind = msg.payload?.kind || 'text'
      const mentionsMe = Array.isArray(msg.payload?.mentions) && msg.payload.mentions.some((m: any) => (m.role === 'human' || m.type === 'user') && m.id === user?.id)
      const visibleCurrentChat = document.visibilityState === 'visible' && activePanel === 'chat' && nearBottom
      if (isIncoming && kind !== 'agent_receipt' && kind !== 'agent_stream') {
        if (mentionsMe) void playNotificationSound('mention', `mention:${roomId}`)
        else if (!visibleCurrentChat) void playNotificationSound('message', `message:${roomId}`)
      }
      if (isIncoming && activePanel === 'chat') nearBottom ? api.markConversationRead('project', roomId!).then(() => { const now = Date.now(); setLastReadAt(now); sessionStorage.setItem(`freechat:room:${roomId}:lastReadAt`, String(now)) }).catch(() => {}) : setRoomNewMessageCount((count: number) => count + 1)
      setMessages((prev: any[]) => { const withoutCompletedStream = msg.payload?.actorRole === 'ai' ? prev.filter((m) => !(m.kind === 'agent_stream' && m.actorId === msg.payload.actorId && m.payload?.status === 'completed')) : prev; const next = mergeMessages(withoutCompletedStream, [msg.payload]); if (roomId) writeCachedMessages(roomId, next); return next })
      onIncomingMessage?.(msg.payload)
    } else if (msg.action === 'agent.stream.started') {
      const streamMsg = { ...msg.payload, payload: { status: 'streaming', activities: msg.payload.activities || [] } }
      setMessages((prev: any[]) => mergeMessages(prev, [streamMsg]))
    } else if (msg.action === 'agent.stream.activity') {
      setMessages((prev: any[]) => prev.map((m) => {
        if (m.id !== msg.payload.id) return m
        const activity = { text: msg.payload.text, tool: msg.payload.tool, kind: msg.payload.kind, timestamp: msg.payload.timestamp }
        const activities = [...(m.payload?.activities || [])]
        const mergeIndex = activity.kind ? activities.findIndex((item: any) => item.kind === activity.kind) : -1
        if (mergeIndex >= 0) activities[mergeIndex] = { ...activities[mergeIndex], ...activity }
        else activities.push(activity)
        return { ...m, payload: { ...(m.payload || {}), status: 'streaming', activities } }
      }))
    } else if (msg.action === 'agent.stream.delta') {
      setMessages((prev: any[]) => prev.map((m) => (m.id === msg.payload.id ? { ...m, content: msg.payload.content || m.content, payload: { ...(m.payload || {}), status: 'streaming' } } : m)))
      onAgentStreamDelta?.(msg.payload)
    } else if (msg.action === 'agent.stream.completed') {
      setMessages((prev: any[]) => msg.payload.silent ? prev.filter((m) => m.id !== msg.payload.id) : prev.map((m) => m.id === msg.payload.id ? { ...m, content: msg.payload.content || m.content, payload: { ...(m.payload || {}), status: 'completed', finalMessageId: msg.payload.finalMessageId } } : m))
      if (!msg.payload.silent) onAgentStreamCompleted?.(msg.payload)
    } else if (msg.action === 'agent.stream.failed') {
      setMessages((prev: any[]) => prev.map((m) => m.id === msg.payload.id ? { ...m, payload: { ...(m.payload || {}), status: 'failed', error: msg.payload.error, activities: [...(m.payload?.activities || []), { text: `处理失败：${msg.payload.error}`, timestamp: Date.now() }] } } : m))
    } else if (msg.action === 'interaction.created') {
      if (msg.payload?.interaction?.status === 'pending') setPendingInteractions((prev: any[]) => [msg.payload.interaction, ...prev.filter((item) => item.id !== msg.payload.interaction.id)])
    } else if (msg.action === 'interaction.updated') {
      setMessages((prev: any[]) => prev.map((m) => (m.payload?.interactionId === msg.payload.interaction.id ? { ...m, payload: { ...(m.payload || {}), interaction: msg.payload.interaction } } : m)))
      setPendingInteractions((prev: any[]) => msg.payload.interaction.status === 'pending' ? [msg.payload.interaction, ...prev.filter((item) => item.id !== msg.payload.interaction.id)] : prev.filter((item) => item.id !== msg.payload.interaction.id))
    } else if (msg.action === 'chat.history_result') { setHasMoreMessages?.(msg.payload.hasMore !== false); setMessages((prev: any[]) => { const next = mergeMessages(prev, msg.payload.messages || []); if (roomId) writeCachedMessages(roomId, next); return next }) }
    else if (msg.action === 'chat.edited') setMessages((prev: any[]) => { const next = mergeMessages(prev.map((m) => (m.id === msg.payload.id ? { ...m, ...msg.payload } : m))); if (roomId) writeCachedMessages(roomId, next); return next })
    else if (msg.action === 'chat.deleted') setMessages((prev: any[]) => { const next = prev.filter((m) => m.id !== msg.payload.message_id); if (roomId) writeCachedMessages(roomId, next); return next })
    else if (msg.action === 'room.members_update') { setMembers(msg.payload.members || []); if (Array.isArray(msg.payload.agents)) setRoomAgents(msg.payload.agents) }
    else if (msg.action === 'room.updated') setRoom(msg.payload.room)
    else if (msg.action === 'agent.status_update') setRoomAgents((prev: any[]) => prev.map((a) => a.id === msg.payload.agentId ? { ...a, ...msg.payload } : a))
    else if (msg.action === 'task.list_result') setTasks(msg.payload.tasks || [])
    else if (msg.action === 'task.changed') { if (msg.payload.action === 'add') setTasks((prev: any[]) => prev.some((t) => t.id === msg.payload.task.id) ? prev.map((t) => (t.id === msg.payload.task.id ? msg.payload.task : t)) : [msg.payload.task, ...prev]); else if (msg.payload.action === 'update') setTasks((prev: any[]) => prev.some((t) => t.id === msg.payload.task.id) ? prev.map((t) => (t.id === msg.payload.task.id ? msg.payload.task : t)) : [msg.payload.task, ...prev]); else if (msg.payload.action === 'delete') setTasks((prev: any[]) => prev.filter((t) => t.id !== msg.payload.task_id)) }
    else if (msg.action === 'error') { const text = msg.payload?.message || msg.payload?.error || '操作失败'; setSendError(text); feedback.error(text); addClientLog('error', 'ws', 'api error', msg.payload || {}) }
    else if (msg.action === 'files.updated') loadFiles()
    else if (msg.action === 'tabs.updated') loadTabs()
    else if (msg.action === 'tab.open') {
      setActiveTabId?.(msg.payload?.tabId || null)
      if (msg.payload?.anchor) window.setTimeout(() => window.dispatchEvent(new CustomEvent('freechat:tab-action', { detail: { type: 'scrollTo', ...msg.payload } })), 150)
    }
    else if (msg.action === 'tab.action') {
      setActiveTabId?.(msg.payload?.tabId || null)
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('freechat:tab-action', { detail: msg.payload })), 150)
    }
  }

  const sendWs = (action: string, payload: any): boolean => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) { addClientLog('warn', 'ws', 'send skipped: socket not open', { action, readyState: wsRef.current?.readyState ?? null }); setSendError('连接未就绪，请稍后再试，正在重连...'); connectWs(); return false }
    try { addClientLog('info', 'ws', 'send', { action }); wsRef.current.send(JSON.stringify({ action, payload })); setSendError(''); return true }
    catch { addClientLog('error', 'ws', 'send failed', { action }); setSendError('发送失败，正在重连...'); try { wsRef.current.close() } catch {}; connectWs(); return false }
  }

  return { loadRoom, connectWs, sendWs, loadFiles, loadTabs }
}
