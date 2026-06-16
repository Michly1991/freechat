import { PersonalSettingsTabs } from '../../features/settings/PersonalSettingsTabs'
import type { SettingsSectionProps } from './types'

export function SettingsSection({ user, onLogout }: SettingsSectionProps) {
  return (
    <section className="space-y-5">
      <div className="bg-white sm:rounded-xl sm:border border-gray-200 p-4 sm:p-5 flex items-center gap-3">
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
      <PersonalSettingsTabs onLogout={onLogout} />
    </section>
  )
}
