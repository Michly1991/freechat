import { CreditCard, Folder, ListTodo, MessageCircle, PanelsTopLeft, Settings, Users } from 'lucide-react'
import type { Panel } from '../../room-page-model'
import { getAgentStatusDotClass, getAgentStatusLabel } from '../room-ui-utils'

export const roomPanels: { key: Panel; label: string; icon: string }[] = [
  { key: 'chat', label: '聊天', icon: 'message' },
  { key: 'files', label: '文件', icon: 'folder' },
  { key: 'tabs', label: '页面', icon: 'panels' },
  { key: 'tasks', label: '任务', icon: 'check' },
  { key: 'billing', label: '账单', icon: 'billing' },
]

export function RoomHeader({ room, members, roomAgents, workingAgents, defaultAssistant, openMemberProfile, setShowMobileMembers, openSettings, navigate }: any) {
  const totalMembers = members.length + roomAgents.length
  return <header className="fc-mobile-glass bg-white border-b border-gray-200 px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between shrink-0 sticky top-0 z-30"><div className="flex items-center gap-2.5 min-w-0"><button onClick={() => navigate('/')} className="fc-pressable flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-lg leading-none text-gray-600 hover:bg-gray-200 hover:text-gray-800 shrink-0" title="返回"><span aria-hidden>←</span><span className="sr-only">返回</span></button><div className="min-w-0"><h1 className="font-semibold text-gray-800 truncate">{room?.name || '加载中...'}</h1><p className="text-[11px] text-gray-400 sm:hidden">成员 {members.length} · Agent {roomAgents.length}</p></div>{defaultAssistant && <button type="button" onClick={() => openMemberProfile(defaultAssistant, 'agent')} className="hidden sm:flex items-center gap-1.5 rounded-full bg-gray-50 border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-blue-50 hover:text-blue-600 shrink-0" title={`当前协调者：${defaultAssistant.name} ${getAgentStatusLabel(defaultAssistant)}`}><span className={`w-2 h-2 rounded-full ${getAgentStatusDotClass(defaultAssistant)}`}></span><span>协调者：{defaultAssistant.name}</span></button>}</div><div className="flex items-center gap-2 shrink-0"><button onClick={openSettings} className="fc-pressable flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700" title="房间设置"><Settings className="w-4 h-4" /></button><button onClick={() => setShowMobileMembers(true)} className="fc-pressable md:hidden relative flex h-9 items-center gap-1.5 rounded-full bg-blue-50 px-3 text-xs font-medium text-blue-600 shadow-sm active:bg-blue-100"><Users className="w-4 h-4" />{totalMembers}{workingAgents.length > 0 && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-yellow-400 agent-breathing shadow-[0_0_0_4px_rgba(250,204,21,0.25)]" />}</button></div></header>
}

function PanelIcon({ panel, mobile = false }: { panel: any; mobile?: boolean }) {
  const cls = mobile ? 'w-5 h-5' : 'inline w-4 h-4 mr-1'
  if (panel.icon === 'message') return <MessageCircle className={cls} />
  if (panel.icon === 'folder') return <Folder className={cls} />
  if (panel.icon === 'panels') return <PanelsTopLeft className={cls} />
  if (panel.icon === 'billing') return <CreditCard className={cls} />
  return <ListTodo className={cls} />
}

export function DesktopPanelTabs({ activePanel, setActivePanel, agentWorking = false }: { activePanel: Panel; setActivePanel: (panel: Panel) => void; agentWorking?: boolean }) {
  return <div className="relative z-40 hidden md:flex border-b border-gray-200 bg-white shrink-0 pointer-events-auto">{roomPanels.map((p) => <button key={p.key} type="button" className={`fc-pressable px-4 py-2 text-sm font-medium transition-colors pointer-events-auto ${activePanel === p.key ? 'text-blue-600 border-b-2 border-blue-600 fc-tab-active' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`} onClick={() => setActivePanel(p.key)}><span className="relative inline-flex items-center"><PanelIcon panel={p} />{p.label}{p.key === 'chat' && agentWorking && <span className="ml-1.5 w-2 h-2 rounded-full bg-yellow-400 agent-breathing shadow-[0_0_0_4px_rgba(250,204,21,0.22)]" />}</span></button>)}</div>
}

export function MobileBottomNav({ activePanel, setActivePanel, roomNewMessageCount, agentWorking = false }: { activePanel: Panel; setActivePanel: (panel: Panel) => void; roomNewMessageCount: number; agentWorking?: boolean }) {
  return <nav className="fc-mobile-glass relative z-40 md:hidden flex border-t border-gray-200 bg-white shrink-0 pb-[env(safe-area-inset-bottom)] px-1 py-1 shadow-[0_-8px_24px_rgba(15,23,42,0.06)] pointer-events-auto">{roomPanels.map((p) => <button key={p.key} type="button" className={`fc-pressable min-h-14 flex-1 rounded-2xl py-2 text-center transition-colors pointer-events-auto ${activePanel === p.key ? 'bg-blue-50 text-blue-600 fc-tab-active' : 'text-gray-400'}`} onClick={() => setActivePanel(p.key)}><div className="flex justify-center mb-0.5"><span className="relative"><PanelIcon panel={p} mobile />{p.key === 'chat' && roomNewMessageCount > 0 && <span className="absolute -right-2 -top-2 min-w-[16px] rounded-full bg-red-500 px-1 text-[10px] leading-4 text-white">{roomNewMessageCount > 99 ? '99+' : roomNewMessageCount}</span>}{p.key === 'chat' && agentWorking && <span className="absolute -left-2 -top-1 w-2.5 h-2.5 rounded-full bg-yellow-400 agent-breathing shadow-[0_0_0_4px_rgba(250,204,21,0.22)]" />}</span></div><div className="text-xs">{p.label}</div></button>)}</nav>
}

export function FileDialog({ fileDialogType, fileDialogPath, setFileDialogPath, setFileDialogType, submitFileDialog }: any) {
  if (!fileDialogType) return null
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"><div className="w-full max-w-sm rounded-xl bg-white shadow-2xl"><div className="p-5 border-b border-gray-100"><h3 className="font-semibold text-gray-900">{fileDialogType === 'file' ? '新建文件' : '新建目录'}</h3><p className="mt-1 text-xs text-gray-500">支持路径，例如 docs/report.md 或 docs</p></div><div className="p-5"><input autoFocus value={fileDialogPath} onChange={(e) => setFileDialogPath(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitFileDialog()} placeholder={fileDialogType === 'file' ? 'docs/report.md' : 'docs'} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" /></div><div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100"><button onClick={() => setFileDialogType(null)} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm hover:bg-gray-200">取消</button><button onClick={submitFileDialog} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">创建</button></div></div></div>
}


