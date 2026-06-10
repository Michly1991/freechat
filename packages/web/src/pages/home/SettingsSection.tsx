import type { SettingsSectionProps } from './types'

export function SettingsSection({ user, onSettings, onLogout }: SettingsSectionProps) {
  return (
    <section className="bg-white sm:rounded-xl sm:border border-gray-200 p-4 sm:p-5 space-y-4">
      <div className="flex items-center gap-3">
        {user?.avatar ? (
          <img src={user.avatar} className="w-14 h-14 rounded-full object-cover" />
        ) : (
          <span className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 text-white flex items-center justify-center text-xl font-semibold">
            {(user?.nickname || user?.username || '?')[0].toUpperCase()}
          </span>
        )}
        <div>
          <p className="font-semibold text-gray-800">{user?.nickname || user?.username}</p>
          <p className="text-sm text-gray-400">@{user?.username}</p>
        </div>
      </div>
      <button onClick={onSettings} className="w-full text-left px-4 py-3 rounded-lg border border-gray-100 hover:bg-gray-50">个人设置</button>
      <button onClick={onLogout} className="w-full text-left px-4 py-3 rounded-lg border border-red-100 text-red-600 hover:bg-red-50">退出登录</button>
    </section>
  )
}
