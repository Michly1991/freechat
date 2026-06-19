import { useEffect, useRef, useState } from 'react'
import { Compass, FileText, Pencil, X } from 'lucide-react'
import type { Tab } from '../../room-page-model'
import { getTabTitle } from '../room-ui-utils'
import { buildTabSrcDoc, handleFileReadMessage, resolveTargetTab } from '../room-tab-bridge'

interface RoomTabsPanelProps {
  roomId?: string
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

function PageIcon({ icon }: { icon?: string }) {
  if (icon === 'compass') return <Compass className="w-4 h-4" />
  return <FileText className="w-4 h-4" />
}

export function RoomTabsPanel(props: RoomTabsPanelProps) {
  const { roomId, tabs, activeTabId, setActiveTabId, showCreateTab, setShowCreateTab, newTabName, setNewTabName, newTabContent, setNewTabContent, createTab, deleteTab, editingTabId, setEditingTabId, editingTabTitle, setEditingTabTitle, editingTabContent, setEditingTabContent, updateTab, beginEditTab, tabError } = props
  const activeTab = activeTabId ? tabs.find((t) => t.id === activeTabId) : null
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null)

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data || {}
      if (data.type === 'freechat.file.read') {
        void handleFileReadMessage(roomId, iframeRef.current, data)
        return
      }
      if (data.type !== 'freechat.tab.open') return
      const target = resolveTargetTab(tabs, data)
      if (!target) return
      if (typeof data.anchor === 'string' && data.anchor.trim()) setPendingAnchor(data.anchor.trim())
      setActiveTabId(target.id)
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [roomId, tabs, setActiveTabId])

  const postPendingAnchor = () => {
    if (!pendingAnchor || !iframeRef.current?.contentWindow) return
    iframeRef.current.contentWindow.postMessage({ type: 'freechat.page.scrollTo', anchor: pendingAnchor }, '*')
    window.setTimeout(() => iframeRef.current?.contentWindow?.postMessage({ type: 'freechat.page.scrollTo', anchor: pendingAnchor }, '*'), 120)
    setPendingAnchor(null)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200 overflow-x-auto shrink-0">
        {tabs.map((tab) => <div key={tab.id} className={`flex items-center gap-1 px-3 py-1 rounded-t text-sm cursor-pointer ${activeTabId === tab.id ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}><span onClick={() => setActiveTabId(tab.id)} className="inline-flex items-center gap-1"><PageIcon icon={tab.icon} /> {getTabTitle(tab)}</span><button onClick={() => editingTabId === tab.id ? setEditingTabId(null) : beginEditTab(tab)} className="text-xs text-gray-400 hover:text-gray-600"><Pencil className="w-4 h-4" /></button><button onClick={() => deleteTab(tab.id)} className="text-xs text-red-400 hover:text-red-600" title="删除"><X className="w-4 h-4" /></button></div>)}
        <button onClick={() => setShowCreateTab(!showCreateTab)} className="text-sm text-blue-500 hover:text-blue-700 px-2">+ 新建页面</button>
      </div>
      {showCreateTab && <div className="p-4 bg-white border-b border-gray-200 space-y-2"><input value={newTabName} onChange={(e) => setNewTabName(e.target.value)} placeholder="页面名称" className="w-full px-3 py-2 border border-gray-300 rounded text-sm" /><textarea value={newTabContent} onChange={(e) => setNewTabContent(e.target.value)} placeholder="HTML 内容" className="w-full px-3 py-2 border border-gray-300 rounded text-sm h-24 font-mono" /><button onClick={createTab} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">创建</button></div>}
      {tabError && <div className="px-4 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100">{tabError}</div>}
      <div className="flex-1 overflow-hidden">
        {tabs.find((tab) => tab.id === activeTabId && (tab.title || '').includes('Agent管理')) ? <div className="flex items-center justify-center h-full text-gray-400">Agent 管理页面正在加载...</div> : activeTab ? (editingTabId === activeTabId ? <div className="h-full flex flex-col"><div className="flex flex-col sm:flex-row gap-2 p-3 bg-white border-b border-gray-200"><input value={editingTabTitle} onChange={(e) => setEditingTabTitle(e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm" placeholder="页面标题" /><div className="flex gap-2"><button onClick={() => updateTab(activeTabId!)} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">保存</button><button onClick={() => setEditingTabId(null)} className="bg-gray-100 text-gray-600 px-4 py-2 rounded text-sm hover:bg-gray-200">取消</button></div></div><textarea value={editingTabContent} onChange={(e) => setEditingTabContent(e.target.value)} className="flex-1 p-4 font-mono text-sm resize-none focus:outline-none" /></div> : <iframe ref={iframeRef} srcDoc={buildTabSrcDoc(activeTab.content)} onLoad={postPendingAnchor} className="w-full h-full border-0" sandbox="allow-scripts" title="page-content" />) : <div className="flex-1 flex items-center justify-center text-gray-400 h-full"><p>选择一个页面或创建新的</p></div>}
      </div>
    </div>
  )
}
