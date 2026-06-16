const PERMISSION_KEY = 'freechat:browserNotifications'

export function isBrowserNotificationEnabled() {
  return localStorage.getItem(PERMISSION_KEY) === '1'
}

export async function enableBrowserNotifications() {
  if (!('Notification' in window)) return false
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  const enabled = permission === 'granted'
  localStorage.setItem(PERMISSION_KEY, enabled ? '1' : '0')
  return enabled
}

export function disableBrowserNotifications() {
  localStorage.setItem(PERMISSION_KEY, '0')
}

export function showBrowserNotification(notification: any) {
  if (!isBrowserNotificationEnabled()) return
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  if (document.visibilityState === 'visible') return
  const title = notification?.title || 'FreeChat 通知'
  const body = notification?.body || ''
  const item = new Notification(title, { body, tag: notification?.id, icon: '/favicon.ico' })
  item.onclick = () => {
    window.focus()
    if (notification?.targetPath) window.location.href = notification.targetPath
    item.close()
  }
}
