import { AtSign, BellOff, Bot, MessageSquarePlus, Pin, Sparkles, UserRound, Users } from 'lucide-react'
import { SwipeActionItem } from '../../components/SwipeActionItem'
import type { MessagesSectionProps } from './types'

export function MessagesSection({
  conversations,
  deletingId,
  openSwipeId,
  setOpenSwipeId,
  loadConversations,
  getConversationActions,
  toggleConversationPref,
  deleteConversation,
  navigateTo,
  onNewChat,
  onOpenXiaomi,
}: MessagesSectionProps & { onNewChat?: () => void; onOpenXiaomi?: () => void }) {
  return (
    <section className="bg-white sm:rounded-xl sm:border border-gray-200 overflow-hidden mb-4 sm:mb-6">
      <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">消息</h2>
          <p className="mt-0.5 text-xs text-gray-400">找小蜜可快速管理 Agent、Skill 和项目协作。</p>
        </div>
        <div className="flex items-center gap-2">
          {onOpenXiaomi && <button onClick={onOpenXiaomi} className="fc-pressable inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-500 to-blue-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:from-violet-600 hover:to-blue-600"><Sparkles className="h-3.5 w-3.5" />找小蜜</button>}
          <button onClick={loadConversations} className="text-xs text-gray-400 hover:text-gray-600">刷新</button>
        </div>
      </div>
      {conversations.length === 0 ? (
        <div className="p-8 text-center space-y-4">
          <MessageSquarePlus className="w-12 h-12 mx-auto text-gray-300" />
          <p className="text-gray-400">暂无会话，去通讯录找好友/AI 聊天，或创建一个群聊</p>
          {onOpenXiaomi && <button onClick={onOpenXiaomi} className="px-4 py-2 bg-gradient-to-r from-violet-500 to-blue-500 text-white rounded-lg text-sm hover:from-violet-600 hover:to-blue-600">找小蜜聊聊</button>}
          {onNewChat && <button onClick={onNewChat} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">开始聊天</button>}
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {conversations.map((conv) => {
            const item = (
              <div
                onClick={() => openSwipeId === `${conv.type}-${conv.id}` ? setOpenSwipeId(null) : navigateTo(conv.targetPath)}
                className={`px-3 sm:px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-gray-50 active:bg-gray-100 ${conv.pinned ? 'bg-yellow-50/60' : 'bg-white'}`}
              >
                {conv.roomKind === 'direct_user' || conv.type === 'dm' ? (
                  conv.avatar
                    ? <img src={conv.avatar} className="w-12 h-12 rounded-full object-cover" />
                    : <span className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 text-white flex items-center justify-center font-semibold"><UserRound className="w-6 h-6" /></span>
                ) : conv.roomKind === 'direct_agent' ? (
                  <span className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-400 to-blue-500 text-white flex items-center justify-center"><Bot className="w-6 h-6" /></span>
                ) : (
                  <span className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-400 to-blue-500 text-white flex items-center justify-center"><Users className="w-6 h-6" /></span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800 truncate">{conv.title}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${conv.roomKind === 'direct_agent' ? 'bg-violet-50 text-violet-600' : conv.roomKind === 'direct_user' || conv.type === 'dm' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>{conv.displayType || (conv.type === 'dm' ? '真人' : '群聊')}</span>
                    {conv.pinned && <span className="text-[10px] text-yellow-600 inline-flex items-center gap-0.5"><Pin className="w-3 h-3" />置顶</span>}
                    {conv.agentWorkingCount > 0 && <span className="text-[10px] text-yellow-600 inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 agent-breathing shadow-[0_0_0_4px_rgba(250,204,21,0.22)]" />{conv.agentWorkingCount > 1 ? `${conv.agentWorkingCount} 个 Agent 处理中` : 'Agent 处理中'}</span>}
                    {conv.mentionUnreadCount > 0 && <span className="text-[10px] text-red-500 inline-flex items-center gap-0.5"><AtSign className="w-3 h-3" />提到我</span>}
                    {conv.muted && <span className="text-[10px] text-gray-400 inline-flex items-center gap-0.5"><BellOff className="w-3 h-3" />免打扰</span>}
                  </div>
                  <p className="text-sm text-gray-400 truncate mt-1">
                    {conv.lastMessage ? `${conv.lastMessage.actorName}: ${conv.lastMessage.content}` : conv.subtitle}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {conv.agentWorkingCount > 0 && <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 agent-breathing shadow-[0_0_0_4px_rgba(250,204,21,0.22)]" title="Agent 处理中" />}
                  {conv.unreadCount > 0 && <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${conv.muted ? 'bg-gray-200 text-gray-500' : 'bg-red-500 text-white'}`}>{conv.unreadCount > 99 ? '99+' : conv.unreadCount}</span>}
                  <div className="hidden sm:flex gap-2 text-xs text-gray-400">
                    <button onClick={(e) => toggleConversationPref(conv, 'pinned', e)}>{conv.pinned ? '取消置顶' : '置顶'}</button>
                    <button onClick={(e) => toggleConversationPref(conv, 'hidden', e)}>不显示</button>
                    <button disabled={deletingId === conv.id} onClick={(e) => deleteConversation(conv, e)} className="text-red-400 hover:text-red-600 disabled:opacity-60">{deletingId === conv.id ? '删除中...' : (conv.roomKind === 'group' ? '删除' : '隐藏')}</button>
                  </div>
                  <span className="sm:hidden text-xs text-gray-300">左滑</span>
                </div>
              </div>
            )
            return (
              <SwipeActionItem key={`${conv.type}-${conv.id}`} id={`${conv.type}-${conv.id}`} openId={openSwipeId} setOpenId={setOpenSwipeId} actions={getConversationActions(conv)}>
                {item}
              </SwipeActionItem>
            )
          })}
        </div>
      )}
    </section>
  )
}
