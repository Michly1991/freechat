import { useEffect, useState } from 'react'
import { Bot, Compass, Map, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { AGENT_TOOL_KEYS } from '../home-agent-form'
import type { ContactsSectionProps } from './types'
import { AgentConfigEditor } from '../room/components/AgentConfigEditor'
import { TemplatePermissionPanel } from '../room/components/TemplatePermissionPanel'

export function ContactsSection(props: ContactsSectionProps) {
  const {
    contactKind,
    setContactKind,
    searchQ,
    setSearchQ,
    searchResults,
    friends,
    agents,
    scenes,
    reloadScenes,
    friendRequests,
    showCreateAgent,
    editingAgentId,
    agentForm,
    setAgentForm,
    openCreateAgent,
    resetAgentEditor,
    searchUsers,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    openDm,
    toggleAgentTool,
    createAgentFromContacts,
    openEditAgent,
    deleteAgentFromContacts,
  } = props

  return (
    <section className="bg-white sm:rounded-xl sm:border border-gray-200 p-4 sm:p-5 mb-4 sm:mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold text-gray-800">通讯录</h2>
      </div>
      <div className="flex bg-gray-100 rounded-xl p-1 mb-4 w-fit">
        <button onClick={() => setContactKind('people')} className={`px-4 py-2 rounded-lg text-sm ${contactKind === 'people' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>人员</button>
        <button onClick={() => setContactKind('agents')} className={`px-4 py-2 rounded-lg text-sm ${contactKind === 'agents' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>Agent</button>
        <button onClick={() => setContactKind('scenes')} className={`px-4 py-2 rounded-lg text-sm ${contactKind === 'scenes' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>场景</button>
      </div>

      {contactKind === 'people' && (
        <PeopleContacts
          searchQ={searchQ}
          setSearchQ={setSearchQ}
          searchResults={searchResults}
          friends={friends}
          friendRequests={friendRequests}
          searchUsers={searchUsers}
          sendFriendRequest={sendFriendRequest}
          acceptFriendRequest={acceptFriendRequest}
          rejectFriendRequest={rejectFriendRequest}
          openDm={openDm}
        />
      )}

      {contactKind === 'agents' && (
        <AgentContacts
          agents={agents}
          showCreateAgent={showCreateAgent}
          editingAgentId={editingAgentId}
          agentForm={agentForm}
          setAgentForm={setAgentForm}
          toggleAgentTool={toggleAgentTool}
          createAgentFromContacts={createAgentFromContacts}
          resetAgentEditor={resetAgentEditor}
          openCreateAgent={openCreateAgent}
          openEditAgent={openEditAgent}
          deleteAgentFromContacts={deleteAgentFromContacts}
        />
      )}

      {contactKind === 'scenes' && <SceneContacts scenes={scenes} agents={agents} reloadScenes={reloadScenes} />}
    </section>
  )
}

function ContactCreateHeader({ title, description, buttonLabel, onCreate }: { title: string; description: string; buttonLabel: string; onCreate: () => void }) {
  return <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm text-blue-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
    <div><p className="font-semibold text-blue-900">{title}</p><p className="mt-0.5">{description}</p></div>
    <button onClick={onCreate} className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 shrink-0"><Plus className="w-4 h-4" />{buttonLabel}</button>
  </div>
}

type PeopleProps = Pick<ContactsSectionProps,
  'searchQ' | 'setSearchQ' | 'searchResults' | 'friends' | 'friendRequests' | 'searchUsers' |
  'sendFriendRequest' | 'acceptFriendRequest' | 'rejectFriendRequest' | 'openDm'
>

function PeopleContacts({ searchQ, setSearchQ, searchResults, friends, friendRequests, searchUsers, sendFriendRequest, acceptFriendRequest, rejectFriendRequest, openDm }: PeopleProps) {
  const [showCreatePerson, setShowCreatePerson] = useState(false)
  return (
    <div className="space-y-4">
      <ContactCreateHeader title="人员" description="搜索用户并添加好友，后续可邀请到项目协作。" buttonLabel="新增人员" onCreate={() => setShowCreatePerson(!showCreatePerson)} />
      {showCreatePerson && <div className="p-4 border border-blue-100 bg-blue-50/50 rounded-xl space-y-3">
        <div className="flex gap-2">
          <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchUsers()} placeholder="搜索用户名/昵称添加好友" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <button onClick={searchUsers} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">搜索</button>
        </div>
      </div>}
      {searchResults.length > 0 && (
        <div className="space-y-2 mb-4">
          {searchResults.map((u) => (
            <div key={u.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50">
              <div className="flex items-center gap-2">
                {u.avatar ? <img src={u.avatar} className="w-8 h-8 rounded-full object-cover" /> : <span className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs">{(u.nickname || u.username || '?')[0].toUpperCase()}</span>}
                <span className="text-sm font-medium">{u.nickname || u.username}</span>
                <span className="text-xs text-gray-400">@{u.username}</span>
              </div>
              {u.friendStatus === 'none' && <button onClick={() => sendFriendRequest(u.id)} className="text-xs text-blue-600 hover:text-blue-700">加好友</button>}
              {u.friendStatus === 'friends' && <span className="text-xs text-green-600">已是好友</span>}
              {u.friendStatus === 'pending_sent' && <span className="text-xs text-gray-400">已申请</span>}
              {u.friendStatus === 'pending_received' && <span className="text-xs text-orange-500">待你处理</span>}
              {u.friendStatus === 'self' && <span className="text-xs text-gray-400">自己</span>}
            </div>
          ))}
        </div>
      )}
      {friendRequests.received.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-600 mb-2">好友申请</h3>
          <div className="space-y-2">
            {friendRequests.received.map((r) => (
              <div key={r.id} className="flex items-center justify-between p-2 rounded-lg bg-orange-50">
                <span className="text-sm">{r.user.nickname || r.user.username} 请求添加你为好友</span>
                <div className="flex gap-2">
                  <button onClick={() => acceptFriendRequest(r.id)} className="text-xs text-green-600">同意</button>
                  <button onClick={() => rejectFriendRequest(r.id)} className="text-xs text-red-500">拒绝</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
        {friends.length === 0 ? <p className="text-sm text-gray-400">暂无好友，先搜索添加一个吧</p> : friends.map((f) => (
          <div key={f.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100">
            <div className="flex items-center gap-2 min-w-0">
              {f.avatar ? <img src={f.avatar} className="w-9 h-9 rounded-full object-cover" /> : <span className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 text-white flex items-center justify-center text-sm">{(f.nickname || f.username || '?')[0].toUpperCase()}</span>}
              <div className="min-w-0"><p className="text-sm font-medium truncate">{f.nickname || f.username}</p><p className="text-xs text-gray-400 truncate">@{f.username}</p></div>
            </div>
            <button onClick={() => openDm(f.id)} className="text-xs text-blue-600 hover:text-blue-700">发消息</button>
          </div>
        ))}
      </div>
    </div>
  )
}

type AgentProps = Pick<ContactsSectionProps,
  'agents' | 'showCreateAgent' | 'editingAgentId' | 'agentForm' | 'setAgentForm' | 'toggleAgentTool' |
  'createAgentFromContacts' | 'resetAgentEditor' | 'openCreateAgent' | 'openEditAgent' | 'deleteAgentFromContacts'
>

function AgentContacts({ agents, showCreateAgent, editingAgentId, agentForm, setAgentForm, toggleAgentTool, createAgentFromContacts, resetAgentEditor, openCreateAgent, openEditAgent, deleteAgentFromContacts }: AgentProps) {
  const [skills, setSkills] = useState<any[]>([])
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null)
  const [skillForm, setSkillForm] = useState({ name: '', description: '', content: '', enabled: true })
  const [skillSaving, setSkillSaving] = useState(false)

  useEffect(() => {
    setEditingSkillId(null)
    setSkillForm({ name: '', description: '', content: '', enabled: true })
    if (showCreateAgent && editingAgentId) loadAgentSkills(editingAgentId)
    else setSkills([])
  }, [showCreateAgent, editingAgentId])

  const loadAgentSkills = async (agentId: string) => {
    try { const detail = await api.getAgentDetail(agentId); setSkills(detail.skills || []) } catch (err) { console.error(err) }
  }

  const startNewSkill = () => {
    setEditingSkillId('new')
    setSkillForm({ name: '', description: '', content: '# 新 Skill\n\n## 适用场景\n\n## 操作步骤\n', enabled: true })
  }

  const startEditSkill = (skill: any) => {
    setEditingSkillId(skill.id)
    setSkillForm({ name: skill.name || '', description: skill.description || '', content: skill.content || '', enabled: skill.enabled !== false })
  }

  const saveSkill = async () => {
    if (!editingAgentId || !skillForm.name.trim()) return
    try {
      setSkillSaving(true)
      if (editingSkillId === 'new') await api.createAgentSkill(editingAgentId, { ...skillForm, name: skillForm.name.trim() })
      else if (editingSkillId) await api.updateAgentSkill(editingAgentId, editingSkillId, { ...skillForm, name: skillForm.name.trim() })
      setEditingSkillId(null)
      setSkillForm({ name: '', description: '', content: '', enabled: true })
      await loadAgentSkills(editingAgentId)
    } finally { setSkillSaving(false) }
  }

  const removeSkill = async (skillId: string) => {
    if (!editingAgentId) return
    await api.deleteAgentSkill(editingAgentId, skillId)
    await loadAgentSkills(editingAgentId)
  }

  const currentAgent = editingAgentId ? agents.find((agent) => agent.id === editingAgentId) : null
  const canEditCurrent = !editingAgentId || currentAgent?.canEdit !== false

  return (
    <div className="space-y-4">
      <ContactCreateHeader title="Agent" description="管理全局共享 Agent 模板；创建项目时会克隆为项目副本。" buttonLabel="新增 Agent" onCreate={() => showCreateAgent && !editingAgentId ? resetAgentEditor() : openCreateAgent()} />
      {showCreateAgent && (
        <div className="p-4 border border-blue-100 bg-blue-50/50 rounded-xl space-y-3">
          <div className="text-sm font-semibold text-gray-700">{editingAgentId ? (canEditCurrent ? '编辑 Agent' : '查看 Agent') : '新建 Agent'}</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <input value={agentForm.name} disabled={!canEditCurrent} onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })} className="px-3 py-2 border border-gray-300 rounded text-sm disabled:bg-gray-50 disabled:text-gray-500" placeholder="Agent 名称，例如：需求分析师" />
            <select value={agentForm.roleType} disabled={!canEditCurrent} onChange={(e) => setAgentForm({ ...agentForm, roleType: e.target.value as any })} className="px-3 py-2 border border-gray-300 rounded text-sm disabled:bg-gray-50 disabled:text-gray-500"><option value="assistant">业务助理</option><option value="specialist">业务专家</option></select>
          </div>
          <input value={agentForm.description} disabled={!canEditCurrent} onChange={(e) => setAgentForm({ ...agentForm, description: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm disabled:bg-gray-50 disabled:text-gray-500" placeholder="职责描述" />
          <input value={agentForm.specialties} disabled={!canEditCurrent} onChange={(e) => setAgentForm({ ...agentForm, specialties: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm disabled:bg-gray-50 disabled:text-gray-500" placeholder="专长，逗号分隔" />
          <textarea value={agentForm.systemPrompt} disabled={!canEditCurrent} onChange={(e) => setAgentForm({ ...agentForm, systemPrompt: e.target.value })} rows={4} className="w-full px-3 py-2 border border-gray-300 rounded text-sm disabled:bg-gray-50 disabled:text-gray-500" placeholder="系统提示词" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
            {AGENT_TOOL_KEYS.map((key) => <label key={key} className="flex items-center gap-2 bg-white border border-gray-200 rounded px-3 py-2"><input type="checkbox" disabled={!canEditCurrent} checked={agentForm.tools[key]} onChange={() => toggleAgentTool(key)} />{key}</label>)}
          </div>
          {editingAgentId && (
            <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-3">
              <div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-gray-700">Skills</p><p className="text-xs text-gray-400">维护这个 Agent 的技能说明，运行时会写入 skills/。</p></div>{canEditCurrent && <button onClick={startNewSkill} className="px-2.5 py-1.5 rounded-lg bg-blue-50 text-xs text-blue-600 hover:bg-blue-100">+ 新建 Skill</button>}</div>
              {skills.length === 0 && editingSkillId !== 'new' && <p className="text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg p-3">暂无 Skill。</p>}
              <div className="space-y-2">{skills.map((skill) => <div key={skill.id} className="border border-gray-100 rounded-lg p-2"><div className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-sm font-medium text-gray-700 truncate">{skill.name}</p>{skill.description && <p className="text-xs text-gray-400 truncate">{skill.description}</p>}</div>{canEditCurrent && <div className="flex gap-2 shrink-0"><button onClick={() => startEditSkill(skill)} className="text-xs text-blue-600">编辑</button><button onClick={() => removeSkill(skill.id)} className="text-xs text-red-500">删除</button></div>}</div></div>)}</div>
              {editingSkillId && <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 space-y-2"><input value={skillForm.name} onChange={(e) => setSkillForm({ ...skillForm, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="Skill 名称" /><input value={skillForm.description} onChange={(e) => setSkillForm({ ...skillForm, description: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="Skill 描述" /><label className="text-xs text-gray-500 flex items-center gap-2"><input type="checkbox" checked={skillForm.enabled} onChange={(e) => setSkillForm({ ...skillForm, enabled: e.target.checked })} />启用</label><textarea value={skillForm.content} onChange={(e) => setSkillForm({ ...skillForm, content: e.target.value })} rows={8} className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-mono" placeholder="SKILL.md 内容" /><div className="flex gap-2 justify-end"><button onClick={() => setEditingSkillId(null)} className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs">取消</button><button onClick={saveSkill} disabled={skillSaving || !skillForm.name.trim()} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs disabled:opacity-60">{skillSaving ? '保存中...' : '保存 Skill'}</button></div></div>}
            </div>
          )}
          <div className="flex gap-2">{canEditCurrent && <button onClick={createAgentFromContacts} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">{editingAgentId ? '保存修改' : '保存 Agent'}</button>}<button onClick={resetAgentEditor} className="bg-gray-100 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-200">{canEditCurrent ? '取消' : '关闭'}</button></div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {agents.length === 0 ? <p className="text-sm text-gray-400">暂无 Agent，点击右上角新建一个。</p> : [...agents].sort((a, b) => (a.builtInKey === 'default_assistant' ? -1 : 0) - (b.builtInKey === 'default_assistant' ? -1 : 0)).map((a) => (
          <div key={a.id} className="p-3 rounded-xl border border-gray-100 flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-blue-500 text-white flex items-center justify-center shrink-0"><Bot className="w-5 h-5" /></span>
              <div className="min-w-0"><div className="flex items-center gap-2 flex-wrap"><p className="text-sm font-medium truncate">{a.name}</p><span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-600">{a.roleType === 'assistant' ? '助理' : '专家'}</span>{a.builtInKey === 'default_assistant' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">默认助理</span>}</div>{a.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{a.description}</p>}<p className="text-xs text-gray-400 mt-1 truncate">Owner：{a.ownerName || a.ownerId || '未知'}</p>{a.specialties?.length > 0 && <p className="text-xs text-gray-400 mt-1 truncate">{a.specialties.join('、')}</p>}</div>
            </div>
            <div className="flex items-center gap-1 shrink-0">{a.canEdit !== false ? <><button onClick={() => openEditAgent(a)} className="text-blue-500 hover:text-blue-700 p-1" title="编辑 Agent"><Pencil className="w-4 h-4" /></button>{a.canDelete !== false && <button onClick={() => deleteAgentFromContacts(a)} className="text-red-400 hover:text-red-600 p-1" title="删除 Agent"><Trash2 className="w-4 h-4" /></button>}</> : <button onClick={() => openEditAgent(a)} className="text-[10px] px-2 py-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200">查看</button>}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SceneContacts({ scenes, agents, reloadScenes }: { scenes: any[]; agents: any[]; reloadScenes: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<{ name: string; description: string; agents: any[] }>({ name: '', description: '', agents: [] })
  const [selectedGlobalAgentId, setSelectedGlobalAgentId] = useState('')
  const [saving, setSaving] = useState(false)

  const beginNew = () => {
    setEditingId('new')
    setForm({ name: '新场景', description: '', agents: [] })
    setSelectedGlobalAgentId('')
  }

  const beginEdit = (scene: any) => {
    if (scene.canEdit === false) return
    setEditingId(scene.id)
    setForm({ name: scene.name || '', description: scene.description || '', agents: (scene.agents || []).map((agent: any) => ({ ...agent })) })
    setSelectedGlobalAgentId(scene.agents?.[0]?.agentId || '')
  }

  const saveScene = async () => {
    if (!editingId || !form.name.trim()) return
    const normalizedName = form.name.replace(/\s+/g, '')
    if (editingId === 'new' && normalizedName === 'Agent管理') {
      alert('Agent 管理是系统内置项目，不能重复创建')
      return
    }
    const current = scenes.find((scene) => scene.id === editingId)
    if (current?.canEdit === false) return
    try {
      setSaving(true)
      if (editingId === 'new') await api.createScene({ name: form.name.trim(), description: form.description, agents: form.agents })
      else await api.updateScene(editingId, { name: form.name.trim(), description: form.description, agents: form.agents })
      setEditingId(null)
      setSelectedGlobalAgentId('')
      reloadScenes()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <ContactCreateHeader title="场景" description="管理全局共享场景模板；场景只维护默认 Agent 关系，创建项目时克隆为项目副本。" buttonLabel="新增场景" onCreate={beginNew} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(scenes.length === 0 && editingId !== 'new') ? <p className="text-sm text-gray-400">暂无场景。</p> : (editingId === 'new' ? [{ id: 'new', name: '新场景', description: '', agents: [], canEdit: true }, ...scenes] : scenes).map((scene) => {
          const editing = editingId === scene.id
          return (
            <div key={scene.id} className={`p-4 rounded-xl border bg-white ${editing ? 'sm:col-span-2 border-blue-200 ring-2 ring-blue-50' : 'border-gray-100'}`}>
              <div className="flex items-start gap-3">
                <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-300 to-orange-500 text-white flex items-center justify-center shrink-0">{scene.icon === 'compass' ? <Compass className="w-5 h-5" /> : <Map className="w-5 h-5" />}</span>
                <div className="min-w-0 flex-1">
                  {editing ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-3">
                        <div><h3 className="font-semibold text-gray-800">{editingId === 'new' ? '新增场景' : '编辑场景'}</h3><p className="text-xs text-gray-400 mt-0.5">场景只关联全局 Agent；Agent 详情是全局模板配置。</p></div>
                        <span className="text-[10px] px-2 py-1 rounded-full bg-gray-100 text-gray-500">v{scene.version || 1}</span>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <label className="text-xs text-gray-500 space-y-1"><span>场景名称</span><input value={form.name} disabled={scene.isBuiltIn && editingId !== 'new'} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-800 disabled:bg-gray-100 disabled:text-gray-400" placeholder="场景名称" /></label>
                        <label className="text-xs text-gray-500 space-y-1"><span>场景描述</span><textarea value={form.description} disabled={scene.isBuiltIn && editingId !== 'new'} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-800 disabled:bg-gray-100 disabled:text-gray-400" placeholder="场景描述" /></label>
                      </div>
                      {scene.isBuiltIn && editingId !== 'new' && <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">Agent 管理是系统内置项目，不能删除，也不能作为普通场景重复创建；这里仅维护它关联的全局 Agent 配置。</p>}
                      {editingId !== 'new' && <TemplatePermissionPanel targetType="scene" targetId={scene.id} canEdit={scene.canEdit !== false} feedback={{ error: alert, success: () => {} }} />}
                      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-3">
                        <div className="flex items-center justify-between"><div><p className="text-sm font-medium text-gray-700">全局 Agent</p><p className="text-xs text-gray-400">选择场景包含的全局 Agent，并可直接配置模板。</p></div><button onClick={() => { const first = agents.find((item) => !form.agents.some((a) => a.agentId === item.id)); setForm({ ...form, agents: [...form.agents, { agentId: first?.id || '', name: first?.name || '', roleType: first?.roleType, autoEnabled: false, priority: form.agents.length }] }); if (first?.id) setSelectedGlobalAgentId(first.id) }} className="px-2.5 py-1.5 rounded-lg bg-blue-50 text-xs text-blue-600 hover:bg-blue-100">+ 添加</button></div>
                        {form.agents.length === 0 && <p className="text-xs text-gray-400 bg-white border border-dashed border-gray-200 rounded-lg p-3">还没有默认 Agent。</p>}
                        {form.agents.map((agent, index) => {
                          const selectedTemplate = agents.find((item) => item.id === agent.agentId)
                          const canAuto = selectedTemplate?.roleType === 'assistant' || agent.roleType === 'assistant'
                          return <div key={index} className="bg-white border border-gray-100 rounded-xl p-3 space-y-2"><div className="grid grid-cols-1 sm:grid-cols-[1fr_110px_90px] gap-2"><select value={agent.agentId || ''} onChange={(e) => { const selected = agents.find((item) => item.id === e.target.value); setForm({ ...form, agents: form.agents.map((item, i) => i === index ? { ...item, agentId: e.target.value, name: selected?.name || item.name, roleType: selected?.roleType || item.roleType, autoEnabled: selected?.roleType === 'assistant' ? item.autoEnabled : false } : item) }); setSelectedGlobalAgentId(e.target.value) }} className="w-full px-2 py-2 border rounded-lg text-xs text-gray-700"><option value="">选择全局 Agent</option>{agents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><label className={`text-xs flex items-center gap-1 h-9 ${canAuto ? '' : 'text-gray-300'}`}><input type="checkbox" disabled={!canAuto} checked={!!agent.autoEnabled && canAuto} onChange={(e) => setForm({ ...form, agents: form.agents.map((item, i) => i === index ? { ...item, autoEnabled: e.target.checked } : { ...item, autoEnabled: e.target.checked ? false : item.autoEnabled }) })} />自动</label><div className="flex items-center justify-end gap-2"><button onClick={() => setSelectedGlobalAgentId(agent.agentId)} className="text-xs text-blue-600">配置</button><button onClick={() => setForm({ ...form, agents: form.agents.filter((_, i) => i !== index) })} className="text-xs text-red-500">删除</button></div></div></div>
                        })}
                      </div>
                      {selectedGlobalAgentId && <div className="rounded-xl border border-blue-100 bg-blue-50/20 p-3"><AgentConfigEditor agentId={selectedGlobalAgentId} feedback={{ error: alert, success: () => {} }} scopeLabel="全局 Agent 模板配置：通讯录和场景共用，影响后续克隆到新项目的 Agent。" onSaved={reloadScenes} /></div>}
                      <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-2 border-t border-gray-100">
                        <button onClick={() => { setEditingId(null); setSelectedGlobalAgentId('') }} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm">取消</button>
                        <button onClick={saveScene} disabled={saving || !form.name.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-60">{saving ? '保存中...' : editingId === 'new' ? '创建场景' : '保存场景'}</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-gray-800">{scene.name}{scene.isBuiltIn && <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">内置</span>}{scene.canEdit === false && <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">只读</span>}</p>{scene.description && <p className="text-xs text-gray-500 mt-1">{scene.description}</p>}</div>{scene.canEdit !== false && <button onClick={() => beginEdit(scene)} className="text-blue-500 hover:text-blue-700 p-1"><Pencil className="w-4 h-4" /></button>}</div>
                      <div className="mt-3 flex flex-wrap gap-1">{(scene.agents || []).map((agent: any) => <span key={agent.agentId} className="text-[10px] px-2 py-1 rounded-full bg-violet-50 text-violet-600">{agent.name}{agent.autoEnabled ? ' · 自动' : ''}</span>)}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
