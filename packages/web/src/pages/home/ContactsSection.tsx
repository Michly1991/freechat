import { Fragment, useEffect, useRef, useState } from 'react'
import { Bot, Compass, Cpu, Eye, Heart, Map, MessageCircle, Pencil, PlayCircle, Plus, Store, Trash2, Upload } from 'lucide-react'
import { api } from '../../lib/api'
import type { ContactsSectionProps } from './types'
import { AgentConfigEditor } from '../room/components/AgentConfigEditor'
import { TemplatePermissionPanel } from '../room/components/TemplatePermissionPanel'
import { KnowledgePanel } from '../room/components/KnowledgePanel'
import { WorkgroupContacts } from './WorkgroupContacts'

function IdentityBadge({ identityType }: { identityType?: string }) {
  const isAgent = identityType === 'agent'
  return <span className={`inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${isAgent ? 'bg-violet-50 text-violet-600' : 'bg-gray-100 text-gray-500'}`}>{isAgent ? 'Agent' : '真人'}</span>
}

export function ContactsSection(props: ContactsSectionProps) {
  const {
    contactKind,
    setContactKind,
    searchQ,
    setSearchQ,
    searchResults,
    friends,
    friendRequests,
    searchUsers,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    openDm,
    openAgentChat,
    agents,
    scenes,
    workgroups,
    reloadWorkgroups,
    reloadScenes,
    reloadAgents,
    showCreateAgent,
    editingAgentId,
    agentForm,
    setAgentForm,
    toggleAgentTool,
    createAgentFromContacts,
    resetAgentEditor,
    openCreateAgent,
    openEditAgent,
    deleteAgentFromContacts,
  } = props

  return (
    <section className="bg-white sm:rounded-xl sm:border border-gray-200 p-4 sm:p-5 mb-4 sm:mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div><h2 className="text-lg font-semibold text-gray-800">通讯录</h2><p className="text-xs text-gray-400 mt-0.5">管理好友、已关注 Agent/模型和已购买场景。</p></div>
      </div>
      <div className="sticky top-[57px] z-20 -mx-4 mb-4 overflow-x-auto bg-white/95 px-4 pb-2 pt-1 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:pt-0 fc-scrollbar-hide"><div className="inline-flex min-w-max gap-1 rounded-2xl bg-gray-100 p-1">
        {[['people', '人员'], ['agents', 'Agent'], ['workgroups', '工作组'], ['models', '模型'], ['scenes', '场景'], ['knowledge', '知识']].map(([key, label]) => <button key={key} onClick={() => setContactKind(key as any)} className={`fc-pressable rounded-xl border px-4 py-2 text-sm ${contactKind === key ? 'border-blue-100 bg-white text-blue-600 shadow-sm' : 'border-transparent text-gray-500'}`}>{label}</button>)}
      </div></div>
      {contactKind === 'people' && <PeopleContacts
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
      />}
      {contactKind === 'agents' && <AgentContacts agents={agents.filter((a: any) => a.canUse)} reloadAgents={reloadAgents} openCreateAgent={openCreateAgent} openEditAgent={openEditAgent} deleteAgentFromContacts={deleteAgentFromContacts} openAgentChat={openAgentChat} />}
      {contactKind === 'workgroups' && <WorkgroupContacts workgroups={workgroups} reloadWorkgroups={reloadWorkgroups} />}
      {contactKind === 'models' && <ModelContacts />}
      {contactKind === 'scenes' && <SceneContacts scenes={scenes.filter((s: any) => s.canUse)} agents={agents.filter((a: any) => a.canUse)} reloadScenes={reloadScenes} />}
      {contactKind === 'knowledge' && <KnowledgePanel scope="public" feedback={{ error: alert, success: () => {} }} compact />}
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
                <span className="flex items-center gap-1 text-sm font-medium min-w-0"><span className="truncate">{u.nickname || u.username}</span><IdentityBadge identityType={u.identityType} /></span>
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
              <div className="min-w-0"><p className="flex items-center gap-1 text-sm font-medium"><span className="truncate">{f.nickname || f.username}</span><IdentityBadge identityType={f.identityType} /></p><p className="text-xs text-gray-400 truncate">@{f.username}</p></div>
            </div>
            <button onClick={() => openDm(f.id)} className="text-xs text-blue-600 hover:text-blue-700">发消息</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ModelContacts() {
  const [models, setModels] = useState<any[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', baseUrl: '', apiKey: '', defaultModel: '', models: '', visibility: 'private' })
  const load = async () => { const data = await api.getModelProfiles(); setModels((data.profiles || []).filter((m: any) => m.canUse)) }
  useEffect(() => { void load() }, [])
  const beginNew = () => { setEditingId('new'); setForm({ name: '我的模型服务', baseUrl: '', apiKey: '', defaultModel: '', models: '', visibility: 'private' }) }
  const beginEdit = (model: any) => { if (!model.canEdit) return; setEditingId(model.id); setForm({ name: model.name || '', baseUrl: model.baseUrl || '', apiKey: '', defaultModel: model.defaultModel || '', models: (model.models || []).join(','), visibility: model.visibility || 'private' }) }
  const save = async () => {
    if (!form.name.trim()) return
    if (editingId === 'new') await api.createModelProfile(form)
    else if (editingId) await api.updateModelProfile(editingId, form)
    setEditingId(null); await load()
  }
  const toggleFollow = async (model: any) => {
    if (model.isOwner || model.visibility === 'platform') return
    if (model.isFollowing) await api.unfollowMarketTarget('model', model.id)
    else await api.followMarketTarget('model', model.id)
    await load()
  }
  const toggleList = async (model: any) => { await api.updateModelProfile(model.id, { visibility: model.visibility === 'shared' ? 'private' : 'shared' }); await load() }
  return <div className="space-y-4"><ContactCreateHeader title="模型" description="管理自己创建或已关注的模型服务；上架后才会出现在别人的市场。" buttonLabel="新增模型" onCreate={beginNew} />
    {editingId && <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 space-y-3"><p className="text-sm font-semibold text-gray-700">{editingId === 'new' ? '新增模型服务' : '编辑模型服务'}</p><div className="grid sm:grid-cols-2 gap-2"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="px-3 py-2 border rounded-lg text-sm" placeholder="服务名称" /><input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className="px-3 py-2 border rounded-lg text-sm" placeholder="Base URL" /><input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} className="px-3 py-2 border rounded-lg text-sm" placeholder="API Key（留空不改）" /><input value={form.defaultModel} onChange={(e) => setForm({ ...form, defaultModel: e.target.value })} className="px-3 py-2 border rounded-lg text-sm" placeholder="默认模型" /><input value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })} className="px-3 py-2 border rounded-lg text-sm sm:col-span-2" placeholder="支持模型，逗号分隔" /></div><div className="flex justify-end gap-2"><button onClick={() => setEditingId(null)} className="px-3 py-2 rounded-lg bg-gray-100 text-sm text-gray-600">取消</button><button onClick={save} className="px-3 py-2 rounded-lg bg-blue-600 text-sm text-white">保存</button></div></div>}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{models.length === 0 ? <p className="text-sm text-gray-400">暂无可用模型，先新增或去市场关注一个。</p> : models.map((m) => <div key={m.id} className="rounded-xl border border-gray-100 p-3 bg-white flex items-start gap-3"><span className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500 text-white flex items-center justify-center shrink-0"><Cpu className="w-5 h-5" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2 flex-wrap"><p className="text-sm font-medium text-gray-800 truncate">{m.name}</p><span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{m.visibility === 'platform' ? '平台' : m.isOwner ? '我的' : '已关注'}</span>{m.visibility === 'shared' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">已上架</span>}</div><p className="text-xs text-gray-500 mt-1">默认模型：{m.defaultModel || '未配置'}</p><p className="text-xs text-gray-400 mt-1">价格：{m.priceSummary || '暂无定价'}</p><div className="mt-2 flex flex-wrap gap-2">{m.canEdit && <button onClick={() => beginEdit(m)} className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs text-blue-600">编辑</button>}{m.canEdit && m.visibility !== 'platform' && <button onClick={() => toggleList(m)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-600">{m.visibility === 'shared' ? '下架' : '上架'}</button>}{!m.isOwner && m.visibility !== 'platform' && <button onClick={() => toggleFollow(m)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-600">取消关注</button>}</div></div></div>)}</div>
  </div>
}

type AgentProps = Pick<ContactsSectionProps,
  'agents' | 'reloadAgents' | 'openCreateAgent' | 'openEditAgent' | 'deleteAgentFromContacts'
> & { mode?: 'contacts' | 'market'; openAgentChat?: (agentId: string) => void }

export function AgentContacts({ mode = 'contacts', agents, reloadAgents, openCreateAgent, openEditAgent, deleteAgentFromContacts, openAgentChat }: AgentProps) {
  const [packageUploading, setPackageUploading] = useState(false)
  const packageInputRef = useRef<HTMLInputElement | null>(null)

  const toggleFollowAgent = async (agent: any) => {
    if (agent.isOwner) return
    if (agent.isFollowing) await api.unfollowMarketTarget('agent', agent.id)
    else await api.followMarketTarget('agent', agent.id)
    reloadAgents()
  }

  const uploadAgentPackage = async (file?: File | null) => {
    if (!file) return
    try {
      setPackageUploading(true)
      const result = await api.uploadAgentPackage(file)
      alert(`Agent 包已${result.mode === 'create' ? '导入' : '更新'}并上架：${result.agent?.name || result.package?.name}`)
      await reloadAgents()
    } catch (err: any) {
      alert(err?.message || '上传 Agent 包失败')
    } finally {
      setPackageUploading(false)
      if (packageInputRef.current) packageInputRef.current.value = ''
    }
  }

  const toggleListAgent = async (agent: any) => {
    const result: any = await api.updateAgent(agent.id, { marketListed: !agent.marketListed })
    if (!agent.marketListed && result?.bindRequest) alert('已上架，并已加入客户端待接管队列；在线 Agent Client 会自动接管。')
    await reloadAgents()
  }

  const requestClientBind = async (agent: any) => {
    await api.requestAgentClientBind(agent.id)
    alert('已加入客户端待接管队列；在线 Agent Client 会自动接管。')
    await reloadAgents()
  }

  return (
    <div className="space-y-4">
      {mode === 'contacts' ? <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-semibold text-gray-800">Agent</h3><p className="text-sm text-gray-500 mt-1">管理自己创建或已关注的 Agent；上传 npm tgz 包会校验并直接上架市场。</p></div><div className="flex flex-wrap gap-2"><button onClick={openCreateAgent} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"><Plus className="w-4 h-4" />新增 AI</button><button disabled={packageUploading} onClick={() => packageInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"><Upload className="w-4 h-4" />{packageUploading ? '上传中...' : '上传并上架包'}</button><input ref={packageInputRef} type="file" accept=".tgz,.tar.gz" className="hidden" onChange={(e) => uploadAgentPackage(e.target.files?.[0])} /></div></div> : <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-emerald-800"><p className="font-semibold text-emerald-900">AI 市场</p><p className="mt-0.5">这里用于发现和关注已上架 Agent；新增和编辑请到通讯录。</p></div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {agents.length === 0 ? <p className="text-sm text-gray-400">AI市场暂无内容，点击右上角新建一个。</p> : [...agents].sort((a, b) => {
          const rank = (agent: any) => agent.builtInKey === 'default_assistant' ? 0 : agent.builtInKey === 'xiaomi_assistant' ? 1 : 2
          return rank(a) - rank(b)
        }).map((a) => (
          <Fragment key={a.id}>
          <div className="p-3 sm:p-3.5 rounded-2xl border border-gray-100 bg-white shadow-sm flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3 min-w-0">
              <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-blue-500 text-white flex items-center justify-center shrink-0"><Bot className="w-5 h-5" /></span>
              <div className="min-w-0"><div className="flex items-center gap-2 flex-wrap"><p className="text-sm font-medium truncate">{a.name}</p>{a.builtInKey === 'default_assistant' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">默认协调者</span>}{a.builtInKey === 'xiaomi_assistant' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-600">内置小蜜</span>}{a.deployment === 'client' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">客户端执行</span>}{a.managedByClient && <span className={`text-[10px] px-1.5 py-0.5 rounded ${a.clientConnectorStatus === 'online' || a.clientConnectorStatus === 'working' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>已接管{a.clientConnectorStatus ? ` · ${a.clientConnectorStatus}` : ''}</span>}{!a.managedByClient && a.clientBindPending && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">待接管</span>}{!a.managedByClient && !a.clientBindPending && a.deployment === 'client' && !a.builtInKey && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">未接管</span>}</div>{a.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{a.description}</p>}<p className="text-xs text-gray-400 mt-1 truncate">发布人：{a.ownerName || a.ownerId || '未知'}</p>{a.managedByClient && <p className="text-xs text-blue-500 mt-1 truncate">执行客户端：{a.clientConnectorName || '未命名客户端'}{a.clientLastSeenAt ? ` · ${new Date(a.clientLastSeenAt).toLocaleString()}` : ''}</p>}{a.clientBindPending && <p className="text-xs text-amber-600 mt-1 truncate">等待在线 Agent Client 自动接管</p>}{a.specialties?.length > 0 && <p className="text-xs text-gray-400 mt-1 truncate">{a.specialties.join('、')}</p>}</div>
            </div>
            <div className="flex w-full flex-row flex-wrap justify-end gap-2 border-t border-gray-100 pt-3 shrink-0 sm:w-auto sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
              {mode === 'contacts' && openAgentChat && <button onClick={() => openAgentChat(a.id)} className="fc-pressable flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm hover:bg-blue-700 sm:h-8 sm:w-8 sm:bg-blue-50 sm:text-blue-600 sm:shadow-none" title="私聊 Agent" aria-label="私聊 Agent"><MessageCircle className="h-4 w-4" /></button>}
              <div className="flex gap-2 sm:gap-1">
                {a.canEdit !== false ? <button onClick={() => openEditAgent(a)} className="fc-pressable flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 sm:h-8 sm:w-8" title="编辑 AI" aria-label="编辑 AI"><Pencil className="w-4 h-4" /></button> : <button onClick={() => openEditAgent(a)} className="fc-pressable flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 sm:h-8 sm:w-8" title="查看 AI" aria-label="查看 AI"><Eye className="w-4 h-4" /></button>}
                {mode === 'contacts' && a.canEdit !== false && a.canDelete !== false && <button onClick={() => deleteAgentFromContacts(a)} className="fc-pressable flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-500 hover:bg-red-100 sm:h-8 sm:w-8" title="删除 Agent" aria-label="删除 Agent"><Trash2 className="w-4 h-4" /></button>}
                {mode === 'contacts' && a.isOwner && !a.builtInKey && !a.managedByClient && !a.clientBindPending && <button onClick={() => requestClientBind(a)} className="fc-pressable flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600 hover:bg-amber-100 sm:h-8 sm:w-8" title="由在线客户端接管" aria-label="由在线客户端接管"><PlayCircle className="w-4 h-4" /></button>}
                {mode === 'contacts' && a.isOwner && !a.builtInKey && <button onClick={() => toggleListAgent(a)} className={`fc-pressable flex h-10 w-10 items-center justify-center rounded-xl sm:h-8 sm:w-8 ${a.marketListed ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`} title={a.marketListed ? '取消上架' : '上架市场'} aria-label={a.marketListed ? '取消上架' : '上架市场'}><Store className="w-4 h-4" /></button>}
                {!a.isOwner && !a.builtInKey && <button onClick={() => toggleFollowAgent(a)} className={`fc-pressable flex h-10 w-10 items-center justify-center rounded-xl sm:h-8 sm:w-8 ${a.isFollowing ? 'bg-rose-50 text-rose-500 hover:bg-rose-100' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`} title={a.isFollowing ? '取消关注' : '关注'} aria-label={a.isFollowing ? '取消关注' : '关注'}><Heart className={`w-4 h-4 ${a.isFollowing ? 'fill-current' : ''}`} /></button>}
              </div>
            </div>
          </div>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

export function SceneContacts({ mode = 'contacts', scenes, agents, reloadScenes }: { mode?: 'contacts' | 'market'; scenes: any[]; agents: any[]; reloadScenes: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<{ name: string; description: string; agents: any[] }>({ name: '', description: '', agents: [] })
  const [selectedGlobalAgentId, setSelectedGlobalAgentId] = useState('')
  const [saving, setSaving] = useState(false)
  const [billingForm, setBillingForm] = useState({ billingMode: 'free', fixedCreditsPerPurchase: 0 })

  const beginNew = () => {
    setEditingId('new')
    setForm({ name: '新场景', description: '', agents: [] })
    setSelectedGlobalAgentId('')
  }

  const beginEdit = (scene: any) => {
    if (scene.canEdit === false) return
    setEditingId(scene.id)
    setForm({ name: scene.name || '', description: scene.description || '', agents: (scene.agents || []).map((agent: any) => ({ ...agent })) })
    setBillingForm({ billingMode: scene.billingRule?.billingMode || (scene.priceSummary?.includes('买断') ? 'fixed' : 'free'), fixedCreditsPerPurchase: scene.billingRule?.fixedCreditsPerPurchase || 0 })
    setSelectedGlobalAgentId(scene.agents?.[0]?.agentId || '')
  }

  const purchaseScene = async (scene: any) => {
    const ok = window.confirm(`确认购买场景「${scene.name}」？价格：${scene.priceSummary || '以结算为准'}。`)
    if (!ok) return
    await api.purchaseScene(scene.id, true)
    reloadScenes()
  }

  const toggleListScene = async (scene: any) => {
    await api.updateScene(scene.id, { marketListed: !scene.marketListed })
    reloadScenes()
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
      else { await api.updateScene(editingId, { name: form.name.trim(), description: form.description, agents: form.agents }); await api.upsertSceneBillingRule(editingId, billingForm) }
      setEditingId(null)
      setSelectedGlobalAgentId('')
      reloadScenes()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {mode === 'contacts' ? <ContactCreateHeader title="场景" description="管理自己创建或已购买的场景模板；上架后才会出现在别人的市场。" buttonLabel="新增场景" onCreate={beginNew} /> : <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-emerald-800"><p className="font-semibold text-emerald-900">场景市场</p><p className="mt-0.5">这里只能购买已上架场景；新增和编辑请到通讯录。</p></div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(scenes.length === 0 && editingId !== 'new') ? <p className="text-sm text-gray-400">暂无场景。</p> : (editingId === 'new' ? [{ id: 'new', name: '新场景', description: '', agents: [], canEdit: true }, ...scenes] : scenes).map((scene) => {
          const editing = editingId === scene.id
          return (
            <div key={scene.id} className={`p-4 rounded-2xl border bg-white shadow-sm ${editing ? 'sm:col-span-2 border-blue-200 ring-2 ring-blue-50' : 'border-gray-100'}`}>
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
                      {editingId !== 'new' && <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 space-y-2"><p className="text-sm font-medium text-gray-700">场景买断价</p><p className="text-xs text-gray-500">场景只收一次买断费；后续运行按场景内 AI / 模型继续计费。</p><div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><select value={billingForm.billingMode} onChange={(e) => setBillingForm({ ...billingForm, billingMode: e.target.value })} className="px-3 py-2 border rounded-lg text-sm"><option value="free">免费</option><option value="fixed">一次性买断</option></select><input type="number" step="0.0001" value={billingForm.fixedCreditsPerPurchase} onChange={(e) => setBillingForm({ ...billingForm, fixedCreditsPerPurchase: Number(e.target.value) })} className="px-3 py-2 border rounded-lg text-sm" placeholder="credits 买断" /></div></div>}
                      {editingId !== 'new' && <TemplatePermissionPanel targetType="scene" targetId={scene.id} canEdit={scene.canEdit !== false} feedback={{ error: alert, success: () => {} }} />}
                      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-3">
                        <div className="flex items-center justify-between"><div><p className="text-sm font-medium text-gray-700">全局 Agent</p><p className="text-xs text-gray-400">选择场景包含的全局 Agent，并可直接配置模板；第一个默认作为协调者。</p></div><button onClick={() => { const first = agents.find((item) => !form.agents.some((a) => a.agentId === item.id)); setForm({ ...form, agents: [...form.agents, { agentId: first?.id || '', name: first?.name || '', autoEnabled: form.agents.length === 0, priority: form.agents.length }] }); if (first?.id) setSelectedGlobalAgentId(first.id) }} className="px-2.5 py-1.5 rounded-lg bg-blue-50 text-xs text-blue-600 hover:bg-blue-100">+ 添加</button></div>
                        {form.agents.length === 0 && <p className="text-xs text-gray-400 bg-white border border-dashed border-gray-200 rounded-lg p-3">还没有默认 Agent。</p>}
                        {form.agents.map((agent, index) => {
                          return <div key={index} className="bg-white border border-gray-100 rounded-xl p-3 space-y-2"><div className="grid grid-cols-1 sm:grid-cols-[1fr_110px_90px] gap-2"><select value={agent.agentId || ''} onChange={(e) => { const selected = agents.find((item) => item.id === e.target.value); setForm({ ...form, agents: form.agents.map((item, i) => i === index ? { ...item, agentId: e.target.value, name: selected?.name || item.name } : item) }); setSelectedGlobalAgentId(e.target.value) }} className="w-full px-2 py-2 border rounded-lg text-xs text-gray-700"><option value="">选择全局 Agent</option>{agents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><label className="text-xs flex items-center gap-1 h-9"><input type="checkbox" checked={!!agent.autoEnabled} onChange={(e) => setForm({ ...form, agents: form.agents.map((item, i) => i === index ? { ...item, autoEnabled: e.target.checked } : { ...item, autoEnabled: e.target.checked ? false : item.autoEnabled }) })} />协调者</label><div className="flex items-center justify-end gap-2"><button onClick={() => setSelectedGlobalAgentId(agent.agentId)} className="text-xs text-blue-600">配置</button><button onClick={() => setForm({ ...form, agents: form.agents.filter((_, i) => i !== index) })} className="text-xs text-red-500">删除</button></div></div></div>
                        })}
                      </div>
                      {selectedGlobalAgentId && <div className="rounded-xl border border-blue-100 bg-blue-50/20 p-3"><AgentConfigEditor agentId={selectedGlobalAgentId} feedback={{ error: alert, success: () => {} }} scopeLabel="全局 Agent 模板配置：通讯录和场景共用，影响后续克隆到新群聊的 Agent。" onSaved={reloadScenes} /></div>}
                      <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-2 border-t border-gray-100">
                        <button onClick={() => { setEditingId(null); setSelectedGlobalAgentId('') }} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm">取消</button>
                        <button onClick={saveScene} disabled={saving || !form.name.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-60">{saving ? '保存中...' : editingId === 'new' ? '创建场景' : '保存场景'}</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-semibold text-gray-800">{scene.name}{scene.isBuiltIn && <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">内置</span>}{scene.marketListed && <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">已上架</span>}{scene.canEdit === false && <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">只读</span>}</p>{scene.description && <p className="text-xs text-gray-500 mt-1">{scene.description}</p>}<p className="text-xs text-gray-400 mt-1">发布人：{scene.ownerName || scene.ownerId || '未知'}</p><p className="text-xs text-blue-600 mt-1">价格：{scene.priceSummary || '暂无定价'}<span className="text-gray-400"> · 后续按 AI/模型计费</span></p></div><div className="flex w-full flex-row flex-wrap gap-2 border-t border-gray-100 pt-3 sm:w-auto sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">{mode === 'contacts' && scene.canEdit !== false && <button onClick={() => beginEdit(scene)} className="flex min-h-10 flex-1 items-center justify-center rounded-xl bg-blue-50 px-4 py-2 text-sm font-medium text-blue-600 active:scale-[0.98] sm:min-h-0 sm:flex-none sm:bg-transparent sm:p-1"><Pencil className="w-4 h-4" /><span className="ml-1 sm:hidden">编辑</span></button>}{mode === 'contacts' && scene.canEdit !== false && !scene.isBuiltIn && <button onClick={() => toggleListScene(scene)} className={`flex min-h-10 flex-1 items-center justify-center rounded-xl px-4 py-2 text-sm font-medium active:scale-[0.98] sm:min-h-0 sm:flex-none sm:rounded-lg sm:px-2 sm:py-1 sm:text-[10px] ${scene.marketListed ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-600'}`}>{scene.marketListed ? '已上架' : '上架'}</button>}{!scene.canUse && <button onClick={() => purchaseScene(scene)} className="flex min-h-10 flex-1 items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm active:scale-[0.98] sm:min-h-0 sm:flex-none sm:rounded-lg sm:bg-emerald-50 sm:px-3 sm:py-1.5 sm:text-xs sm:text-emerald-600 sm:shadow-none">购买</button>}{scene.canUse && !scene.canEdit && <span className="flex min-h-10 flex-1 items-center justify-center rounded-xl bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-600 sm:min-h-0 sm:flex-none sm:rounded-full sm:px-2 sm:py-1 sm:text-[10px]">已拥有</span>}</div></div>
                      <div className="mt-3 flex flex-wrap gap-1">{(scene.agents || []).map((agent: any) => <span key={agent.agentId} className="text-[10px] px-2 py-1 rounded-full bg-violet-50 text-violet-600">{agent.name}{agent.autoEnabled ? ' · 协调者' : ''}</span>)}</div>
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
