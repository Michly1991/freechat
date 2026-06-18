import { CreditCard, MessageCircle, Settings, Users } from 'lucide-react'
import type { DesktopTabsProps, HomeTab, MobileNavProps } from './types'

const tabs: { key: HomeTab; label: string }[] = [
  { key: 'messages', label: '消息' },
  { key: 'contacts', label: '通讯录' },
  { key: 'billing', label: '账单' },
  { key: 'settings', label: '设置' },
]

export function DesktopTabs({ activeHomeTab, setActiveHomeTab }: DesktopTabsProps) {
  return (
    <div className="hidden sm:flex bg-white rounded-xl border border-gray-200 p-1 mb-6 w-fit">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => setActiveHomeTab(tab.key)}
          className={`flex-1 sm:flex-none px-6 py-2 rounded-lg text-sm font-medium transition-colors ${activeHomeTab === tab.key ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

const mobileTabs = [
  { key: 'messages' as const, label: '消息', Icon: MessageCircle },
  { key: 'contacts' as const, label: '通讯录', Icon: Users },
  { key: 'billing' as const, label: '账单', Icon: CreditCard },
  { key: 'settings' as const, label: '设置', Icon: Settings },
]

export function MobileNav({ activeHomeTab, setActiveHomeTab }: MobileNavProps) {
  return (
    <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 safe-area-inset-bottom">
      <div className="grid grid-cols-4 h-16">
        {mobileTabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setActiveHomeTab(key)}
            className={`flex flex-col items-center justify-center gap-0.5 text-xs ${activeHomeTab === key ? 'text-blue-600' : 'text-gray-500'}`}
          >
            <Icon className="w-5 h-5" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
