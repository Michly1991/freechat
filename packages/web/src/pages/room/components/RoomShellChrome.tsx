import { Activity, Folder, ListTodo, MessageCircle, PanelsTopLeft, Settings, Users } from 'lucide-react'
import type { Panel } from '../../room-page-model'
import { getAgentStatusDotClass, getAgentStatusLabel } from '../room-ui-utils'

export const roomPanels: { key: Panel; label: string; icon: string }[] = [
  { key: 'chat', label: '聊天', icon: 'message' },
  { key: 'files', label: '文件', icon: 'folder' },
  { key: 'tabs', label: '页面', icon: 'panels' },
  { key: 'tasks', label: '任务', icon: 'check' },
  { key: 'agentRuns', label: '执行', icon: 'activity' },
]

export function RoomHeader({ room, roomId, members, roomAgents, workingAgents, defaultAssistant, openMemberProfile, setShowMobileMembers, navigate }: any) {
  return <header className="fc-mobile-glass bg-white border-b border-gray-200 px-3 sm:px-4 py-3 flex items-center justify-between shrink-0 sticky top-0 z-30"><div className="flex items-center gap-3 min-w-0"><button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700 shrink-0">← 返回</button><h1 className="font-semibold text-gray-800 truncate">{room?.name || '加载中...'}</h1>{defaultAssistant && <button type="button" onClick={() => openMemberProfile(defaultAssistant, 'agent')} className="hidden sm:flex items-center gap-1.5 rounded-full bg-gray-50 border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-blue-50 hover:text-blue-600 shrink-0" title={`助理${getAgentStatusLabel(defaultAssistant)}`}><span className={`w-2 h-2 rounded-full ${getAgentStatusDotClass(defaultAssistant)}`}></span><span>助理{getAgentStatusLabel(defaultAssistant)}</span></button>}<button onClick={() => navigate(`/room/${roomId}/settings`)} className="text-gray-400 hover:text-gray-600 text-sm ml-1 shrink-0" title="房间设置"><Settings className="w-4 h-4" /></button></div><button onClick={() => setShowMobileMembers(true)} className="fc-pressable md:hidden relative flex items-center gap-1.5 px-3 py-2 rounded-full bg-blue-50 text-blue-600 text-xs font-medium shrink-0 shadow-sm active:bg-blue-100"><Users className="w-4 h-4" />{members.length + roomAgents.length}{workingAgents.length > 0 && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-yellow-400 agent-breathing shadow-[0_0_0_4px_rgba(250,204,21,0.25)]" />}</button></header>
}

function PanelIcon({ panel, mobile = false }: { panel: any; mobile?: boolean }) {
  const cls = mobile ? 'w-5 h-5' : 'inline w-4 h-4 mr-1'
  if (panel.icon === 'message') return <MessageCircle className={cls} />
  if (panel.icon === 'folder') return <Folder className={cls} />
  if (panel.icon === 'panels') return <PanelsTopLeft className={cls} />
  if (panel.icon === 'activity') return <Activity className={cls} />
  return <ListTodo className={cls} />
}

export function DesktopPanelTabs({ activePanel, setActivePanel }: { activePanel: Panel; setActivePanel: (panel: Panel) => void }) {
  return <div className="hidden md:flex border-b border-gray-200 bg-white shrink-0">{roomPanels.map((p) => <button key={p.key} className={`fc-pressable px-4 py-2 text-sm font-medium transition-colors ${activePanel === p.key ? 'text-blue-600 border-b-2 border-blue-600 fc-tab-active' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`} onClick={() => setActivePanel(p.key)}><PanelIcon panel={p} />{p.label}</button>)}</div>
}

export function MobileBottomNav({ activePanel, setActivePanel, roomNewMessageCount }: { activePanel: Panel; setActivePanel: (panel: Panel) => void; roomNewMessageCount: number }) {
  return <nav className="fc-mobile-glass md:hidden flex border-t border-gray-200 bg-white shrink-0 safe-area-inset-bottom shadow-[0_-8px_24px_rgba(15,23,42,0.06)]">{roomPanels.map((p) => <button key={p.key} className={`fc-pressable flex-1 py-2 text-center transition-colors ${activePanel === p.key ? 'text-blue-600 fc-tab-active' : 'text-gray-400'}`} onClick={() => setActivePanel(p.key)}><div className="flex justify-center mb-0.5"><span className="relative"><PanelIcon panel={p} mobile />{p.key === 'chat' && roomNewMessageCount > 0 && <span className="absolute -right-2 -top-2 min-w-[16px] rounded-full bg-red-500 px-1 text-[10px] leading-4 text-white">{roomNewMessageCount > 99 ? '99+' : roomNewMessageCount}</span>}</span></div><div className="text-xs">{p.label}</div></button>)}</nav>
}

export function FileDialog({ fileDialogType, fileDialogPath, setFileDialogPath, setFileDialogType, submitFileDialog }: any) {
  if (!fileDialogType) return null
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"><div className="w-full max-w-sm rounded-xl bg-white shadow-2xl"><div className="p-5 border-b border-gray-100"><h3 className="font-semibold text-gray-900">{fileDialogType === 'file' ? '新建文件' : '新建目录'}</h3><p className="mt-1 text-xs text-gray-500">支持路径，例如 docs/report.md 或 docs</p></div><div className="p-5"><input autoFocus value={fileDialogPath} onChange={(e) => setFileDialogPath(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitFileDialog()} placeholder={fileDialogType === 'file' ? 'docs/report.md' : 'docs'} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" /></div><div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100"><button onClick={() => setFileDialogType(null)} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm hover:bg-gray-200">取消</button><button onClick={submitFileDialog} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">创建</button></div></div></div>
}


