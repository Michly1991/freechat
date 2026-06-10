import { Bot, Pencil, Plus, Trash2 } from 'lucide-react'
import { AGENT_TOOL_KEYS } from '../home-agent-form'
import type { ContactsSectionProps } from './types'

export function ContactsSection(props: ContactsSectionProps) {
  const {
    contactKind,
    setContactKind,
    searchQ,
    setSearchQ,
    searchResults,
    friends,
    agents,
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
        {contactKind === 'agents' && (
          <button onClick={() => showCreateAgent && !editingAgentId ? resetAgentEditor() : openCreateAgent()} className="inline-flex items-center gap-1 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700">
            <Plus className="w-4 h-4" /> 新建 Agent
          </button>
        )}
      </div>
      <div className="flex bg-gray-100 rounded-xl p-1 mb-4 w-fit">
        <button onClick={() => setContactKind('people')} className={`px-4 py-2 rounded-lg text-sm ${contactKind === 'people' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>人员</button>
        <button onClick={() => setContactKind('agents')} className={`px-4 py-2 rounded-lg text-sm ${contactKind === 'agents' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>Agent</button>
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
          openEditAgent={openEditAgent}
          deleteAgentFromContacts={deleteAgentFromContacts}
        />
      )}
    </section>
  )
}

type PeopleProps = Pick<ContactsSectionProps,
  'searchQ' | 'setSearchQ' | 'searchResults' | 'friends' | 'friendRequests' | 'searchUsers' |
  'sendFriendRequest' | 'acceptFriendRequest' | 'rejectFriendRequest' | 'openDm'
>

function PeopleContacts({ searchQ, setSearchQ, searchResults, friends, friendRequests, searchUsers, sendFriendRequest, acceptFriendRequest, rejectFriendRequest, openDm }: PeopleProps) {
  return (
    <>
      <div className="flex gap-2 mb-3">
        <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchUsers()} placeholder="搜索用户名/昵称添加好友" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        <button onClick={searchUsers} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">搜索</button>
      </div>
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
    </>
  )
}

type AgentProps = Pick<ContactsSectionProps,
  'agents' | 'showCreateAgent' | 'editingAgentId' | 'agentForm' | 'setAgentForm' | 'toggleAgentTool' |
  'createAgentFromContacts' | 'resetAgentEditor' | 'openEditAgent' | 'deleteAgentFromContacts'
>

function AgentContacts({ agents, showCreateAgent, editingAgentId, agentForm, setAgentForm, toggleAgentTool, createAgentFromContacts, resetAgentEditor, openEditAgent, deleteAgentFromContacts }: AgentProps) {
  return (
    <div className="space-y-4">
      {showCreateAgent && (
        <div className="p-4 border border-blue-100 bg-blue-50/50 rounded-xl space-y-3">
          <div className="text-sm font-semibold text-gray-700">{editingAgentId ? '编辑 Agent' : '新建 Agent'}</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <input value={agentForm.name} onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })} className="px-3 py-2 border border-gray-300 rounded text-sm" placeholder="Agent 名称，例如：需求分析师" />
            <select value={agentForm.roleType} onChange={(e) => setAgentForm({ ...agentForm, roleType: e.target.value as any })} className="px-3 py-2 border border-gray-300 rounded text-sm"><option value="assistant">业务助理</option><option value="specialist">业务专家</option></select>
          </div>
          <input value={agentForm.description} onChange={(e) => setAgentForm({ ...agentForm, description: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="职责描述" />
          <input value={agentForm.specialties} onChange={(e) => setAgentForm({ ...agentForm, specialties: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="专长，逗号分隔" />
          <textarea value={agentForm.systemPrompt} onChange={(e) => setAgentForm({ ...agentForm, systemPrompt: e.target.value })} rows={4} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="系统提示词" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
            {AGENT_TOOL_KEYS.map((key) => <label key={key} className="flex items-center gap-2 bg-white border border-gray-200 rounded px-3 py-2"><input type="checkbox" checked={agentForm.tools[key]} onChange={() => toggleAgentTool(key)} />{key}</label>)}
          </div>
          <div className="flex gap-2"><button onClick={createAgentFromContacts} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">{editingAgentId ? '保存修改' : '保存 Agent'}</button><button onClick={resetAgentEditor} className="bg-gray-100 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-200">取消</button></div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {agents.length === 0 ? <p className="text-sm text-gray-400">暂无 Agent，点击右上角新建一个。</p> : agents.map((a) => (
          <div key={a.id} className="p-3 rounded-xl border border-gray-100 flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-blue-500 text-white flex items-center justify-center shrink-0"><Bot className="w-5 h-5" /></span>
              <div className="min-w-0"><div className="flex items-center gap-2"><p className="text-sm font-medium truncate">{a.name}</p><span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-600">{a.roleType === 'assistant' ? '助理' : '专家'}</span></div>{a.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{a.description}</p>}{a.specialties?.length > 0 && <p className="text-xs text-gray-400 mt-1 truncate">{a.specialties.join('、')}</p>}</div>
            </div>
            <div className="flex items-center gap-1 shrink-0"><button onClick={() => openEditAgent(a)} className="text-blue-500 hover:text-blue-700 p-1" title="编辑 Agent"><Pencil className="w-4 h-4" /></button><button onClick={() => deleteAgentFromContacts(a)} className="text-red-400 hover:text-red-600 p-1" title="删除 Agent"><Trash2 className="w-4 h-4" /></button></div>
          </div>
        ))}
      </div>
    </div>
  )
}
