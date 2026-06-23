import { Bell, Plus } from 'lucide-react'
import { NotificationPanel } from '../../features/notifications/NotificationPanel'
import type { HeaderProps } from './types'

export function HomeHeader({
  user,
  showQuickActions,
  showNotifications,
  notifications,
  notificationUnreadCount,
  browserNotificationsEnabled,
  setShowQuickActions,
  setShowNotifications,
  setBrowserNotificationsEnabled,
  onShowJoin,
  onShowCreate,
  onShowAddFriend,
  onSettings,
  onLogout,
  onMarkAllNotificationsRead,
  onOpenNotification,
}: HeaderProps) {
  const runQuickAction = (action: () => void) => {
    setShowQuickActions(false)
    action()
  }

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-3 sm:py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">FreeChat</h1>
        <div className="flex items-center gap-2.5 sm:gap-4 relative">
          <button
            onClick={() => setShowNotifications((v) => !v)}
            className="fc-pressable relative w-9 h-9 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center hover:bg-gray-200"
            title="通知"
          >
            <Bell className="w-5 h-5" />
            {notificationUnreadCount > 0 && <span className="absolute -right-1 -top-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">{notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}</span>}
          </button>
          <NotificationPanel open={showNotifications} notifications={notifications} unreadCount={notificationUnreadCount} browserEnabled={browserNotificationsEnabled} setBrowserEnabled={setBrowserNotificationsEnabled} onClose={() => setShowNotifications(false)} onMarkAllRead={onMarkAllNotificationsRead} onOpenNotification={onOpenNotification} />
          <button
            onClick={() => setShowQuickActions((v) => !v)}
            className="fc-pressable w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center text-xl leading-none hover:bg-blue-700"
            title="快捷操作"
          >
            <Plus className="w-5 h-5" />
          </button>
          {showQuickActions && (
            <>
              <div className="hidden sm:block absolute right-0 top-11 w-40 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-20">
                <button onClick={() => runQuickAction(onShowAddFriend)} className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50">
                  添加好友
                </button>
                <button onClick={() => runQuickAction(onShowJoin)} className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50">
                  加入群聊
                </button>
                <button onClick={() => runQuickAction(onShowCreate)} className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50">
                  新建群聊
                </button>
              </div>
              <div className="sm:hidden fixed inset-0 z-50 bg-black/40" onClick={() => setShowQuickActions(false)}>
                <div className="fc-sheet-pop absolute inset-x-0 bottom-0 rounded-t-3xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl" onClick={(event) => event.stopPropagation()}>
                  <p className="px-1 pb-3 text-sm font-semibold text-gray-800">快捷操作</p>
                  <div className="overflow-hidden rounded-2xl border border-gray-100">
                    <button onClick={() => runQuickAction(onShowAddFriend)} className="fc-pressable flex min-h-12 w-full items-center px-4 text-left text-base text-gray-700 hover:bg-gray-50">添加好友</button>
                    <button onClick={() => runQuickAction(onShowJoin)} className="fc-pressable flex min-h-12 w-full items-center border-t border-gray-100 px-4 text-left text-base text-gray-700 hover:bg-gray-50">加入群聊</button>
                    <button onClick={() => runQuickAction(onShowCreate)} className="fc-pressable flex min-h-12 w-full items-center border-t border-gray-100 px-4 text-left text-base text-gray-700 hover:bg-gray-50">新建群聊</button>
                  </div>
                  <button onClick={() => setShowQuickActions(false)} className="fc-pressable mt-3 flex min-h-12 w-full items-center justify-center rounded-2xl bg-gray-100 text-base font-medium text-gray-700">取消</button>
                </div>
              </div>
            </>
          )}
          <button onClick={onSettings} className="fc-pressable flex items-center gap-2 text-gray-600 hover:text-gray-800">
            {user?.avatar ? (
              <img src={user.avatar} alt="头像" className="w-8 h-8 rounded-full object-cover border border-gray-200" />
            ) : (
              <span className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-sm font-semibold">
                {(user?.nickname || user?.username || '?')[0].toUpperCase()}
              </span>
            )}
            <span className="hidden sm:inline">{user?.nickname || user?.username}</span>
          </button>
          <button onClick={onLogout} className="hidden sm:inline text-sm text-gray-500 hover:text-gray-700">
            退出
          </button>
        </div>
      </div>
    </header>
  )
}
