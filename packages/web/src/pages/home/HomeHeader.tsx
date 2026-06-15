import { Plus } from 'lucide-react'
import type { HeaderProps } from './types'

export function HomeHeader({
  user,
  showQuickActions,
  setShowQuickActions,
  onShowJoin,
  onShowCreate,
  onShowAddFriend,
  onSettings,
  onLogout,
}: HeaderProps) {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-3 sm:py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">FreeChat</h1>
        <div className="flex items-center gap-3 sm:gap-4 relative">
          <button
            onClick={() => setShowQuickActions((v) => !v)}
            className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center text-xl leading-none hover:bg-blue-700"
            title="快捷操作"
          >
            <Plus className="w-5 h-5" />
          </button>
          {showQuickActions && (
            <div className="absolute right-0 top-11 w-40 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-20">
              <button onClick={onShowAddFriend} className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50">
                添加好友
              </button>
              <button onClick={onShowJoin} className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50">
                加入项目
              </button>
              <button onClick={onShowCreate} className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50">
                新建项目
              </button>
            </div>
          )}
          <button onClick={onSettings} className="flex items-center gap-2 text-gray-600 hover:text-gray-800">
            {user?.avatar ? (
              <img src={user.avatar} alt="头像" className="w-8 h-8 rounded-full object-cover border border-gray-200" />
            ) : (
              <span className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-sm font-semibold">
                {(user?.nickname || user?.username || '?')[0].toUpperCase()}
              </span>
            )}
            <span className="hidden sm:inline">{user?.nickname || user?.username}</span>
          </button>
          <button onClick={onLogout} className="text-sm text-gray-500 hover:text-gray-700">
            退出
          </button>
        </div>
      </div>
    </header>
  )
}
