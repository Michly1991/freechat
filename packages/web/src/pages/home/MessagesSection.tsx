import { AtSign, BellOff, FolderKanban, Pin } from 'lucide-react'
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
}: MessagesSectionProps) {
  return (
    <section className="bg-white sm:rounded-xl sm:border border-gray-200 overflow-hidden mb-4 sm:mb-6">
      <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">消息</h2>
        <button onClick={loadConversations} className="text-xs text-gray-400 hover:text-gray-600">刷新</button>
      </div>
      {conversations.length === 0 ? (
        <div className="p-8 text-center text-gray-400">暂无会话，去通讯录找好友聊天，或创建一个项目</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {conversations.map((conv) => {
            const item = (
              <div
                onClick={() => openSwipeId === `${conv.type}-${conv.id}` ? setOpenSwipeId(null) : navigateTo(conv.targetPath)}
                className={`px-3 sm:px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-gray-50 active:bg-gray-100 ${conv.pinned ? 'bg-yellow-50/60' : 'bg-white'}`}
              >
                {conv.type === 'dm' ? (
                  conv.avatar
                    ? <img src={conv.avatar} className="w-12 h-12 rounded-full object-cover" />
                    : <span className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 text-white flex items-center justify-center font-semibold">{(conv.title || '?')[0].toUpperCase()}</span>
                ) : (
                  <span className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-400 to-blue-500 text-white flex items-center justify-center"><FolderKanban className="w-6 h-6" /></span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800 truncate">{conv.title}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${conv.type === 'dm' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>{conv.type === 'dm' ? '私聊' : '项目'}</span>
                    {conv.pinned && <span className="text-[10px] text-yellow-600 inline-flex items-center gap-0.5"><Pin className="w-3 h-3" />置顶</span>}
                    {conv.mentionUnreadCount > 0 && <span className="text-[10px] text-red-500 inline-flex items-center gap-0.5"><AtSign className="w-3 h-3" />提到我</span>}
                    {conv.muted && <span className="text-[10px] text-gray-400 inline-flex items-center gap-0.5"><BellOff className="w-3 h-3" />免打扰</span>}
                  </div>
                  <p className="text-sm text-gray-400 truncate mt-1">
                    {conv.lastMessage ? `${conv.lastMessage.actorName}: ${conv.lastMessage.content}` : conv.subtitle}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {conv.unreadCount > 0 && <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${conv.muted ? 'bg-gray-200 text-gray-500' : 'bg-red-500 text-white'}`}>{conv.unreadCount > 99 ? '99+' : conv.unreadCount}</span>}
                  <div className="hidden sm:flex gap-2 text-xs text-gray-400">
                    <button onClick={(e) => toggleConversationPref(conv, 'pinned', e)}>{conv.pinned ? '取消置顶' : '置顶'}</button>
                    <button onClick={(e) => toggleConversationPref(conv, 'hidden', e)}>不显示</button>
                    <button disabled={deletingId === conv.id} onClick={(e) => deleteConversation(conv, e)} className="text-red-400 hover:text-red-600 disabled:opacity-60">{deletingId === conv.id ? '删除中...' : (conv.type === 'project' ? '删除' : '隐藏')}</button>
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
