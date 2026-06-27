import { useRef, useState } from 'react'
import { Check, Copy, FileText, Image as ImageIcon, Paperclip, Send, X } from 'lucide-react'
import { VoicePlaybackButton } from '../../../features/voice/VoicePlaybackButton'
import { VoiceConversationButton } from '../../../features/voice/VoiceConversationButton'
import type { FileNode, Message } from '../../room-page-model'
import { getAgentStatusLabel, getMemberAvatar, getMemberDisplayName, renderAgentAvatar, renderAvatar, renderMessageContent } from '../room-ui-utils'


const LONG_MESSAGE_CHARS = 1200
const LONG_MESSAGE_LINES = 12

function getFoldedMessage(content: string) {
  const lines = content.split('\n')
  const tooLong = content.length > LONG_MESSAGE_CHARS || lines.length > LONG_MESSAGE_LINES
  if (!tooLong) return { folded: content, tooLong }
  const byLines = lines.slice(0, LONG_MESSAGE_LINES).join('\n')
  const folded = byLines.length > LONG_MESSAGE_CHARS ? `${byLines.slice(0, LONG_MESSAGE_CHARS)}…` : `${byLines}…`
  return { folded, tooLong }
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

function formatMessageTime(value?: number) {
  if (!value) return ''
  const date = new Date(value)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return time
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`
}

function formatFullMessageTime(value?: number) {
  return value ? new Date(value).toLocaleString() : ''
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

interface RoomChatPanelProps {
  roomId?: string
  messages: Message[]
  user: any
  unreadMarkerAt: number | null
  messagesScrollRef: React.RefObject<HTMLDivElement>
  messagesEndRef: React.RefObject<HTMLDivElement>
  roomNewMessageCount: number
  scrollToBottomAndRead: () => void
  sendMessage: (e: React.FormEvent) => void
  pendingAttachments?: File[]
  onAddAttachments?: (files: FileList | null) => void
  onRemoveAttachment?: (index: number) => void
  showMentionPopup: boolean
  filteredMembers: any[]
  filteredAgents: any[]
  filteredFiles: FileNode[]
  insertMention: (target: any, type: 'member' | 'agent' | 'file') => void
  inputRef: React.RefObject<HTMLTextAreaElement>
  input: string
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  voiceAvailable?: boolean
  voiceChatEnabled?: boolean
  voiceStatus?: string
  voiceBusy?: boolean
  onVoiceEnable?: () => void
  onVoiceDisable?: () => void
  onVoiceTranscript?: (text: string) => void | Promise<void>
  onVoiceRecordingChange?: (recording: boolean) => void
  onVoiceBusyChange?: (busy: boolean) => void
  sendError: string
  wsNoticeDismissed: boolean
  setWsNoticeDismissed: (value: boolean) => void
  renderInteractionCard: (msg: Message) => React.ReactNode
  getActorAvatar: (msg: Message) => string
  getActorMember: (msg: Message) => any
  getActorAgent: (msg: Message) => any
  openMemberProfile: (target: any, kind: 'member' | 'agent') => void
  onMessagesScroll?: () => void
  loadingOlderMessages?: boolean
  hasMoreMessages?: boolean
}

export function RoomChatPanel(props: RoomChatPanelProps) {
  const {
    roomId, messages, user, unreadMarkerAt, messagesScrollRef, messagesEndRef, roomNewMessageCount, scrollToBottomAndRead,
    sendMessage, pendingAttachments = [], onAddAttachments, onRemoveAttachment, showMentionPopup, filteredMembers, filteredAgents, filteredFiles, insertMention, inputRef, input, handleInputChange,
    sendError, wsNoticeDismissed, setWsNoticeDismissed, renderInteractionCard, getActorAvatar, getActorMember,
    getActorAgent, openMemberProfile, onMessagesScroll, loadingOlderMessages, hasMoreMessages,
    voiceAvailable = false, voiceChatEnabled = false, voiceStatus, voiceBusy, onVoiceEnable, onVoiceDisable, onVoiceTranscript,
    onVoiceRecordingChange, onVoiceBusyChange,
  } = props
  const [expandedMessageIds, setExpandedMessageIds] = useState<Record<string, boolean>>({})
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement | null>(null)

  const toggleExpanded = (messageId: string) => setExpandedMessageIds((prev) => ({ ...prev, [messageId]: !prev[messageId] }))
  const voiceStatusText = voiceStatus === 'listening'
    ? '正在听，2 秒无声后自动发送；房间回复会自动播报'
    : voiceStatus === 'transcribing'
      ? '正在转文字...'
      : voiceStatus === 'thinking'
        ? '已发送，等待回复...'
        : voiceStatus === 'speaking'
          ? '正在播报房间回复...'
          : '语音模式已开启，开始说话即可'

  const copyMessage = async (messageId: string, content: string) => {
    if (!content.trim()) return
    await copyTextToClipboard(content)
    setCopiedMessageId(messageId)
    window.setTimeout(() => setCopiedMessageId((current) => current === messageId ? null : current), 1200)
  }

  const handleAttachmentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onAddAttachments?.(event.currentTarget.files)
    event.currentTarget.value = ''
  }

  return (
    <div className="h-full flex flex-col">
      <div ref={messagesScrollRef} onScroll={onMessagesScroll} className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 sm:py-4 space-y-3 relative bg-gradient-to-b from-gray-50/70 to-white sm:bg-none">
        <div className="text-center text-xs text-gray-400 min-h-5">
          {loadingOlderMessages ? '正在加载更早消息...' : hasMoreMessages ? '上滑加载更早消息' : (messages.length > 0 ? '没有更早消息了' : '')}
        </div>
        {messages.map((msg) => {
          const isOwn = msg.actorId === user?.id
          const displayName = isOwn ? '我' : msg.actorName
          const avatar = isOwn ? user?.avatar : getActorAvatar(msg)
          const actorMember = isOwn ? user : getActorMember(msg)
          const actorAgent = msg.actorRole === 'ai' ? (getActorAgent(msg) || { name: displayName, roleType: 'assistant', status: 'active' }) : null
          const sentTime = formatMessageTime(msg.createdAt)
          const fullSentTime = formatFullMessageTime(msg.createdAt)
          const showUnreadMarker = unreadMarkerAt && !isOwn && (msg.createdAt || 0) > unreadMarkerAt && !messages.slice(0, messages.findIndex((m) => m.id === msg.id)).some((m) => m.actorId !== user?.id && (m.createdAt || 0) > unreadMarkerAt)
          const isAgentReceipt = msg.kind === 'agent_receipt'
          const isAgentStream = msg.kind === 'agent_stream'
          const streamActivities = Array.isArray(msg.payload?.activities) ? msg.payload.activities.slice(-6) : []
          const historicalActivities = !isAgentStream && Array.isArray(msg.payload?.agentStream?.activities) ? msg.payload.agentStream.activities.slice(-6) : []
          const attachments = Array.isArray((msg as any).attachments) ? (msg as any).attachments : Array.isArray(msg.payload?.attachments) ? msg.payload.attachments : []
          return (
            <div key={msg.id} id={`msg-${msg.id}`} className="fc-enter">
              {showUnreadMarker && <div className="my-3 flex items-center gap-3 text-xs text-blue-500"><span className="h-px flex-1 bg-blue-100"></span><span>以下是未读消息</span><span className="h-px flex-1 bg-blue-100"></span></div>}
              <div className={`flex items-end gap-2 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                {!isOwn && (msg.actorRole === 'ai' ? <button type="button" onClick={() => openMemberProfile(actorAgent, 'agent')} className="shrink-0 hover:ring-2 hover:ring-blue-200 rounded-full">{renderAgentAvatar(actorAgent, 'w-10 h-10 sm:w-12 sm:h-12', 'w-5 h-5 sm:w-6 sm:h-6')}</button> : <button type="button" onClick={() => actorMember && openMemberProfile(actorMember, 'member')} className="shrink-0 hover:ring-2 hover:ring-blue-200 rounded-full">{renderAvatar(displayName, avatar, 'w-10 h-10 sm:w-12 sm:h-12')}</button>)}
                <div className={`min-w-0 max-w-[88%] sm:max-w-[80%] overflow-hidden rounded-2xl sm:rounded-xl px-3 sm:px-4 py-2 shadow-sm ${isAgentReceipt || isAgentStream ? 'bg-gray-50 border border-dashed border-gray-200 text-gray-500' : (isOwn ? 'bg-blue-600 text-white shadow-blue-500/10' : 'bg-white border border-gray-200 text-gray-800')}`}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex items-center gap-1.5">
                      <button type="button" onClick={() => msg.actorRole === 'ai' ? openMemberProfile(actorAgent, 'agent') : actorMember && openMemberProfile(actorMember, 'member')} className={`min-w-0 truncate text-xs text-left ${isAgentReceipt || isAgentStream ? 'text-gray-400' : (isOwn ? 'text-blue-200' : 'text-gray-400 hover:text-blue-500')}`}>{msg.actorRole === 'ai' ? 'AI · ' : ''}{displayName}</button>
                      {sentTime && <time dateTime={new Date(msg.createdAt).toISOString()} title={fullSentTime} className={`shrink-0 text-[10px] ${isAgentReceipt || isAgentStream ? 'text-gray-400' : (isOwn ? 'text-blue-100/80' : 'text-gray-400')}`}>{sentTime}</time>}
                    </div>
                    {msg.content?.trim() && !isAgentStream && <div className="flex items-center gap-1">{voiceAvailable && <VoicePlaybackButton text={msg.content} roomId={roomId} messageId={msg.id} own={isOwn} />}<button type="button" onClick={() => copyMessage(msg.id, msg.content)} className={`fc-pressable shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${isOwn ? 'text-blue-100 hover:bg-blue-500/30' : 'text-gray-400 hover:bg-gray-100 hover:text-blue-500'}`} title="复制消息">
                      {copiedMessageId === msg.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      <span className="hidden sm:inline">{copiedMessageId === msg.id ? '已复制' : '复制'}</span>
                    </button></div>}
                  </div>
                  {msg.kind === 'interaction_request' ? renderInteractionCard(msg) : isAgentStream ? (
                    <div className="space-y-2">
                      {msg.content ? <p className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-gray-700">{renderMessageContent(msg.content, isOwn)}</p> : <p className="text-sm text-gray-500"><span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse mr-2" />正在思考和处理...</p>}
                      {streamActivities.length > 0 && <div className="space-y-1 border-t border-gray-200/70 pt-2">
                        {streamActivities.map((item: any, index: number) => <div key={`${item.timestamp || index}-${index}`} className="flex items-start gap-2 text-xs text-gray-500"><span className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" /><span className="min-w-0 break-words [overflow-wrap:anywhere]">{item.text}</span></div>)}
                      </div>}
                      {msg.payload?.status === 'failed' && <p className="text-xs text-red-500">{msg.payload.error || 'Agent 处理失败'}</p>}
                    </div>
                  ) : <>
                    {(() => {
                      const canFold = !isAgentReceipt
                      const expanded = !!expandedMessageIds[msg.id]
                      const folded = getFoldedMessage(msg.content || '')
                      const visibleContent = canFold && folded.tooLong && !expanded ? folded.folded : msg.content
                      return <>
                        <p className={`${isAgentReceipt ? 'text-xs' : 'text-sm'} whitespace-pre-wrap break-words [overflow-wrap:anywhere]`}>{renderMessageContent(visibleContent, isOwn)}</p>
                        {canFold && folded.tooLong && <button type="button" onClick={() => toggleExpanded(msg.id)} className={`mt-2 rounded-full px-2.5 py-1 text-xs font-medium ${isOwn ? 'bg-blue-500/30 text-blue-50 hover:bg-blue-500/40' : 'bg-gray-100 text-gray-500 hover:bg-blue-50 hover:text-blue-600'}`}>{expanded ? '收起' : '展开全文'}</button>}
                      </>
                    })()}
                    {attachments.length > 0 && <div className="mt-2 grid gap-2">
                      {attachments.map((file: any) => <div key={file.id || file.ref || file.relativePath} className={`rounded-xl border px-3 py-2 text-xs ${isOwn ? 'border-blue-400/40 bg-blue-500/20 text-blue-50' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                        <div className="flex items-center gap-2"><span>{String(file.mimeType || '').startsWith('image/') ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}</span><span className="min-w-0 flex-1 truncate">{file.name}</span><span className="shrink-0 opacity-70">{file.size ? `${Math.ceil(file.size / 1024)}KB` : ''}</span></div>
                        <div className="mt-1 truncate opacity-70">{file.ref || file.relativePath}</div>
                      </div>)}
                    </div>}
                    {historicalActivities.length > 0 && <details className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-500">
                      <summary className="cursor-pointer select-none text-gray-400 hover:text-blue-500">处理过程</summary>
                      <div className="mt-1 space-y-1">
                        {historicalActivities.map((item: any, index: number) => <div key={`${item.timestamp || index}-${index}`} className="flex items-start gap-2"><span className="mt-1 w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" /><span className="min-w-0 break-words [overflow-wrap:anywhere]">{item.text}</span></div>)}
                      </div>
                    </details>}
                  </>}
                </div>
                {isOwn && <button type="button" onClick={() => actorMember && openMemberProfile(actorMember, 'member')} className="shrink-0 hover:ring-2 hover:ring-blue-200 rounded-full">{renderAvatar(displayName, avatar, 'w-10 h-10 sm:w-12 sm:h-12')}</button>}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
        {roomNewMessageCount > 0 && <button onClick={scrollToBottomAndRead} className="fc-pressable sticky bottom-2 mx-auto block rounded-full bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-lg shadow-blue-500/20">有 {roomNewMessageCount} 条新消息</button>}
      </div>
      {voiceAvailable && voiceChatEnabled && (
        <div className="shrink-0 border-t border-emerald-100 bg-emerald-50/95 px-3 py-2 text-xs text-emerald-700 sm:px-4">
          <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-xl border border-emerald-100 bg-white/70 px-3 py-2 shadow-sm">
            <span className={`h-2 w-2 rounded-full ${voiceStatus === 'listening' ? 'animate-pulse bg-emerald-500' : voiceStatus === 'speaking' ? 'animate-pulse bg-blue-500' : 'bg-emerald-400'}`} />
            <span className="min-w-0 flex-1 truncate">{voiceStatusText}</span>
          </div>
        </div>
      )}
      <form onSubmit={sendMessage} className="fc-mobile-glass p-3 sm:p-4 bg-white border-t border-gray-200 shrink-0 relative safe-area-inset-bottom">
        {showMentionPopup && (filteredMembers.length > 0 || filteredAgents.length > 0 || filteredFiles.length > 0) && <div className="fc-sheet-pop absolute bottom-full left-3 right-3 sm:left-4 sm:right-4 bg-white border border-gray-200 rounded-2xl shadow-xl max-h-[45vh] sm:max-h-72 overflow-y-auto z-10 mb-2">
          {filteredMembers.length > 0 && <><div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50">成员</div>{filteredMembers.map((m) => <div key={m.id || m.userId} className="px-3 py-2.5 min-h-11 hover:bg-blue-50 cursor-pointer text-sm flex items-center gap-2" onClick={() => insertMention(m, 'member')}>{renderAvatar(getMemberDisplayName(m), getMemberAvatar(m), 'w-6 h-6')}<span className="flex-1">{getMemberDisplayName(m)}</span></div>)}</>}
          {filteredAgents.length > 0 && <><div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50">AI Agents</div>{filteredAgents.map((a) => <div key={a.id} className="px-3 py-2.5 min-h-11 hover:bg-blue-50 cursor-pointer text-sm flex items-center gap-2" onClick={() => insertMention(a, 'agent')}>{renderAgentAvatar(a, 'w-6 h-6', 'w-4 h-4')}<span className="flex-1">{a.name}</span><span className="text-xs text-gray-400">{getAgentStatusLabel(a)}</span></div>)}</>}
          {filteredFiles.length > 0 && <><div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50">文件</div>{filteredFiles.map((f) => <div key={f.path} className="px-3 py-2.5 min-h-11 hover:bg-blue-50 cursor-pointer text-sm flex items-center gap-2" onClick={() => insertMention(f, 'file')}><FileText className="w-5 h-5 text-gray-400" /><span className="flex-1 truncate">{f.name}</span><span className="text-xs text-gray-400 truncate max-w-[45%]">{f.path}</span></div>)}</>}
        </div>}
        {sendError && !wsNoticeDismissed && <div className="mb-2 flex items-center justify-between gap-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-700"><span>{sendError.replace('正在重连...', '实时同步暂不可用，但消息可正常发送')}</span><button type="button" onClick={() => setWsNoticeDismissed(true)} className="text-amber-500 hover:text-amber-700" title="关闭"><X className="w-4 h-4" /></button></div>}
        {pendingAttachments.length > 0 && <div className="mb-3 rounded-2xl border border-blue-100 bg-blue-50/80 p-2.5 shadow-sm"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-blue-700"><Paperclip className="h-4 w-4" /><span>已选择 {pendingAttachments.length} 个文件，点击发送上传</span></div><div className="space-y-2">{pendingAttachments.map((file, index) => <div key={`${file.name}-${file.size}-${index}`} className="flex min-h-11 items-center gap-2 rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm"><FileText className="h-5 w-5 shrink-0 text-blue-500" /><div className="min-w-0 flex-1"><div className="truncate font-medium text-gray-800" title={file.name}>{file.name}</div><div className="text-xs text-gray-400">{formatFileSize(file.size)}</div></div><button type="button" onClick={() => onRemoveAttachment?.(index)} className="fc-pressable rounded-full p-1 text-gray-400 hover:bg-red-50 hover:text-red-500" aria-label={`移除 ${file.name}`}><X className="h-4 w-4" /></button></div>)}</div></div>}
        <div className="flex gap-2 items-center rounded-2xl bg-gray-50 border border-gray-200 p-1.5 shadow-inner focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-300 transition-all">
          <div className="relative inline-flex min-w-11 shrink-0 overflow-hidden rounded-xl"><button type="button" className="fc-pressable fc-mobile-touch inline-flex min-w-11 items-center justify-center gap-1 rounded-xl px-2.5 py-2 text-gray-500 hover:bg-white hover:text-blue-600" title="选择文件" aria-label="选择文件"><Paperclip className="h-5 w-5" /><span className="hidden sm:inline text-sm">文件</span></button><input ref={attachmentInputRef} type="file" multiple className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0" title="选择文件" aria-label="选择文件" onChange={handleAttachmentChange} /></div>
          <textarea ref={inputRef} value={input} onChange={handleInputChange} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) sendMessage(e) }} rows={1} placeholder="输入消息，@成员..." className="min-w-0 flex-1 max-h-32 resize-none bg-transparent px-3 py-2.5 text-base sm:text-sm border-0 rounded-xl focus:ring-0 focus:outline-none overflow-y-auto leading-6" />
          {voiceAvailable && onVoiceTranscript && onVoiceEnable && onVoiceDisable && <VoiceConversationButton roomId={roomId} enabled={voiceChatEnabled} busy={voiceBusy} status={voiceStatus} onEnable={onVoiceEnable} onDisable={onVoiceDisable} onTranscript={onVoiceTranscript} onRecordingChange={onVoiceRecordingChange} onBusyChange={onVoiceBusyChange} />}
          {!voiceChatEnabled && <button type="submit" disabled={!input.trim() && pendingAttachments.length === 0} className="fc-pressable fc-mobile-touch inline-flex min-w-11 items-center justify-center gap-1.5 bg-blue-600 text-white px-3 sm:px-4 py-2 rounded-xl hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed shadow-sm shadow-blue-500/20" title="发送"><Send className="h-5 w-5" /><span className="hidden sm:inline">发送</span></button>}
        </div>
      </form>
    </div>
  )
}
