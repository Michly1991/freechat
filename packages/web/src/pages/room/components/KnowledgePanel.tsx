import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Plus, Search, Trash2, X } from 'lucide-react'
import { api } from '../../../lib/api'

type Scope = 'public' | 'agent' | 'room'

const scopeLabel: Record<Scope, string> = { public: '公共', agent: 'Agent 专属', room: '房间' }
const scopeHint: Record<Scope, string> = {
  public: '通用法规、模板、制度等，所有授权 Agent 可参考。',
  agent: '只属于这个 Agent 的经验、案例和方法论。',
  room: '只属于当前房间/客户/项目的事实、资料和结论。',
}

export function KnowledgePanel({ scope, agentId, roomId, feedback, compact = false }: { scope: Scope; agentId?: string; roomId?: string; feedback?: any; compact?: boolean }) {
  const [entries, setEntries] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<any | null>(null)
  const [form, setForm] = useState({ title: '', content: '', tags: '' })
  const [saving, setSaving] = useState(false)
  const params = useMemo(() => ({ scope, agentId, roomId, q }), [scope, agentId, roomId, q])

  const load = async () => {
    try { const data = await api.getKnowledge(params); setEntries(data.entries || []) }
    catch (e: any) { feedback?.error?.(e?.message || '加载知识库失败') }
  }
  useEffect(() => { void load() }, [scope, agentId, roomId])

  const beginNew = () => { setEditing({ id: null }); setForm({ title: '', content: '', tags: '' }) }
  const beginEdit = (item: any) => { setEditing(item); setForm({ title: item.title || '', content: item.content || '', tags: (item.tags || []).join(', ') }) }
  const save = async () => {
    if (!form.title.trim() || !form.content.trim()) { feedback?.error?.('标题和内容不能为空'); return }
    setSaving(true)
    const body = { scope, agentId, roomId, title: form.title.trim(), content: form.content.trim(), tags: form.tags.split(/[,，]/).map((x) => x.trim()).filter(Boolean) }
    try {
      if (editing?.id) await api.updateKnowledge(editing.id, body)
      else await api.createKnowledge(body)
      feedback?.success?.('知识已保存')
      setEditing(null); await load()
    } catch (e: any) { feedback?.error?.(e?.message || '保存失败') }
    finally { setSaving(false) }
  }
  const remove = async (item: any) => {
    if (!window.confirm(`删除知识「${item.title}」？`)) return
    try { await api.deleteKnowledge(item.id); feedback?.success?.('已删除'); await load() }
    catch (e: any) { feedback?.error?.(e?.message || '删除失败') }
  }

  return <section className={`rounded-xl border border-gray-200 bg-white ${compact ? 'p-3' : 'p-4'}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="flex items-center gap-1.5 font-semibold text-gray-800"><BookOpen className="h-4 w-4 text-blue-500" />{scopeLabel[scope]}知识库</h3><p className="mt-1 text-xs text-gray-400">{scopeHint[scope]}</p></div>
      <button type="button" onClick={beginNew} className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"><Plus className="mr-1 inline h-3.5 w-3.5" />新增</button>
    </div>
    <div className="mt-3 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
      <Search className="h-4 w-4 text-gray-400" /><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} placeholder="搜索标题、内容、标签" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /><button type="button" onClick={load} className="text-xs text-blue-600">搜索</button>
    </div>
    <div className="mt-3 space-y-2">
      {entries.length === 0 && <p className="rounded-xl bg-gray-50 px-3 py-6 text-center text-sm text-gray-400">暂无知识，先新增一条。</p>}
      {entries.map((item) => <article key={item.id} className="rounded-xl border border-gray-100 bg-gray-50/70 p-3">
        <div className="flex items-start justify-between gap-2"><button type="button" onClick={() => beginEdit(item)} className="min-w-0 text-left"><h4 className="truncate text-sm font-medium text-gray-800">{item.title}</h4><p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">{item.content}</p></button><button type="button" onClick={() => remove(item)} className="shrink-0 rounded-lg p-1.5 text-red-400 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button></div>
        {item.tags?.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{item.tags.map((tag: string) => <span key={tag} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-600">{tag}</span>)}</div>}
      </article>)}
    </div>
    {editing && <div className="fixed inset-0 z-[75] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setEditing(null)}>
      <div className="w-full max-w-xl rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3"><div><h3 className="font-semibold text-gray-800">{editing.id ? '编辑知识' : '新增知识'}</h3><p className="text-xs text-gray-400">{scopeLabel[scope]}知识库</p></div><button type="button" onClick={() => setEditing(null)} className="rounded-full p-1 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button></div>
        <div className="max-h-[72vh] space-y-3 overflow-y-auto p-4">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="标题，例如：刑事案件量刑经验" className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="标签，用逗号分隔" className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={compact ? 7 : 10} placeholder="知识内容、案例经验、适用边界、注意事项..." className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm leading-6" />
        </div>
        <div className="flex gap-2 border-t border-gray-100 p-4"><button type="button" onClick={() => setEditing(null)} className="flex-1 rounded-xl bg-gray-100 px-4 py-2 text-sm text-gray-600">取消</button><button type="button" disabled={saving} onClick={save} className="flex-1 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{saving ? '保存中...' : '保存'}</button></div>
      </div>
    </div>}
  </section>
}
