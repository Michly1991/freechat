import { Pencil } from 'lucide-react'
import type { Tab } from '../../room-page-model'
import { getTabTitle } from '../room-ui-utils'

interface RoomTabsPanelProps {
  tabs: Tab[]
  activeTabId: string | null
  setActiveTabId: (id: string | null) => void
  showCreateTab: boolean
  setShowCreateTab: React.Dispatch<React.SetStateAction<boolean>>
  newTabName: string
  setNewTabName: (value: string) => void
  newTabContent: string
  setNewTabContent: (value: string) => void
  createTab: () => void
  deleteTab: (tabId: string) => void
  editingTabId: string | null
  setEditingTabId: (id: string | null) => void
  editingTabTitle: string
  setEditingTabTitle: (value: string) => void
  editingTabContent: string
  setEditingTabContent: (value: string) => void
  updateTab: (tabId: string) => void
  beginEditTab: (tab: Tab) => void
  tabError: string
}

export function RoomTabsPanel(props: RoomTabsPanelProps) {
  const { tabs, activeTabId, setActiveTabId, showCreateTab, setShowCreateTab, newTabName, setNewTabName, newTabContent, setNewTabContent, createTab, deleteTab, editingTabId, setEditingTabId, editingTabTitle, setEditingTabTitle, editingTabContent, setEditingTabContent, updateTab, beginEditTab, tabError } = props
  const activeTab = activeTabId ? tabs.find((t) => t.id === activeTabId) : null
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200 overflow-x-auto shrink-0">
        {tabs.map((tab) => <div key={tab.id} className={`flex items-center gap-1 px-3 py-1 rounded-t text-sm cursor-pointer ${activeTabId === tab.id ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}><span onClick={() => setActiveTabId(tab.id)}>{tab.icon || '📄'} {getTabTitle(tab)}</span><button onClick={() => editingTabId === tab.id ? setEditingTabId(null) : beginEditTab(tab)} className="text-xs text-gray-400 hover:text-gray-600"><Pencil className="w-4 h-4" /></button><button onClick={() => deleteTab(tab.id)} className="text-xs text-red-400 hover:text-red-600">×</button></div>)}
        <button onClick={() => setShowCreateTab(!showCreateTab)} className="text-sm text-blue-500 hover:text-blue-700 px-2">+ 新建</button>
      </div>
      {showCreateTab && <div className="p-4 bg-white border-b border-gray-200 space-y-2"><input value={newTabName} onChange={(e) => setNewTabName(e.target.value)} placeholder="标签名称" className="w-full px-3 py-2 border border-gray-300 rounded text-sm" /><textarea value={newTabContent} onChange={(e) => setNewTabContent(e.target.value)} placeholder="HTML 内容" className="w-full px-3 py-2 border border-gray-300 rounded text-sm h-24 font-mono" /><button onClick={createTab} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">创建</button></div>}
      {tabError && <div className="px-4 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100">{tabError}</div>}
      <div className="flex-1 overflow-hidden">
        {activeTab ? (editingTabId === activeTabId ? <div className="h-full flex flex-col"><div className="flex flex-col sm:flex-row gap-2 p-3 bg-white border-b border-gray-200"><input value={editingTabTitle} onChange={(e) => setEditingTabTitle(e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm" placeholder="标签标题" /><div className="flex gap-2"><button onClick={() => updateTab(activeTabId!)} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">保存</button><button onClick={() => setEditingTabId(null)} className="bg-gray-100 text-gray-600 px-4 py-2 rounded text-sm hover:bg-gray-200">取消</button></div></div><textarea value={editingTabContent} onChange={(e) => setEditingTabContent(e.target.value)} className="flex-1 p-4 font-mono text-sm resize-none focus:outline-none" /></div> : <iframe srcDoc={activeTab.content} className="w-full h-full border-0" sandbox="allow-scripts" title="tab-content" />) : <div className="flex-1 flex items-center justify-center text-gray-400 h-full"><p>选择一个标签页或创建新的</p></div>}
      </div>
    </div>
  )
}
