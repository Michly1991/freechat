import { useEffect, useState } from 'react'
import { Activity, BookOpen, Bot, Settings, Shield, Wrench, X } from 'lucide-react'
import { api } from '../../../lib/api'
import AgentDreamPanel from '../../../features/analytics/AgentDreamPanel'
import { RoomDiagnosticsPanel } from '../../../features/diagnostics/RoomDiagnosticsPanel'
import { AgentRunsPanel } from './AgentRunsPanel'
import { KnowledgePanel } from './KnowledgePanel'

type SideTab = 'basic' | 'agent' | 'knowledge' | 'runs' | 'diagnostics' | 'advanced'
const tabs: Array<{ id: SideTab; label: string; icon: any }> = [
  { id: 'basic', label: '基本', icon: Settings },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'knowledge', label: '知识', icon: BookOpen },
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
  const currentMember = Array.isArray(room?.members) ? room.members.find((member: any) => (member.id || member.userId) === user?.id) : null
  const canEditRoom = !currentMember || ['owner', 'editor'].includes(currentMember.role)
  const canDeleteRoom = currentMember?.role === 'owner'

  useEffect(() => { setEditName(room?.name || ''); setEditDesc(room?.description || '') }, [room?.id, room?.name, room?.description])
  if (!open || !roomId) return null

  const saveRoom = async () => {
    if (!canEditRoom) { feedback.warning('你没有权限修改房间设置'); return }
    try { await api.updateRoom(roomId, { name: editName, description: editDesc }); feedback.success('保存成功'); onRoomChanged?.() }
    catch (e: any) { feedback.error(e.message || '保存失败') }
  }
  const generateInvite = async () => {
    if (!canEditRoom) { feedback.warning('你没有权限生成邀请码'); return }
    try { const data = await api.createInvite(roomId); setInviteCode(data.code); setInviteUrl(data.url?.startsWith('http') ? data.url : `${window.location.origin}/join?code=${data.code}`) }
    catch (e: any) { feedback.error('生成失败: ' + (e.message || JSON.stringify(e))) }
  }
  const removeAgent = async (agentId: string) => {
    if (!canEditRoom) { feedback.warning('你没有权限移除 Agent'); return }
    try { await api.removeRoomAgent(roomId, agentId); feedback.success('Agent 已移除'); onRoomChanged?.() }
    catch (e: any) { feedback.error(e.message || '移除失败') }
  }
  const deleteRoom = async () => {
    if (!canDeleteRoom) { feedback.warning('只有项目所有者可以删除项目'); return }
    const ok = await feedback.confirm({ title: '删除项目？', message: `确定删除「${room?.name || '当前项目'}」吗？项目会从列表隐藏，历史账单和流水仍保留关联。`, confirmText: '删除项目' })
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
      {activeTab === 'basic' && <section className="rounded-xl border border-gray-200 bg-white p-4"><h3 className="mb-3 font-semibold text-gray-800">基本信息</h3><div className="space-y-3"><div><label className="mb-1 block text-sm text-gray-600">房间名称</label><input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></div><div><label className="mb-1 block text-sm text-gray-600">描述</label><textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></div><button disabled={!canEditRoom} onClick={saveRoom} className={`rounded-lg px-4 py-2 text-sm ${canEditRoom ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>保存</button>{!canEditRoom && <p className="text-xs text-gray-400">你是查看者，只能查看房间设置。</p>}</div></section>}
      {activeTab === 'agent' && <div className="space-y-5"><section className="rounded-xl border border-gray-200 bg-white p-4"><h3 className="mb-3 font-semibold text-gray-800">Agent</h3><div className="space-y-2">{roomAgents.length === 0 && <p className="text-sm text-gray-400">暂无 Agent</p>}{roomAgents.map((agent: any) => <div key={agent.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 p-3"><div className="min-w-0"><span className="text-sm font-medium">{agent.name}</span><span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${agent.autoEnabled ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{agent.autoEnabled ? '协调者' : (agent.roomRole === 'assistant' ? '协调者' : 'Agent 成员')}</span>{agent.lastError && <p className="mt-1 truncate text-xs text-red-500">{agent.lastError}</p>}</div><button disabled={!canEditRoom} onClick={() => removeAgent(agent.id)} className={`shrink-0 text-xs ${canEditRoom ? 'text-red-500 hover:text-red-700' : 'text-gray-300 cursor-not-allowed'}`}>移除</button></div>)}</div></section><AgentDreamPanel roomId={roomId} canEdit={canEditRoom} /></div>}
      {activeTab === 'knowledge' && <div className="space-y-5"><KnowledgePanel scope="room" roomId={roomId} feedback={feedback} compact /><div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-700">房间知识只在当前房间/客户/项目内生效，适合保存已确认事实、客户材料摘要、项目结论。</div></div>}
      {activeTab === 'runs' && <AgentRunsPanel roomId={roomId} roomAgents={roomAgents} restartAgent={restartAgent} feedback={feedback} />}
      {activeTab === 'diagnostics' && <RoomDiagnosticsPanel roomId={roomId} user={user} hasToken={!!localStorage.getItem('auth-storage')} note="右侧设置栏复用当前浏览器客户端日志；如需排查实时连接问题，先在房间里复现再复制日志。" />}
      {activeTab === 'advanced' && <div className="space-y-5"><section className="rounded-xl border border-gray-200 bg-white p-4"><h3 className="mb-3 font-semibold text-gray-800">邀请链接</h3><button disabled={!canEditRoom} onClick={generateInvite} className={`rounded-lg px-4 py-2 text-sm ${canEditRoom ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>生成邀请码</button>{!canEditRoom && <p className="mt-2 text-xs text-gray-400">只有项目所有者/编辑者可以生成邀请码。</p>}{inviteCode && <div className="mt-3 space-y-3"><input value={inviteCode} readOnly className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm font-mono" /><input value={inviteUrl} readOnly className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm" /></div>}</section><section className="rounded-xl border border-red-200 bg-white p-4"><h3 className="mb-2 font-semibold text-red-600">危险操作</h3><p className="mb-3 text-sm text-gray-500">删除后项目会从列表隐藏；历史账单、流水和运行记录保留关联。</p>{!canDeleteRoom && <p className="mb-3 text-sm text-red-500">只有项目所有者可以删除项目。</p>}<button disabled={deleting || !canDeleteRoom} onClick={deleteRoom} className={`rounded-lg px-4 py-2 text-sm disabled:opacity-60 ${canDeleteRoom ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>{deleting ? '删除中...' : '删除项目'}</button></section></div>}
    </div>
  </aside>

  return <div className="fixed inset-0 z-50 flex justify-end bg-black/30 md:absolute md:inset-y-0 md:right-0 md:left-auto" onClick={onClose}><div className="h-full w-full md:w-auto" onClick={(e) => e.stopPropagation()}>{panel}</div></div>
}
