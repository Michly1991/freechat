import { FileText } from 'lucide-react'
import type { FileNode, Message } from '../../room-page-model'
import { getAgentStatusLabel, getMemberAvatar, getMemberDisplayName, renderAgentAvatar, renderAvatar, renderMessageContent } from '../room-ui-utils'

interface RoomChatPanelProps {
  messages: Message[]
  user: any
  unreadMarkerAt: number | null
  messagesScrollRef: React.RefObject<HTMLDivElement>
  messagesEndRef: React.RefObject<HTMLDivElement>
  roomNewMessageCount: number
  scrollToBottomAndRead: () => void
  sendMessage: (e: React.FormEvent) => void
  showMentionPopup: boolean
  filteredMembers: any[]
  filteredAgents: any[]
  filteredFiles: FileNode[]
  insertMention: (target: any, type: 'member' | 'agent' | 'file') => void
  inputRef: React.RefObject<HTMLInputElement>
  input: string
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  sendError: string
  wsNoticeDismissed: boolean
  setWsNoticeDismissed: (value: boolean) => void
  renderInteractionCard: (msg: Message) => React.ReactNode
  getActorAvatar: (msg: Message) => string
  getActorMember: (msg: Message) => any
  getActorAgent: (msg: Message) => any
  openMemberProfile: (target: any, kind: 'member' | 'agent') => void
}

export function RoomChatPanel(props: RoomChatPanelProps) {
  const {
    messages, user, unreadMarkerAt, messagesScrollRef, messagesEndRef, roomNewMessageCount, scrollToBottomAndRead,
    sendMessage, showMentionPopup, filteredMembers, filteredAgents, filteredFiles, insertMention, inputRef, input, handleInputChange,
    sendError, wsNoticeDismissed, setWsNoticeDismissed, renderInteractionCard, getActorAvatar, getActorMember,
    getActorAgent, openMemberProfile,
  } = props

  return (
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
              {showUnreadMarker && <div className="my-3 flex items-center gap-3 text-xs text-blue-500"><span className="h-px flex-1 bg-blue-100"></span><span>以下是未读消息</span><span className="h-px flex-1 bg-blue-100"></span></div>}
              <div className={`flex items-end gap-2 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                {!isOwn && (msg.actorRole === 'ai' ? <button type="button" onClick={() => openMemberProfile(actorAgent, 'agent')} className="shrink-0 hover:ring-2 hover:ring-blue-200 rounded-full">{renderAgentAvatar(actorAgent, 'w-10 h-10 sm:w-12 sm:h-12', 'w-5 h-5 sm:w-6 sm:h-6')}</button> : <button type="button" onClick={() => actorMember && openMemberProfile(actorMember, 'member')} className="shrink-0 hover:ring-2 hover:ring-blue-200 rounded-full">{renderAvatar(displayName, avatar, 'w-10 h-10 sm:w-12 sm:h-12')}</button>)}
                <div className={`max-w-[84%] sm:max-w-[80%] rounded-2xl sm:rounded-xl px-3 sm:px-4 py-2 shadow-sm ${isAgentReceipt ? 'bg-gray-50 border border-dashed border-gray-200 text-gray-500' : (isOwn ? 'bg-blue-600 text-white shadow-blue-500/10' : 'bg-white border border-gray-200 text-gray-800')}`}>
                  <button type="button" onClick={() => msg.actorRole === 'ai' ? openMemberProfile(actorAgent, 'agent') : actorMember && openMemberProfile(actorMember, 'member')} className={`block text-xs mb-1 text-left ${isAgentReceipt ? 'text-gray-400' : (isOwn ? 'text-blue-200' : 'text-gray-400 hover:text-blue-500')}`}>{msg.actorRole === 'ai' ? 'AI · ' : ''}{displayName}</button>
                  {msg.kind === 'interaction_request' ? renderInteractionCard(msg) : <p className={`${isAgentReceipt ? 'text-xs' : 'text-sm'} whitespace-pre-wrap`}>{renderMessageContent(msg.content, isOwn)}</p>}
                </div>
                {isOwn && <button type="button" onClick={() => actorMember && openMemberProfile(actorMember, 'member')} className="shrink-0 hover:ring-2 hover:ring-blue-200 rounded-full">{renderAvatar(displayName, avatar, 'w-10 h-10 sm:w-12 sm:h-12')}</button>}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
        {roomNewMessageCount > 0 && <button onClick={scrollToBottomAndRead} className="fc-pressable sticky bottom-2 mx-auto block rounded-full bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-lg shadow-blue-500/20">有 {roomNewMessageCount} 条新消息</button>}
      </div>
      <form onSubmit={sendMessage} className="fc-mobile-glass p-3 sm:p-4 bg-white border-t border-gray-200 shrink-0 relative safe-area-inset-bottom">
        {showMentionPopup && (filteredMembers.length > 0 || filteredAgents.length > 0 || filteredFiles.length > 0) && <div className="fc-sheet-pop absolute bottom-full left-3 right-3 sm:left-4 sm:right-4 bg-white border border-gray-200 rounded-2xl shadow-xl max-h-72 overflow-y-auto z-10 mb-2">
          {filteredMembers.length > 0 && <><div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50">成员</div>{filteredMembers.map((m) => <div key={m.id || m.userId} className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm flex items-center gap-2" onClick={() => insertMention(m, 'member')}>{renderAvatar(getMemberDisplayName(m), getMemberAvatar(m), 'w-6 h-6')}<span className="flex-1">{getMemberDisplayName(m)}</span></div>)}</>}
          {filteredAgents.length > 0 && <><div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50">AI Agents</div>{filteredAgents.map((a) => <div key={a.id} className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm flex items-center gap-2" onClick={() => insertMention(a, 'agent')}>{renderAgentAvatar(a, 'w-6 h-6', 'w-4 h-4')}<span className="flex-1">{a.name}</span><span className="text-xs text-gray-400">{getAgentStatusLabel(a)}</span></div>)}</>}
          {filteredFiles.length > 0 && <><div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50">文件</div>{filteredFiles.map((f) => <div key={f.path} className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm flex items-center gap-2" onClick={() => insertMention(f, 'file')}><FileText className="w-5 h-5 text-gray-400" /><span className="flex-1 truncate">{f.name}</span><span className="text-xs text-gray-400 truncate max-w-[45%]">{f.path}</span></div>)}</>}
        </div>}
        {sendError && !wsNoticeDismissed && <div className="mb-2 flex items-center justify-between gap-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-700"><span>{sendError.replace('正在重连...', '实时同步暂不可用，但消息可正常发送')}</span><button type="button" onClick={() => setWsNoticeDismissed(true)} className="text-amber-500 hover:text-amber-700">×</button></div>}
        <div className="flex gap-2 items-center rounded-2xl bg-gray-50 border border-gray-200 p-1.5 shadow-inner focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-300 transition-all">
          <input ref={inputRef} type="text" value={input} onChange={handleInputChange} placeholder="输入消息，@提及成员..." className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-base sm:text-sm border-0 rounded-xl focus:ring-0 focus:outline-none" />
          <button type="submit" disabled={!input.trim()} className="fc-pressable fc-mobile-touch bg-blue-600 text-white px-4 sm:px-6 py-2 rounded-xl hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed shadow-sm shadow-blue-500/20">发送</button>
        </div>
      </form>
    </div>
  )
}
