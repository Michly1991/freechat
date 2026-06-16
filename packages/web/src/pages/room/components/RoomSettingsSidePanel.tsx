import { useEffect, useState } from 'react'
import { Activity, Bot, Settings, Shield, Wrench, X } from 'lucide-react'
import { api } from '../../../lib/api'
import AgentDreamPanel from '../../../features/analytics/AgentDreamPanel'
import { RoomDiagnosticsPanel } from '../../../features/diagnostics/RoomDiagnosticsPanel'
import { AgentRunsPanel } from './AgentRunsPanel'

type SideTab = 'basic' | 'agent' | 'runs' | 'diagnostics' | 'advanced'
const tabs: Array<{ id: SideTab; label: string; icon: any }> = [
  { id: 'basic', label: '基本', icon: Settings },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'runs', label: '执行', icon: Activity },
  { id: 'diagnostics', label: '诊断', icon: Wrench },
  { id: 'advanced', label: '高级', icon: Shield },
]
function TabButton({ active, icon: Icon, label, onClick }: any) {
  return <button onClick={onClick} className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}><Icon className="w-4 h-4" />{label}</button>
}

export function RoomSettingsSidePanel({ open, onClose, roomId, room, roomAgents, user, feedback, restartAgent, onRoomChanged }: any) {
  const [activeTab, setActiveTab] = useState<SideTab>('basic')
  const [editName, setEditName] = useState(room?.name || '')
  const [editDesc, setEditDesc] = useState(room?.description || '')
  const [inviteCode, setInviteCode] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { setEditName(room?.name || ''); setEditDesc(room?.description || '') }, [room?.id, room?.name, room?.description])
  if (!open || !roomId) return null

  const saveRoom = async () => {
    try { await api.updateRoom(roomId, { name: editName, description: editDesc }); feedback.success('保存成功'); onRoomChanged?.() }
    catch (e: any) { feedback.error(e.message || '保存失败') }
  }
  const generateInvite = async () => {
    try { const data = await api.createInvite(roomId); setInviteCode(data.code); setInviteUrl(data.url?.startsWith('http') ? data.url : `${window.location.origin}/join?code=${data.code}`) }
    catch (e: any) { feedback.error('生成失败: ' + (e.message || JSON.stringify(e))) }
  }
  const removeAgent = async (agentId: string) => {
    try { await api.removeRoomAgent(roomId, agentId); feedback.success('Agent 已移除'); onRoomChanged?.() }
    catch (e: any) { feedback.error(e.message || '移除失败') }
  }
  const deleteRoom = async () => {
    const ok = await feedback.confirm({ title: '永久删除项目？', message: `确定永久删除「${room?.name || '当前项目'}」吗？此操作不可恢复。`, confirmText: '永久删除' })
    if (!ok) return
    setDeleting(true)
    try { await api.deleteRoom(roomId); feedback.success('项目已删除'); window.location.href = '/' }
    catch (e: any) { feedback.error('删除失败: ' + (e.message || JSON.stringify(e))) }
    finally { setDeleting(false) }
  }

  const panel = <aside className="flex h-full w-full flex-col bg-gray-50 shadow-2xl md:w-[420px] md:border-l md:border-gray-200">
    <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold text-gray-800">房间设置</h2><p className="text-xs text-gray-400 truncate">{room?.name || roomId}</p></div><button onClick={onClose} className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"><X className="w-5 h-5" /></button></div>
      <div className="mt-3 overflow-x-auto"><div className="flex min-w-max gap-2">{tabs.map((tab) => <TabButton key={tab.id} active={activeTab === tab.id} icon={tab.icon} label={tab.label} onClick={() => setActiveTab(tab.id)} />)}</div></div>
    </div>
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      {activeTab === 'basic' && <section className="rounded-xl border border-gray-200 bg-white p-4"><h3 className="mb-3 font-semibold text-gray-800">基本信息</h3><div className="space-y-3"><div><label className="mb-1 block text-sm text-gray-600">房间名称</label><input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></div><div><label className="mb-1 block text-sm text-gray-600">描述</label><textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></div><button onClick={saveRoom} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">保存</button></div></section>}
      {activeTab === 'agent' && <div className="space-y-5"><section className="rounded-xl border border-gray-200 bg-white p-4"><h3 className="mb-3 font-semibold text-gray-800">Agent</h3><div className="space-y-2">{roomAgents.length === 0 && <p className="text-sm text-gray-400">暂无 Agent</p>}{roomAgents.map((agent: any) => <div key={agent.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 p-3"><div className="min-w-0"><span className="text-sm font-medium">{agent.name}</span><span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${agent.autoEnabled ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{agent.autoEnabled ? '自动助理' : (agent.roomRole === 'assistant' ? '助理' : '专家')}</span>{agent.lastError && <p className="mt-1 truncate text-xs text-red-500">{agent.lastError}</p>}</div><button onClick={() => removeAgent(agent.id)} className="shrink-0 text-xs text-red-500 hover:text-red-700">移除</button></div>)}</div></section><AgentDreamPanel roomId={roomId} /></div>}
      {activeTab === 'runs' && <AgentRunsPanel roomId={roomId} roomAgents={roomAgents} restartAgent={restartAgent} feedback={feedback} />}
      {activeTab === 'diagnostics' && <RoomDiagnosticsPanel roomId={roomId} user={user} hasToken={!!localStorage.getItem('auth-storage')} note="右侧设置栏复用当前浏览器客户端日志；如需排查实时连接问题，先在房间里复现再复制日志。" />}
      {activeTab === 'advanced' && <div className="space-y-5"><section className="rounded-xl border border-gray-200 bg-white p-4"><h3 className="mb-3 font-semibold text-gray-800">邀请链接</h3><button onClick={generateInvite} className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700">生成邀请码</button>{inviteCode && <div className="mt-3 space-y-3"><input value={inviteCode} readOnly className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm font-mono" /><input value={inviteUrl} readOnly className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm" /></div>}</section><section className="rounded-xl border border-red-200 bg-white p-4"><h3 className="mb-2 font-semibold text-red-600">危险操作</h3><p className="mb-3 text-sm text-gray-500">永久删除这个项目及其所有关联数据。此操作不可恢复。</p><button disabled={deleting} onClick={deleteRoom} className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-60">{deleting ? '删除中...' : '永久删除项目'}</button></section></div>}
    </div>
  </aside>

  return <div className="fixed inset-0 z-50 flex justify-end bg-black/30 md:absolute md:inset-y-0 md:right-0 md:left-auto" onClick={onClose}><div className="h-full w-full md:w-auto" onClick={(e) => e.stopPropagation()}>{panel}</div></div>
}
