import { useState } from 'react'
import { Link, Users } from 'lucide-react'
import { api } from '../../lib/api'

function Header({ onCreate }: { onCreate: () => void }) {
  return <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4"><div><h3 className="font-semibold text-gray-800">工作组</h3><p className="mt-1 text-sm text-gray-500">管理人员、Agent 资源池和可分享出去的接待入口。</p></div><button onClick={onCreate} className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white">新建工作组</button></div>
}

export function WorkgroupContacts({ workgroups, reloadWorkgroups }: { workgroups: any[]; reloadWorkgroups: () => void }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null)
  const [availableAgents, setAvailableAgents] = useState<any[]>([])
  const [entries, setEntries] = useState<any[]>([])
  const [agentForm, setAgentForm] = useState({ agentId: '', role: 'member' })
  const [entryForm, setEntryForm] = useState({ title: '', description: '', agentId: '', welcomeMessage: '' })
  const [msg, setMsg] = useState('')

  const loadDetail = async (id: string) => {
    setSelectedId(id)
    const data = await api.getWorkgroup(id)
    setDetail(data)
    setMsg('')
    if (data.workgroup?.canManage) {
      api.getWorkgroupAvailableAgents(id).then((r) => setAvailableAgents(r.agents || [])).catch(() => setAvailableAgents([]))
      api.getWorkgroupEntries(id).then((r) => setEntries(r.entries || [])).catch(() => setEntries([]))
    } else setEntries([])
  }
  const refreshCurrent = async () => { if (selectedId) await loadDetail(selectedId); await reloadWorkgroups() }
  const create = async () => {
    if (!name.trim()) return
    const data = await api.createWorkgroup({ name: name.trim(), description })
    setName(''); setDescription(''); setCreating(false); await reloadWorkgroups(); setDetail(data); setSelectedId(data.workgroup?.id || null)
  }
  const addAgent = async () => { if (selectedId && agentForm.agentId) { await api.addWorkgroupAgent(selectedId, agentForm); setAgentForm({ agentId: '', role: 'member' }); await refreshCurrent() } }
  const updateAgent = async (agent: any, role: string) => { if (selectedId) { await api.updateWorkgroupAgent(selectedId, agent.id, { role }); await refreshCurrent() } }
  const removeAgent = async (agent: any) => { if (selectedId && window.confirm(`移出 Agent「${agent.name}」？`)) { await api.removeWorkgroupAgent(selectedId, agent.id); await refreshCurrent() } }
  const updateMember = async (member: any, role: string) => { if (selectedId) { await api.updateWorkgroupMember(selectedId, member.user_id, { role }); await refreshCurrent() } }
  const removeMember = async (member: any) => { if (selectedId && window.confirm(`移出成员「${member.nickname || member.username}」？`)) { await api.removeWorkgroupMember(selectedId, member.user_id); await refreshCurrent() } }
  const createEntry = async () => {
    if (!selectedId || !entryForm.title.trim() || !entryForm.agentId) return
    const result = await api.createWorkgroupEntry(selectedId, entryForm)
    setEntryForm({ title: '', description: '', agentId: '', welcomeMessage: '' })
    setMsg(`入口已创建：${shareUrl(result.entry.token)}`)
    await refreshCurrent()
  }
  const toggleEntry = async (entry: any) => { if (selectedId) { await api.updateWorkgroupEntry(selectedId, entry.id, { enabled: !entry.enabled }); await refreshCurrent() } }
  const deleteEntry = async (entry: any) => { if (selectedId && window.confirm(`删除分享入口「${entry.title}」？`)) { await api.deleteWorkgroupEntry(selectedId, entry.id); await refreshCurrent() } }
  const shareUrl = (token?: string) => token ? `${window.location.origin}/workgroup-entry/${token}` : '创建时显示一次；需要新链接请新建入口'
  const copy = async (text: string) => { await navigator.clipboard?.writeText(text); setMsg('已复制链接') }
  const list = detail?.workgroup ? detail : null
  const canManage = !!list?.workgroup?.canManage

  return <div className="space-y-4"><Header onCreate={() => setCreating(!creating)} />
    {creating && <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50/40 p-3"><input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="工作组名称" /><textarea value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="描述（可选）" rows={2} /><div className="flex justify-end gap-2"><button onClick={() => setCreating(false)} className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600">取消</button><button onClick={create} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white">创建</button></div></div>}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{workgroups.length === 0 ? <p className="text-sm text-gray-400">暂无工作组。</p> : workgroups.map((wg) => <button key={wg.id} onClick={() => loadDetail(wg.id)} className={`fc-pressable min-h-[96px] rounded-xl border p-3 text-left shadow-sm transition ${selectedId === wg.id ? 'border-blue-200 bg-blue-50/60' : 'border-gray-100 bg-white hover:border-blue-100 hover:bg-blue-50/30'}`}><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Users className="h-5 w-5" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-gray-800">{wg.name}</p><p className="mt-1 text-xs text-gray-500">成员 {wg.member_count || 0} · Agent {wg.agent_count || 0} · 房间 {wg.room_count || 0}</p><p className="mt-1 text-xs text-gray-400">{wg.current_user_role || 'member'}{wg.canManage ? ' · 可管理' : ''}</p></div></div></button>)}</div>
    {msg && <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">{msg}</div>}
    {list && <section className="space-y-4 rounded-xl border border-gray-100 bg-white p-4"><div><h3 className="font-semibold text-gray-800">{list.workgroup.name}</h3><p className="mt-1 text-sm text-gray-500">{list.workgroup.description || '暂无描述'}</p></div>
      <div className="grid gap-3 lg:grid-cols-2"><Panel title="人员">{(list.members || []).map((m: any) => <div key={m.user_id} className="flex items-center justify-between gap-2 rounded-lg border p-2"><span className="min-w-0 truncate text-sm">{m.nickname || m.username}</span>{canManage ? <div className="flex gap-1"><select value={m.role} onChange={(e) => updateMember(m, e.target.value)} className="rounded-lg border px-2 py-1 text-xs"><option value="owner">owner</option><option value="admin">admin</option><option value="member">member</option><option value="viewer">viewer</option></select><button onClick={() => removeMember(m)} className="text-xs text-red-500">移出</button></div> : <span className="text-xs text-gray-400">{m.role}</span>}</div>)}</Panel>
      <Panel title="Agent">{canManage && <div className="mb-2 flex flex-wrap gap-2"><select value={agentForm.agentId} onChange={(e) => setAgentForm({ ...agentForm, agentId: e.target.value })} className="min-w-0 flex-1 rounded-lg border px-2 py-2 text-sm"><option value="">选择可加入 Agent</option>{availableAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><select value={agentForm.role} onChange={(e) => setAgentForm({ ...agentForm, role: e.target.value })} className="rounded-lg border px-2 py-2 text-sm"><option value="member">member</option><option value="assistant">assistant</option><option value="expert">expert</option><option value="operator">operator</option></select><button onClick={addAgent} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white">加入</button></div>}{(list.agents || []).map((a: any) => <div key={a.id} className="rounded-lg border p-2"><div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate text-sm font-medium">{a.name}</span>{canManage && <button onClick={() => removeAgent(a)} className="text-xs text-red-500">移出</button>}</div><div className="mt-1 flex items-center gap-2">{canManage ? <select value={a.workgroup_role} onChange={(e) => updateAgent(a, e.target.value)} className="rounded-lg border px-2 py-1 text-xs"><option value="member">member</option><option value="assistant">assistant</option><option value="expert">expert</option><option value="operator">operator</option></select> : <span className="text-xs text-gray-400">{a.workgroup_role}</span>}<span className="text-xs text-gray-400">{a.status}</span></div></div>)}</Panel></div>
      <Panel title="分享入口">{canManage && <div className="mb-3 grid gap-2"><input value={entryForm.title} onChange={(e) => setEntryForm({ ...entryForm, title: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" placeholder="入口标题" /><input value={entryForm.description} onChange={(e) => setEntryForm({ ...entryForm, description: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" placeholder="说明" /><select value={entryForm.agentId} onChange={(e) => setEntryForm({ ...entryForm, agentId: e.target.value })} className="rounded-lg border px-3 py-2 text-sm"><option value="">选择接待 Agent</option>{(list.agents || []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><textarea value={entryForm.welcomeMessage} onChange={(e) => setEntryForm({ ...entryForm, welcomeMessage: e.target.value })} rows={2} className="rounded-lg border px-3 py-2 text-sm" placeholder="欢迎语（可选）" /><button onClick={createEntry} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white">创建分享入口</button></div>}{entries.length === 0 ? <p className="text-sm text-gray-400">暂无分享入口。</p> : entries.map((e) => <div key={e.id} className="rounded-lg border p-3"><div className="flex items-center gap-2"><Link className="h-4 w-4 text-blue-500" /><b className="text-sm">{e.title}</b><span className={`rounded px-1.5 py-0.5 text-[10px] ${e.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>{e.enabled ? '启用' : '停用'}</span></div><p className="mt-1 text-xs text-gray-500">接待：{e.agentName || e.agentId}</p><div className="mt-2 flex flex-wrap gap-2">{e.token && <button onClick={() => copy(shareUrl(e.token))} className="rounded-lg bg-blue-50 px-2 py-1 text-xs text-blue-600">复制链接</button>}<button onClick={() => toggleEntry(e)} className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600">{e.enabled ? '停用' : '启用'}</button><button onClick={() => deleteEntry(e)} className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-500">删除</button></div></div>)}</Panel>
      <Panel title="房间">{(list.rooms || []).map((r: any) => <p key={r.id} className="truncate rounded-lg px-2 py-1.5 text-sm text-gray-600">{r.name}</p>)}</Panel>
    </section>}
  </div>
}

function Panel({ title, children }: { title: string; children: any }) { return <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><p className="mb-2 text-xs font-medium text-gray-500">{title}</p><div className="space-y-2">{children}</div></div> }
