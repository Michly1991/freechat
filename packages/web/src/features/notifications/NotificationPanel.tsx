import { Bell, BellOff, CheckCheck, X } from 'lucide-react'
import { enableBrowserNotifications, disableBrowserNotifications, isBrowserNotificationEnabled } from './browser-notifications'

function formatTime(ts?: number) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = Date.now()
  if (now - ts < 24 * 60 * 60 * 1000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString()
}

export function NotificationPanel({ open, notifications, unreadCount, browserEnabled, setBrowserEnabled, onClose, onMarkAllRead, onOpenNotification }: any) {
  if (!open) return null
  const toggleBrowser = async () => {
    if (isBrowserNotificationEnabled()) {
      disableBrowserNotifications()
      setBrowserEnabled(false)
      return
    }
    setBrowserEnabled(await enableBrowserNotifications())
  }
  return (
    <div className="absolute right-0 top-11 w-[22rem] max-w-[calc(100vw-1rem)] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden z-30">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div>
          <div className="font-semibold text-gray-800">通知</div>
          <div className="text-xs text-gray-400">{unreadCount > 0 ? `${unreadCount} 条未读` : '暂无未读'}</div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </div>
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between text-xs">
        <button onClick={toggleBrowser} className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-700">
          {browserEnabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
          {browserEnabled ? '浏览器通知已开' : '开启浏览器通知'}
        </button>
        <button onClick={onMarkAllRead} className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700">
          <CheckCheck className="w-3.5 h-3.5" /> 全部已读
        </button>
      </div>
      <div className="max-h-96 overflow-y-auto divide-y divide-gray-100">
        {notifications.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">暂无通知</div>
        ) : notifications.map((item: any) => (
          <button key={item.id} onClick={() => onOpenNotification(item)} className="w-full text-left px-4 py-3 hover:bg-gray-50 flex gap-3">
            <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${item.readAt ? 'bg-gray-200' : 'bg-red-500'}`} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm text-gray-800 truncate">{item.title}</span>
                <span className="text-[10px] text-gray-400 shrink-0">{formatTime(item.createdAt)}</span>
              </span>
              {item.body && <span className="block text-xs text-gray-500 truncate mt-1">{item.body}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
