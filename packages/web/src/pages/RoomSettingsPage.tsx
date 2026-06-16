import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { BarChart3, Bot, Settings, Shield, Users, Wrench } from 'lucide-react'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import { useFeedback } from '../components/FeedbackProvider'
import RoomAnalyticsPanel from '../features/analytics/RoomAnalyticsPanel'
import AgentDreamPanel from '../features/analytics/AgentDreamPanel'
import { RoomDiagnosticsPanel } from '../features/diagnostics/RoomDiagnosticsPanel'

type RoomSettingsTab = 'basic' | 'collaborators' | 'agent' | 'diagnostics' | 'advanced'
const tabs: Array<{ id: RoomSettingsTab; label: string; icon: any }> = [
  { id: 'basic', label: '基本信息', icon: Settings },
  { id: 'collaborators', label: '协作者', icon: Users },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'diagnostics', label: '诊断', icon: Wrench },
  { id: 'advanced', label: '高级', icon: Shield },
]
function TabButton({ active, icon: Icon, label, onClick }: any) {
  return <button onClick={onClick} className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}><Icon className="w-4 h-4" />{label}</button>
}

export default function RoomSettingsPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const feedback = useFeedback()
  const [activeTab, setActiveTab] = useState<RoomSettingsTab>('basic')
  const [room, setRoom] = useState<any>(null)
  const [members, setMembers] = useState<any[]>([])
  const [agents, setAgents] = useState<any[]>([])
  const [roomAgents, setRoomAgents] = useState<any[]>([])
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [showAddCollaborator, setShowAddCollaborator] = useState(false)
  const [addKind, setAddKind] = useState<'people' | 'agents'>('people')
  const [collaboratorQuery, setCollaboratorQuery] = useState('')
  const [userSearchResults, setUserSearchResults] = useState<any[]>([])
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [profileForm, setProfileForm] = useState({ role_title: '', persona: '', specialties: '' })
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const currentMember = members.find((member) => (member.id || member.userId) === user?.id)
  const canDeleteRoom = currentMember?.role === 'owner'

  useEffect(() => { if (roomId) loadAll() }, [roomId])

  const loadAll = async () => {
    try {
      const data = await api.getRoom(roomId!)
      setRoom(data.room); setMembers(data.members); setEditName(data.room.name); setEditDesc(data.room.description || '')
      try { const ra = await api.getRoomAgents(roomId!); setRoomAgents(ra.agents || []) } catch {}
      try { const a = await api.getAgents(); setAgents(a.agents || []) } catch {}
    } catch { navigate('/') }
  }
  const saveRoom = async () => { try { await api.updateRoom(roomId!, { name: editName, description: editDesc }); feedback.success('保存成功') } catch (e: any) { feedback.error(e.message || '保存失败') } }
  const deleteRoom = async () => {
    if (!roomId || !room || deleting) return
    setDeleting(true)
    try { await api.deleteRoom(roomId); setShowDeleteConfirm(false); feedback.success('项目已删除'); navigate('/') }
    catch (e: any) { feedback.error('删除失败: ' + (e.message || JSON.stringify(e))) }
    finally { setDeleting(false) }
  }
  const generateInvite = async () => {
    try { const data = await api.createInvite(roomId!); setInviteCode(data.code); setInviteUrl(data.url?.startsWith('http') ? data.url : `${window.location.origin}/join?code=${data.code}`) }
    catch (e: any) { feedback.error('生成失败: ' + (e.message || JSON.stringify(e))) }
  }
  const removeAgent = async (agentId: string) => { try { await api.removeRoomAgent(roomId!, agentId); feedback.success('Agent 已移除'); loadAll() } catch (e: any) { feedback.error(e.message || '移除失败') } }
  const addAgent = async (agentId: string, options?: { roomRole?: 'assistant' | 'specialist'; autoEnabled?: boolean }) => { try { await api.addRoomAgent(roomId!, agentId, options); feedback.success('Agent 已添加'); loadAll() } catch (e: any) { feedback.error(e.message || '添加失败') } }
  const searchUsersForRoom = async () => { if (!collaboratorQuery.trim()) return; try { const data = await api.searchUsers(collaboratorQuery.trim()); setUserSearchResults(data.users || []) } catch (e: any) { feedback.error(e.message || '搜索失败') } }
  const addUserCollaborator = async (targetUserId: string, role: 'owner' | 'editor' | 'viewer' = 'editor') => { try { await api.addRoomMember(roomId!, targetUserId, role); feedback.success('人员已添加'); setUserSearchResults([]); setCollaboratorQuery(''); loadAll() } catch (e: any) { feedback.error(e.message || '添加失败') } }
  const startEditProfile = (member: any) => { setEditingMemberId(member.id || member.userId); setProfileForm({ role_title: member.role_title || '', persona: member.persona || '', specialties: (member.specialties || []).join(', ') }) }
  const saveProfile = async () => {
    if (!editingMemberId) return
    try { await api.updateMemberProfile(roomId!, editingMemberId, { role_title: profileForm.role_title, persona: profileForm.persona, specialties: profileForm.specialties.split(',').map((s) => s.trim()).filter(Boolean) }); setEditingMemberId(null); loadAll() }
    catch (e: any) { feedback.error(e.message || '保存失败') }
  }

  const renderCollaborators = () => (
    <section className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div><h2 className="text-lg font-semibold text-gray-800">协作者</h2><p className="text-xs text-gray-400 mt-1">人员和 Agent 统一加入项目；Agent 创建在通讯录里完成。</p></div>
        <button onClick={() => setShowAddCollaborator(true)} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700 shrink-0">添加协作者</button>
      </div>
      <h3 className="text-sm font-medium text-gray-600 mb-2">人员</h3>
      <div className="space-y-2 mb-5">
        {members.map((m) => <div key={m.id || m.userId} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50"><div className="flex items-center gap-3 min-w-0">{m.avatar ? <img src={m.avatar} alt="头像" className="w-8 h-8 rounded-full object-cover border border-gray-200" /> : <span className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-xs font-semibold">{(m.nickname || m.username || '?')[0].toUpperCase()}</span>}<div className="min-w-0"><span className="font-medium text-sm text-gray-800">{m.nickname || m.username || '未命名用户'}</span>{m.username && m.username !== m.nickname && <span className="ml-2 text-xs text-gray-400">@{m.username}</span>}{m.role_title && <span className="ml-1 text-xs text-blue-500">{m.role_title}</span>}</div></div><button onClick={() => startEditProfile(m)} className="text-xs text-blue-500 hover:text-blue-700">编辑资料</button></div>)}
      </div>
      <h3 className="text-sm font-medium text-gray-600 mb-2">Agent</h3>
      <div className="space-y-2">
        {roomAgents.length === 0 && <p className="text-sm text-gray-400">暂无 Agent</p>}
        {roomAgents.map((a) => <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100"><div className="min-w-0"><span className="text-sm font-medium">{a.name}</span><span className={`ml-2 text-[11px] px-2 py-0.5 rounded-full ${a.autoEnabled ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{a.autoEnabled ? '自动助理' : (a.roomRole === 'assistant' ? '助理' : '专家')}</span>{a.description && <span className="text-xs text-gray-400 ml-2">{a.description}</span>}</div><button onClick={() => removeAgent(a.id)} className="text-xs text-red-500 hover:text-red-700">移除</button></div>)}
      </div>
      {editingMemberId && <div className="mt-4 p-4 border border-gray-200 rounded-lg space-y-3"><h3 className="text-sm font-semibold">编辑成员资料</h3><div><label className="text-xs text-gray-600 block mb-1">角色头衔</label><input value={profileForm.role_title} onChange={(e) => setProfileForm({ ...profileForm, role_title: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" /></div><div><label className="text-xs text-gray-600 block mb-1">人设描述</label><textarea value={profileForm.persona} onChange={(e) => setProfileForm({ ...profileForm, persona: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" /></div><div><label className="text-xs text-gray-600 block mb-1">专长（逗号分隔）</label><input value={profileForm.specialties} onChange={(e) => setProfileForm({ ...profileForm, specialties: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" /></div><div className="flex gap-2"><button onClick={saveProfile} className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700">保存</button><button onClick={() => setEditingMemberId(null)} className="bg-gray-200 text-gray-600 px-3 py-1 rounded text-sm hover:bg-gray-300">取消</button></div></div>}
    </section>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3"><button onClick={() => navigate(`/room/${roomId}`)} className="text-gray-500 hover:text-gray-700">← 返回房间</button><h1 className="font-semibold text-gray-800">房间设置</h1></div>
        <div className="max-w-4xl mx-auto px-4 pb-3 overflow-x-auto"><div className="flex gap-2 min-w-max">{tabs.map((tab) => <TabButton key={tab.id} active={activeTab === tab.id} icon={tab.icon} label={tab.label} onClick={() => setActiveTab(tab.id)} />)}</div></div>
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-6">
        {activeTab === 'basic' && <><section className="bg-white rounded-lg border border-gray-200 p-5"><h2 className="text-lg font-semibold text-gray-800 mb-4">基本信息</h2><div className="space-y-3"><div><label className="text-sm text-gray-600 block mb-1">房间名称</label><input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div><div><label className="text-sm text-gray-600 block mb-1">描述</label><textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div><button onClick={saveRoom} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">保存</button></div></section>{roomId && <RoomAnalyticsPanel roomId={roomId} />}</>}
        {activeTab === 'collaborators' && renderCollaborators()}
        {activeTab === 'agent' && <div className="space-y-6"><section className="bg-white rounded-lg border border-gray-200 p-5"><div className="flex items-center justify-between gap-3 mb-4"><div><h2 className="text-lg font-semibold text-gray-800">Agent 配置</h2><p className="text-xs text-gray-400 mt-1">房间 Agent、自动助理和梦境复盘集中在这里。</p></div><button onClick={() => { setActiveTab('collaborators'); setShowAddCollaborator(true); setAddKind('agents') }} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700 shrink-0">添加 Agent</button></div><div className="space-y-2">{roomAgents.length === 0 && <p className="text-sm text-gray-400">暂无 Agent</p>}{roomAgents.map((a) => <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100"><div className="min-w-0"><span className="text-sm font-medium">{a.name}</span><span className={`ml-2 text-[11px] px-2 py-0.5 rounded-full ${a.autoEnabled ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{a.autoEnabled ? '自动助理' : (a.roomRole === 'assistant' ? '助理' : '专家')}</span>{a.lastError && <p className="text-xs text-red-500 mt-1 truncate">{a.lastError}</p>}</div><button onClick={() => removeAgent(a.id)} className="text-xs text-red-500 hover:text-red-700">移除</button></div>)}</div></section>{roomId && <AgentDreamPanel roomId={roomId} />}</div>}
        {activeTab === 'diagnostics' && <RoomDiagnosticsPanel roomId={roomId} user={user} hasToken={!!localStorage.getItem('auth-storage')} note="房间设置页不保持房间 WebSocket 连接；如需观察实时 WS 状态，请返回房间触发后再复制日志。" />}
        {activeTab === 'advanced' && <div className="space-y-6"><section className="bg-white rounded-lg border border-gray-200 p-5"><h2 className="text-lg font-semibold text-gray-800 mb-4">邀请链接</h2><button onClick={generateInvite} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700">生成邀请码</button>{inviteCode && <div className="mt-3 space-y-3"><div><label className="text-sm text-gray-600 block mb-1">邀请码</label><div className="flex items-center gap-2"><input value={inviteCode} readOnly className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 font-mono" /><button onClick={() => { navigator.clipboard.writeText(inviteCode); feedback.success('邀请码已复制') }} className="text-sm bg-gray-200 px-3 py-2 rounded hover:bg-gray-300">复制</button></div></div><div><label className="text-sm text-gray-600 block mb-1">邀请链接</label><div className="flex items-center gap-2"><input value={inviteUrl} readOnly className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50" /><button onClick={() => { navigator.clipboard.writeText(inviteUrl); feedback.success('链接已复制') }} className="text-sm bg-gray-200 px-3 py-2 rounded hover:bg-gray-300">复制</button></div></div></div>}</section><section className="bg-white rounded-lg border border-red-200 p-5"><h2 className="text-lg font-semibold text-red-600 mb-2">危险操作</h2><p className="text-sm text-gray-500 mb-4">永久删除这个项目及其所有关联数据。此操作不可恢复。</p>{!canDeleteRoom && <p className="text-sm text-red-500 mb-3">只有项目所有者可以永久删除项目。</p>}<button onClick={() => { if (!canDeleteRoom) { feedback.warning('你没有权限永久删除该项目'); return } setShowDeleteConfirm(true) }} className={`px-4 py-2 rounded-lg text-sm ${canDeleteRoom ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>永久删除项目</button></section></div>}
      </main>

      {showAddCollaborator && <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setShowAddCollaborator(false)}><div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl p-5 shadow-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}><div className="flex items-center justify-between mb-4"><h3 className="text-lg font-semibold text-gray-800">添加协作者</h3><button onClick={() => setShowAddCollaborator(false)} className="text-gray-400 hover:text-gray-600">✕</button></div><div className="flex bg-gray-100 rounded-xl p-1 mb-4 w-fit"><button onClick={() => setAddKind('people')} className={`px-4 py-2 rounded-lg text-sm ${addKind === 'people' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>人员</button><button onClick={() => setAddKind('agents')} className={`px-4 py-2 rounded-lg text-sm ${addKind === 'agents' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>Agent</button></div>{addKind === 'people' && <div><div className="flex gap-2 mb-3"><input value={collaboratorQuery} onChange={(e) => setCollaboratorQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchUsersForRoom()} placeholder="搜索用户名/昵称" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" /><button onClick={searchUsersForRoom} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">搜索</button></div><div className="space-y-2">{userSearchResults.length === 0 && <p className="text-sm text-gray-400">搜索人员后添加到项目。</p>}{userSearchResults.map((u) => { const already = members.some((m) => (m.id || m.userId) === u.id); return <div key={u.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100"><div className="flex items-center gap-2 min-w-0">{u.avatar ? <img src={u.avatar} className="w-8 h-8 rounded-full object-cover" /> : <span className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs">{(u.nickname || u.username || '?')[0].toUpperCase()}</span>}<div className="min-w-0"><p className="text-sm font-medium truncate">{u.nickname || u.username}</p><p className="text-xs text-gray-400 truncate">@{u.username}</p></div></div>{already ? <span className="text-xs text-gray-400">已在项目</span> : <button onClick={() => addUserCollaborator(u.id, 'editor')} className="text-xs text-blue-600 hover:text-blue-700">添加为编辑者</button>}</div> })}</div></div>}{addKind === 'agents' && <div className="space-y-2">{agents.length === 0 && <p className="text-sm text-gray-400">通讯录里还没有 Agent，请先回首页通讯录创建。</p>}{agents.map((a) => { const already = roomAgents.some((ra) => ra.id === a.id); return <div key={a.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-100"><div className="min-w-0"><span className="text-sm font-medium">{a.name}</span><span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-600">{a.roleType === 'assistant' ? '助理' : '专家'}</span>{a.description && <p className="text-xs text-gray-400 mt-1 truncate">{a.description}</p>}</div>{already ? <span className="text-xs text-gray-400">已在项目</span> : <div className="flex gap-2 shrink-0"><button onClick={() => addAgent(a.id, { roomRole: 'specialist', autoEnabled: false })} className="text-xs text-green-600 hover:text-green-700">作为专家</button><button onClick={() => addAgent(a.id, { roomRole: 'assistant', autoEnabled: true })} className="text-xs text-blue-600 hover:text-blue-700">设为自动助理</button></div>}</div> })}<p className="text-xs text-gray-400 pt-2">设为自动助理会关闭当前项目其他 Agent 的自动响应。</p></div>}</div></div>}
      {showDeleteConfirm && room && canDeleteRoom && <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => !deleting && setShowDeleteConfirm(false)}><div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 shadow-xl" onClick={(e) => e.stopPropagation()}><h3 className="text-lg font-semibold text-red-600 mb-2">永久删除项目</h3><p className="text-sm text-gray-600 leading-6">确定要永久删除项目「<span className="font-medium text-gray-800">{room.name}</span>」吗？</p><p className="text-sm text-gray-500 mt-2 leading-6">这会硬删除房间、消息、任务、标签页、邀请、文件和默认助理 Agent，删除后不可恢复。</p><div className="mt-5 flex gap-2 justify-end"><button disabled={deleting} onClick={() => setShowDeleteConfirm(false)} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-60">取消</button><button disabled={deleting} onClick={deleteRoom} className="px-4 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-60">{deleting ? '删除中...' : '确认永久删除'}</button></div></div></div>}
    </div>
  )
}
