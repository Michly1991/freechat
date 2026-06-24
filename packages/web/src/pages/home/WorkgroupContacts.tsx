import { useState } from 'react'
import { Bot, CalendarClock, Copy, ExternalLink, Link, Plus, ShieldCheck, Trash2, Users } from 'lucide-react'
import { api } from '../../lib/api'

type EntryForm = { id?: string; title: string; description: string; agentId: string; welcomeMessage: string; maxUses: string; expiresAt: string; enabled: boolean }
const emptyEntryForm: EntryForm = { title: '', description: '', agentId: '', welcomeMessage: '', maxUses: '', expiresAt: '', enabled: true }

function shareUrl(token?: string) { return token ? `${window.location.origin}/workgroup-entry/${token}` : '' }
function formatDate(ts?: number | string | null) { return ts ? new Date(Number(ts)).toLocaleString() : '不限' }
function toDatetimeLocal(ts?: number | string | null) { if (!ts) return ''; const d = new Date(Number(ts)); const pad = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` }
function roleLabel(role?: string) { return ({ owner: '所有者', admin: '管理员', member: '成员', viewer: '访客', assistant: '成员', expert: '成员', operator: '成员' } as any)[role || ''] || role || '-' }

export function WorkgroupContacts({ workgroups, reloadWorkgroups }: { workgroups: any[]; reloadWorkgroups: () => void }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null)
  const [availableAgents, setAvailableAgents] = useState<any[]>([])
  const [entries, setEntries] = useState<any[]>([])
  const [agentForm, setAgentForm] = useState({ agentId: '', role: 'member' })
  const [memberQuery, setMemberQuery] = useState('')
  const [memberResults, setMemberResults] = useState<any[]>([])
  const [entryForm, setEntryForm] = useState<EntryForm>(emptyEntryForm)
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const loadDetail = async (id: string) => {
    setSelectedId(id)
    const data = await api.getWorkgroup(id)
    setDetail(data)
    setMsg('')
    api.getWorkgroupEntries(id).then((r) => setEntries(r.entries || [])).catch(() => setEntries([]))
    if (data.workgroup?.canManage) {
      api.getWorkgroupAvailableAgents(id).then((r) => setAvailableAgents(r.agents || [])).catch(() => setAvailableAgents([]))
      setMemberResults([])
      setMemberQuery('')
    } else {
      setAvailableAgents([])
    }
  }
  const refreshCurrent = async () => { if (selectedId) await loadDetail(selectedId); await reloadWorkgroups() }
  const create = async () => {
    if (!name.trim()) return
    const data = await api.createWorkgroup({ name: name.trim(), description })
    setName(''); setDescription(''); setCreating(false); await reloadWorkgroups(); setDetail(data); setSelectedId(data.workgroup?.id || null)
  }
  const addAgent = async () => { if (selectedId && agentForm.agentId) { await api.addWorkgroupAgent(selectedId, agentForm); setAgentForm({ agentId: '', role: 'member' }); await refreshCurrent() } }
  const searchMembers = async () => { if (!memberQuery.trim()) return; const data = await api.searchUsers(memberQuery.trim()); setMemberResults((data.users || []).filter((u: any) => (u.identityType || 'human') === 'human')) }
  const addMember = async (user: any) => { if (selectedId) { await api.addWorkgroupMember(selectedId, user.id); setMsg(`已加入成员：${user.nickname || user.username}`); setMemberQuery(''); setMemberResults([]); await refreshCurrent() } }
  const removeAgent = async (agent: any) => { if (selectedId && window.confirm(`移出 Agent「${agent.name}」？相关分享入口将无法继续使用该 Agent，建议先确认。`)) { await api.removeWorkgroupAgent(selectedId, agent.id); await refreshCurrent() } }
  const updateMember = async (member: any, role: string) => { if (selectedId) { await api.updateWorkgroupMember(selectedId, member.user_id, { role }); await refreshCurrent() } }
  const removeMember = async (member: any) => { if (selectedId && window.confirm(`移出成员「${member.nickname || member.username}」？`)) { await api.removeWorkgroupMember(selectedId, member.user_id); await refreshCurrent() } }
  const entryPayload = () => ({
    title: entryForm.title.trim(), description: entryForm.description.trim(), agentId: entryForm.agentId,
    welcomeMessage: entryForm.welcomeMessage.trim(), enabled: entryForm.enabled,
    maxUses: entryForm.maxUses ? Number(entryForm.maxUses) : null,
    expiresAt: entryForm.expiresAt ? new Date(entryForm.expiresAt).getTime() : null,
  })
  const resetEntryForm = () => { setEntryForm(emptyEntryForm); setEditingEntryId(null) }
  const submitEntry = async () => {
    if (!selectedId || !entryForm.title.trim() || !entryForm.agentId) return
    const result = editingEntryId ? await api.updateWorkgroupEntry(selectedId, editingEntryId, entryPayload()) : await api.createWorkgroupEntry(selectedId, entryPayload())
    setMsg(editingEntryId ? '分享入口已更新' : `入口已创建：${shareUrl(result.entry.token)}`)
    resetEntryForm(); await refreshCurrent()
  }
  const editEntry = (entry: any) => { setEditingEntryId(entry.id); setEntryForm({ id: entry.id, title: entry.title || '', description: entry.description || '', agentId: entry.agentId || '', welcomeMessage: entry.welcomeMessage || '', maxUses: entry.maxUses ? String(entry.maxUses) : '', expiresAt: toDatetimeLocal(entry.expiresAt), enabled: !!entry.enabled }) }
  const toggleEntry = async (entry: any) => { if (selectedId && window.confirm(`${entry.enabled ? '停用' : '启用'}分享入口「${entry.title}」？`)) { await api.updateWorkgroupEntry(selectedId, entry.id, { enabled: !entry.enabled }); await refreshCurrent() } }
  const deleteEntry = async (entry: any) => { if (selectedId && window.confirm(`删除分享入口「${entry.title}」？删除后已有链接将不可访问，但已创建的对话不会删除。`)) { await api.deleteWorkgroupEntry(selectedId, entry.id); await refreshCurrent() } }
  const copy = async (text: string) => { if (!text) return; await navigator.clipboard?.writeText(text); setMsg('已复制分享链接') }
  const list = detail?.workgroup ? detail : null
  const canManage = !!list?.workgroup?.canManage

  return <div className="space-y-4">
    <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-semibold text-gray-800">工作组</h3><p className="mt-1 text-sm text-gray-500">管理人员、Agent 资源池和可分享出去的接待入口。</p></div><button onClick={() => setCreating(!creating)} className="fc-pressable inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm text-white"><Plus className="h-4 w-4" />新建工作组</button></div>
    {creating && <div className="space-y-2 rounded-2xl border border-blue-100 bg-blue-50/40 p-3"><input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="工作组名称" /><textarea value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="描述（可选）" rows={2} /><div className="flex justify-end gap-2"><button onClick={() => setCreating(false)} className="rounded-xl bg-white px-3 py-2 text-sm text-gray-600">取消</button><button onClick={create} className="rounded-xl bg-blue-600 px-3 py-2 text-sm text-white">创建</button></div></div>}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{workgroups.length === 0 ? <Empty text="暂无工作组。创建一个工作组，把 Agent 和分享入口组织起来。" /> : workgroups.map((wg) => <button key={wg.id} onClick={() => loadDetail(wg.id)} className={`fc-pressable min-h-[96px] rounded-2xl border p-3 text-left shadow-sm transition ${selectedId === wg.id ? 'border-blue-200 bg-blue-50/60' : 'border-gray-100 bg-white hover:border-blue-100 hover:bg-blue-50/30'}`}><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Users className="h-5 w-5" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-gray-800">{wg.name}</p><p className="mt-1 text-xs text-gray-500">成员 {wg.member_count || 0} · Agent {wg.agent_count || 0} · 房间 {wg.room_count || 0}</p><p className="mt-1 text-xs text-gray-400">{roleLabel(wg.current_user_role)}{wg.canManage ? ' · 可管理' : ''}</p></div></div></button>)}</div>
    {msg && <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">{msg}</div>}
    {list && <section className="space-y-4 rounded-2xl border border-gray-100 bg-white p-4"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-gray-800">{list.workgroup.name}</h3><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{roleLabel(list.workgroup.current_user_role)}</span>{canManage && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600">可管理</span>}</div><p className="mt-1 text-sm text-gray-500">{list.workgroup.description || '暂无描述'}</p></div>
      <div className="grid gap-3 lg:grid-cols-2"><Panel title="人员" icon={<Users className="h-4 w-4" />}>{canManage && <div className="mb-2 space-y-2 rounded-xl border border-blue-100 bg-blue-50/40 p-2"><div className="flex gap-2"><input value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchMembers()} className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm" placeholder="搜索用户名/昵称添加真人用户" /><button onClick={searchMembers} className="rounded-xl bg-blue-600 px-3 py-2 text-sm text-white">搜索</button></div>{memberResults.length > 0 && <div className="space-y-1">{memberResults.map((u: any) => { const already = (list.members || []).some((m: any) => m.user_id === u.id); return <div key={u.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-2"><div className="min-w-0"><p className="truncate text-sm font-medium text-gray-700">{u.nickname || u.username}</p><p className="truncate text-xs text-gray-400">@{u.username}</p></div>{already ? <span className="text-xs text-gray-400">已在工作组</span> : <button onClick={() => addMember(u)} className="shrink-0 text-xs text-blue-600">加入</button>}</div> })}</div>}</div>}{(list.members || []).map((m: any) => <div key={m.user_id} className="flex items-center justify-between gap-2 rounded-xl border bg-white p-2"><span className="min-w-0 truncate text-sm">{m.nickname || m.username}</span>{canManage ? <div className="flex gap-1"><select value={m.role} onChange={(e) => updateMember(m, e.target.value)} className="rounded-lg border px-2 py-1 text-xs"><option value="owner">owner</option><option value="admin">admin</option><option value="member">member</option><option value="viewer">viewer</option></select><button onClick={() => removeMember(m)} className="text-xs text-red-500">移出</button></div> : <span className="text-xs text-gray-400">{roleLabel(m.role)}</span>}</div>)}</Panel>
      <Panel title="Agent 成员" icon={<Bot className="h-4 w-4" />}>{canManage && <div className="mb-2 grid gap-2 sm:grid-cols-[1fr_auto]"><select value={agentForm.agentId} onChange={(e) => setAgentForm({ ...agentForm, agentId: e.target.value })} className="min-w-0 rounded-xl border px-2 py-2 text-sm"><option value="">选择可加入 Agent</option>{availableAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><button onClick={addAgent} className="rounded-xl bg-blue-600 px-3 py-2 text-sm text-white">加入</button></div>}{(list.agents || []).length === 0 ? <Empty text="还没有 Agent。先加入一个 Agent，才能创建分享入口。" /> : (list.agents || []).map((a: any) => <div key={a.id} className="rounded-xl border bg-white p-3"><div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate text-sm font-medium">{a.name}</span>{canManage && <button onClick={() => removeAgent(a)} className="inline-flex items-center gap-1 text-xs text-red-500"><Trash2 className="h-3.5 w-3.5" />移出</button>}</div><div className="mt-2 flex items-center gap-2"><span className="rounded bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">Agent 成员</span><span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{a.status}</span></div></div>)}</Panel></div>
      <Panel title="分享入口" icon={<Link className="h-4 w-4" />} wide>{canManage && <div className="mb-4 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-3"><div className="mb-3 flex items-start gap-2 text-sm text-emerald-800"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><p>公开链接，登录用户都可访问；系统会为每个使用者创建独立对话，费用由使用者自己承担。</p></div><div className="grid gap-2 sm:grid-cols-2"><input value={entryForm.title} onChange={(e) => setEntryForm({ ...entryForm, title: e.target.value })} className="rounded-xl border px-3 py-2 text-sm" placeholder="入口标题" /><select value={entryForm.agentId} onChange={(e) => setEntryForm({ ...entryForm, agentId: e.target.value })} className="rounded-xl border px-3 py-2 text-sm"><option value="">选择接待 Agent</option>{(list.agents || []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><input value={entryForm.description} onChange={(e) => setEntryForm({ ...entryForm, description: e.target.value })} className="rounded-xl border px-3 py-2 text-sm sm:col-span-2" placeholder="入口说明" /><textarea value={entryForm.welcomeMessage} onChange={(e) => setEntryForm({ ...entryForm, welcomeMessage: e.target.value })} rows={2} className="rounded-xl border px-3 py-2 text-sm sm:col-span-2" placeholder="欢迎语（可选，会显示在新对话里）" /><input value={entryForm.maxUses} onChange={(e) => setEntryForm({ ...entryForm, maxUses: e.target.value.replace(/[^0-9]/g, '') })} className="rounded-xl border px-3 py-2 text-sm" placeholder="最大使用次数（可选）" /><input type="datetime-local" value={entryForm.expiresAt} onChange={(e) => setEntryForm({ ...entryForm, expiresAt: e.target.value })} className="rounded-xl border px-3 py-2 text-sm" /><label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={entryForm.enabled} onChange={(e) => setEntryForm({ ...entryForm, enabled: e.target.checked })} />启用入口</label><div className="flex justify-end gap-2"><button onClick={resetEntryForm} className="rounded-xl bg-white px-3 py-2 text-sm text-gray-600">清空</button><button onClick={submitEntry} className="rounded-xl bg-emerald-600 px-3 py-2 text-sm text-white">{editingEntryId ? '保存入口' : '创建入口'}</button></div></div></div>}{entries.length === 0 ? <Empty text={canManage ? "还没有分享入口。创建一个入口，把指定 Agent 通过公开链接分享给别人使用。" : "还没有分享入口。"} /> : <div className="grid gap-3 md:grid-cols-2">{entries.map((e) => <EntryCard key={e.id} entry={e} canManage={canManage} onCopy={copy} onEdit={editEntry} onToggle={toggleEntry} onDelete={deleteEntry} />)}</div>}</Panel>
      <Panel title="房间" icon={<Users className="h-4 w-4" />}>{(list.rooms || []).length === 0 ? <Empty text="暂无工作组房间。" /> : (list.rooms || []).map((r: any) => <p key={r.id} className="truncate rounded-lg px-2 py-1.5 text-sm text-gray-600">{r.name}</p>)}</Panel>
    </section>}
  </div>
}

function EntryCard({ entry, canManage, onCopy, onEdit, onToggle, onDelete }: { entry: any; canManage: boolean; onCopy: (url: string) => void; onEdit: (entry: any) => void; onToggle: (entry: any) => void; onDelete: (entry: any) => void }) {
  const url = shareUrl(entry.token)
  const personalUrl = entry.myShareLink?.token ? `${url}?ref=${encodeURIComponent(entry.myShareLink.token)}` : url
  return <div className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><Link className="h-4 w-4 text-blue-500" /><b className="truncate text-sm text-gray-800">{entry.title}</b><span className={`rounded-full px-2 py-0.5 text-[10px] ${entry.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>{entry.enabled ? '启用' : '停用'}</span></div><p className="mt-1 text-xs text-gray-500">入口 Agent：{entry.agentName || entry.agentId}</p>{entry.description && <p className="mt-2 line-clamp-2 text-xs text-gray-500">{entry.description}</p>}</div></div><div className="mt-3 grid gap-2 rounded-xl bg-gray-50 p-3 text-xs text-gray-500"><p>使用次数：{entry.usedCount || 0}{entry.maxUses ? ` / ${entry.maxUses}` : ' / 不限'}</p><p className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />过期时间：{formatDate(entry.expiresAt)}</p><p>费用：链接使用者自付费</p>{entry.myShareLink && <p>我的分享：访问 {entry.myShareLink.visitCount || 0} · 使用 {entry.myShareLink.joinCount || 0}</p>}</div><div className="mt-3 flex flex-wrap gap-2">{personalUrl && <button onClick={() => onCopy(personalUrl)} className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs text-blue-600"><Copy className="h-3.5 w-3.5" />复制专属链接</button>}{personalUrl && <a href={personalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600"><ExternalLink className="h-3.5 w-3.5" />预览</a>}{canManage && <button onClick={() => onEdit(entry)} className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600">编辑</button>}{canManage && <button onClick={() => onToggle(entry)} className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600">{entry.enabled ? '停用' : '启用'}</button>}{canManage && <button onClick={() => onDelete(entry)} className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-500">删除</button>}</div></div>
}
function Panel({ title, icon, children, wide }: { title: string; icon?: any; children: any; wide?: boolean }) { return <div className={`rounded-2xl border border-gray-100 bg-gray-50 p-3 ${wide ? 'lg:col-span-2' : ''}`}><p className="mb-3 flex items-center gap-2 text-xs font-medium text-gray-500">{icon}{title}</p><div className="space-y-2">{children}</div></div> }
function Empty({ text }: { text: string }) { return <p className="rounded-xl border border-dashed border-gray-200 bg-white px-3 py-4 text-sm text-gray-400">{text}</p> }
