import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import { useFeedback } from '../components/FeedbackProvider'

export default function RoomSettingsPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const feedback = useFeedback()
  const [room, setRoom] = useState<any>(null)
  const [members, setMembers] = useState<any[]>([])
  const [agents, setAgents] = useState<any[]>([])
  const [roomAgents, setRoomAgents] = useState<any[]>([])
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [showCreateAgent, setShowCreateAgent] = useState(false)
  const [newAgent, setNewAgent] = useState({
    name: '',
    roleType: 'assistant' as 'assistant' | 'specialist',
    description: '',
    specialties: '',
    systemPrompt: '',
    autoEnabled: true,
    tools: { chat: true, task: true, file: true, tab: true, interaction: true, members: true },
  })
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [profileForm, setProfileForm] = useState({ role_title: '', persona: '', specialties: '' })
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const currentMember = members.find((member) => (member.id || member.userId) === user?.id)
  const canDeleteRoom = currentMember?.role === 'owner'

  useEffect(() => {
    if (!roomId) return
    loadAll()
  }, [roomId])

  const loadAll = async () => {
    try {
      const data = await api.getRoom(roomId!)
      setRoom(data.room)
      setMembers(data.members)
      setEditName(data.room.name)
      setEditDesc(data.room.description || '')
      try { const ra = await api.getRoomAgents(roomId!); setRoomAgents(ra.agents || []) } catch {}
      try { const a = await api.getAgents(); setAgents(a.agents || []) } catch {}
    } catch { navigate('/') }
  }

  const saveRoom = async () => {
    try { await api.updateRoom(roomId!, { name: editName, description: editDesc }); feedback.success('保存成功') } catch (e: any) { feedback.error(e.message || '保存失败') }
  }

  const deleteRoom = async () => {
    if (!roomId || !room || deleting) return
    setDeleting(true)
    try {
      await api.deleteRoom(roomId)
      setShowDeleteConfirm(false)
      feedback.success('项目已删除')
      navigate('/')
    } catch (e: any) {
      feedback.error('删除失败: ' + (e.message || JSON.stringify(e)))
    } finally {
      setDeleting(false)
    }
  }

  const generateInvite = async () => {
    try {
      const data = await api.createInvite(roomId!)
      setInviteCode(data.code)
      setInviteUrl(data.url?.startsWith('http') ? data.url : `${window.location.origin}/join?code=${data.code}`)
    } catch (e: any) {
      feedback.error('生成失败: ' + (e.message || JSON.stringify(e)))
    }
  }

  const removeAgent = async (agentId: string) => {
    try { await api.removeRoomAgent(roomId!, agentId); feedback.success('Agent 已移除'); loadAll() } catch (e: any) { feedback.error(e.message || '移除失败') }
  }

  const addAgent = async (agentId: string, options?: { roomRole?: 'assistant' | 'specialist'; autoEnabled?: boolean }) => {
    try { await api.addRoomAgent(roomId!, agentId, options); feedback.success('Agent 已添加'); loadAll() } catch (e: any) { feedback.error(e.message || '添加失败') }
  }

  const createBusinessAgent = async () => {
    const name = newAgent.name.trim()
    if (!name) { feedback.warning('请输入 Agent 名称'); return }
    try {
      const specialties = newAgent.specialties.split(',').map((s) => s.trim()).filter(Boolean)
      const config = {
        systemPrompt: newAgent.systemPrompt,
        behavior: { replyMode: newAgent.autoEnabled || newAgent.roleType === 'assistant' ? 'auto_when_relevant' : 'mention_only', silentAllowed: true },
        tools: newAgent.tools,
      }
      const created = await api.createAgent({
        name,
        roleType: newAgent.roleType,
        deployment: 'server',
        description: newAgent.description,
        specialties,
        config,
      })
      await api.addRoomAgent(roomId!, created.agent.id, { roomRole: newAgent.roleType, autoEnabled: newAgent.autoEnabled })
      feedback.success('业务 Agent 已创建并添加')
      setShowCreateAgent(false)
      setNewAgent({ name: '', roleType: 'assistant', description: '', specialties: '', systemPrompt: '', autoEnabled: true, tools: { chat: true, task: true, file: true, tab: true, interaction: true, members: true } })
      loadAll()
    } catch (e: any) { feedback.error(e.message || '创建失败') }
  }

  const toggleTool = (key: keyof typeof newAgent.tools) => {
    setNewAgent((prev) => ({ ...prev, tools: { ...prev.tools, [key]: !prev.tools[key] } }))
  }

  const searchAgents = async () => {
    if (!searchQ.trim()) return
    try { const data = await api.searchMarket(searchQ); setSearchResults(data.agents || []) } catch (e: any) { feedback.error(e.message || '搜索失败') }
  }

  const startEditProfile = (member: any) => {
    setEditingMemberId(member.id || member.userId)
    setProfileForm({
      role_title: member.role_title || '',
      persona: member.persona || '',
      specialties: (member.specialties || []).join(', '),
    })
  }

  const saveProfile = async () => {
    if (!editingMemberId) return
    try {
      await api.updateMemberProfile(roomId!, editingMemberId, {
        role_title: profileForm.role_title,
        persona: profileForm.persona,
        specialties: profileForm.specialties.split(',').map((s) => s.trim()).filter(Boolean),
      })
      setEditingMemberId(null)
      loadAll()
    } catch (e: any) { feedback.error(e.message || '保存失败') }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate(`/room/${roomId}`)} className="text-gray-500 hover:text-gray-700">← 返回房间</button>
        <h1 className="font-semibold text-gray-800">房间设置</h1>
      </header>

      <div className="max-w-3xl mx-auto p-4 space-y-6">
        {/* Room Info */}
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">基本信息</h2>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-gray-600 block mb-1">房间名称</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">描述</label>
              <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <button onClick={saveRoom} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">保存</button>
          </div>
        </section>

        {/* Invite */}
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">邀请链接</h2>
          <button onClick={generateInvite} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700">生成邀请码</button>
          {inviteCode && (
            <div className="mt-3 space-y-3">
              <div>
                <label className="text-sm text-gray-600 block mb-1">邀请码</label>
                <div className="flex items-center gap-2">
                  <input value={inviteCode} readOnly className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 font-mono" />
                  <button onClick={() => { navigator.clipboard.writeText(inviteCode); feedback.success('邀请码已复制') }} className="text-sm bg-gray-200 px-3 py-2 rounded hover:bg-gray-300">复制</button>
                </div>
              </div>
              <div>
                <label className="text-sm text-gray-600 block mb-1">邀请链接</label>
                <div className="flex items-center gap-2">
                  <input value={inviteUrl} readOnly className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50" />
                  <button onClick={() => { navigator.clipboard.writeText(inviteUrl); feedback.success('链接已复制') }} className="text-sm bg-gray-200 px-3 py-2 rounded hover:bg-gray-300">复制</button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Members */}
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">成员列表</h2>
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id || m.userId} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  {m.avatar ? (
                    <img src={m.avatar} alt="头像" className="w-8 h-8 rounded-full object-cover border border-gray-200" />
                  ) : (
                    <span className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-xs font-semibold">
                      {(m.nickname || m.username || '?')[0].toUpperCase()}
                    </span>
                  )}
                  <span className="font-medium text-sm text-gray-800">{m.nickname || m.username || '未命名用户'}</span>
                  {m.username && m.username !== m.nickname && <span className="ml-2 text-xs text-gray-400">@{m.username}</span>}
                  {m.role_title && <span className="ml-1 text-xs text-blue-500">{m.role_title}</span>}
                </div>
                <button onClick={() => startEditProfile(m)} className="text-xs text-blue-500 hover:text-blue-700">编辑资料</button>
              </div>
            ))}
          </div>
          {editingMemberId && (
            <div className="mt-4 p-4 border border-gray-200 rounded-lg space-y-3">
              <h3 className="text-sm font-semibold">编辑成员资料</h3>
              <div>
                <label className="text-xs text-gray-600 block mb-1">角色头衔</label>
                <input value={profileForm.role_title} onChange={(e) => setProfileForm({ ...profileForm, role_title: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">人设描述</label>
                <textarea value={profileForm.persona} onChange={(e) => setProfileForm({ ...profileForm, persona: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">专长（逗号分隔）</label>
                <input value={profileForm.specialties} onChange={(e) => setProfileForm({ ...profileForm, specialties: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
              </div>
              <div className="flex gap-2">
                <button onClick={saveProfile} className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700">保存</button>
                <button onClick={() => setEditingMemberId(null)} className="bg-gray-200 text-gray-600 px-3 py-1 rounded text-sm hover:bg-gray-300">取消</button>
              </div>
            </div>
          )}
        </section>

        {/* Agents */}
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">Agent 管理</h2>
            <button onClick={() => setShowCreateAgent((v) => !v)} className="text-sm bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700">
              {showCreateAgent ? '收起' : '新建业务 Agent'}
            </button>
          </div>

          {showCreateAgent && (
            <div className="mb-5 p-4 border border-blue-100 bg-blue-50/50 rounded-xl space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-600 block mb-1">Agent 名称</label>
                  <input value={newAgent.name} onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="例如：需求分析师" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 block mb-1">类型</label>
                  <select value={newAgent.roleType} onChange={(e) => setNewAgent({ ...newAgent, roleType: e.target.value as any, autoEnabled: e.target.value === 'assistant' })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm">
                    <option value="assistant">业务助理（参考助理 Agent）</option>
                    <option value="specialist">业务专家（默认仅 @ 响应）</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">职责描述</label>
                <input value={newAgent.description} onChange={(e) => setNewAgent({ ...newAgent, description: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="这个 Agent 负责什么" />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">专长（逗号分隔）</label>
                <input value={newAgent.specialties} onChange={(e) => setNewAgent({ ...newAgent, specialties: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="需求分析, PRD, 验收标准" />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">系统提示词</label>
                <textarea value={newAgent.systemPrompt} onChange={(e) => setNewAgent({ ...newAgent, systemPrompt: e.target.value })} rows={4} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="你是资深... 请按照... 输出..." />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={newAgent.autoEnabled} onChange={(e) => setNewAgent({ ...newAgent, autoEnabled: e.target.checked })} />
                作为本项目自动助理（开启后会关闭其他自动 Agent）
              </label>
              <div>
                <div className="text-xs text-gray-600 mb-2">工具权限（后端会强制校验）</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                  {(['chat', 'task', 'file', 'tab', 'interaction', 'members'] as const).map((key) => (
                    <label key={key} className="flex items-center gap-2 bg-white border border-gray-200 rounded px-3 py-2">
                      <input type="checkbox" checked={newAgent.tools[key]} onChange={() => toggleTool(key)} />
                      {key}
                    </label>
                  ))}
                </div>
              </div>
              <button onClick={createBusinessAgent} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">创建并添加到项目</button>
            </div>
          )}

          <h3 className="text-sm font-medium text-gray-600 mb-2">当前房间 Agent</h3>
          <div className="space-y-2 mb-4">
            {roomAgents.length === 0 && <p className="text-sm text-gray-400">暂无 Agent</p>}
            {roomAgents.map((a) => (
              <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100">
                <div>
                  <span className="text-sm font-medium">{a.name}</span>
                  <span className={`ml-2 text-[11px] px-2 py-0.5 rounded-full ${a.autoEnabled ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{a.autoEnabled ? '自动助理' : (a.roomRole === 'assistant' ? '助理' : '专家')}</span>
                  {a.description && <span className="text-xs text-gray-400 ml-2">{a.description}</span>}
                </div>
                <button onClick={() => removeAgent(a.id)} className="text-xs text-red-500 hover:text-red-700">移除</button>
              </div>
            ))}
          </div>
          <h3 className="text-sm font-medium text-gray-600 mb-2">添加我的 Agent</h3>
          <div className="space-y-2 mb-4">
            {agents.filter((a) => !roomAgents.some((ra) => ra.id === a.id)).length === 0 && <p className="text-sm text-gray-400">暂无可添加的我的 Agent，可先新建业务 Agent。</p>}
            {agents.filter((a) => !roomAgents.some((ra) => ra.id === a.id)).map((a) => (
              <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100">
                <div>
                  <span className="text-sm font-medium">{a.name}</span>
                  {a.description && <span className="text-xs text-gray-400 ml-2">{a.description}</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => addAgent(a.id, { roomRole: 'specialist', autoEnabled: false })} className="text-xs text-green-600 hover:text-green-700">作为专家添加</button>
                  <button onClick={() => addAgent(a.id, { roomRole: 'assistant', autoEnabled: true })} className="text-xs text-blue-600 hover:text-blue-700">设为自动助理</button>
                </div>
              </div>
            ))}
          </div>
          <h3 className="text-sm font-medium text-gray-600 mb-2">官方推荐</h3>
          <div className="flex gap-2 mb-3">
            <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="搜索市场..." className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm" onKeyDown={(e) => e.key === 'Enter' && searchAgents()} />
            <button onClick={searchAgents} className="bg-blue-600 text-white px-3 py-2 rounded text-sm hover:bg-blue-700">搜索</button>
          </div>
          <div className="space-y-2">
            {searchResults.map((a) => (
              <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 opacity-70">
                <div>
                  <span className="text-sm font-medium">{a.name}</span>
                  {a.description && <span className="text-xs text-gray-400 ml-2">{a.description}</span>}
                </div>
                <span className="text-xs text-gray-400">推荐模板暂不直接添加</span>
              </div>
            ))}
          </div>
        </section>

        {/* Danger Zone */}
        <section className="bg-white rounded-lg border border-red-200 p-5">
          <h2 className="text-lg font-semibold text-red-600 mb-2">危险操作</h2>
          <p className="text-sm text-gray-500 mb-4">永久删除这个项目及其所有关联数据。此操作不可恢复。</p>
          {!canDeleteRoom && (
            <p className="text-sm text-red-500 mb-3">只有项目所有者可以永久删除项目。</p>
          )}
          <button
            onClick={() => {
              if (!canDeleteRoom) {
                feedback.warning('你没有权限永久删除该项目')
                return
              }
              setShowDeleteConfirm(true)
            }}
            className={`px-4 py-2 rounded-lg text-sm ${canDeleteRoom ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
            aria-disabled={!canDeleteRoom}
            title={canDeleteRoom ? '永久删除项目' : '你没有权限永久删除该项目'}
          >
            永久删除项目
          </button>
        </section>
      </div>

      {showDeleteConfirm && room && canDeleteRoom && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => !deleting && setShowDeleteConfirm(false)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-red-600 mb-2">永久删除项目</h3>
            <p className="text-sm text-gray-600 leading-6">
              确定要永久删除项目「<span className="font-medium text-gray-800">{room.name}</span>」吗？
            </p>
            <p className="text-sm text-gray-500 mt-2 leading-6">
              这会硬删除房间、消息、任务、标签页、邀请、文件和默认助理 Agent，删除后不可恢复。
            </p>
            <div className="mt-5 flex gap-2 justify-end">
              <button
                disabled={deleting}
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-60"
              >
                取消
              </button>
              <button
                disabled={deleting}
                onClick={deleteRoom}
                className="px-4 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? '删除中...' : '确认永久删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
