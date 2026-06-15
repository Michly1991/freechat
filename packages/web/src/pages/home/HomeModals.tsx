import type { AddFriendModalProps, CreateRoomModalProps, JoinRoomModalProps } from './types'

export function JoinRoomModal({ show, inviteCode, joining, setInviteCode, setShowJoin, handleJoinRoom }: JoinRoomModalProps) {
  if (!show) return null
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-xl p-4 sm:p-6 w-full max-w-md max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">加入项目</h3>
        <form onSubmit={handleJoinRoom} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">邀请码</label>
            <input type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="输入别人发给你的邀请码" autoFocus required />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setShowJoin(false); setInviteCode('') }} className="px-4 py-2 text-gray-600 hover:text-gray-800">取消</button>
            <button type="submit" disabled={joining} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">{joining ? '加入中...' : '加入'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function AddFriendModal({ show, searchQ, searchResults, setSearchQ, setShowAddFriend, searchUsers, sendFriendRequest }: AddFriendModalProps) {
  if (!show) return null
  const close = () => setShowAddFriend(false)
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-xl p-4 sm:p-6 w-full max-w-md max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-1">添加好友</h3>
        <p className="text-sm text-gray-500 mb-4">搜索用户名或昵称，向对方发送好友申请。</p>
        <div className="flex gap-2">
          <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchUsers()} placeholder="输入用户名/昵称" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" autoFocus />
          <button onClick={searchUsers} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">搜索</button>
        </div>
        <div className="mt-4 space-y-2">
          {searchResults.length === 0 ? <p className="text-sm text-gray-400 text-center py-6">输入关键词后搜索用户</p> : searchResults.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-3 p-3 border border-gray-100 rounded-xl">
              <div className="flex items-center gap-3 min-w-0">
                {u.avatar ? <img src={u.avatar} className="w-9 h-9 rounded-full object-cover" /> : <span className="w-9 h-9 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm">{(u.nickname || u.username || '?')[0].toUpperCase()}</span>}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{u.nickname || u.username}</p>
                  <p className="text-xs text-gray-400 truncate">@{u.username}</p>
                </div>
              </div>
              {u.friendStatus === 'none' && <button onClick={() => sendFriendRequest(u.id)} className="text-sm text-blue-600 hover:text-blue-700 shrink-0">加好友</button>}
              {u.friendStatus === 'friends' && <span className="text-xs text-green-600 shrink-0">已是好友</span>}
              {u.friendStatus === 'pending_sent' && <span className="text-xs text-gray-400 shrink-0">已申请</span>}
              {u.friendStatus === 'pending_received' && <span className="text-xs text-orange-500 shrink-0">待你处理</span>}
              {u.friendStatus === 'self' && <span className="text-xs text-gray-400 shrink-0">自己</span>}
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-5">
          <button type="button" onClick={close} className="px-4 py-2 text-gray-600 hover:text-gray-800">关闭</button>
        </div>
      </div>
    </div>
  )
}

export function CreateRoomModal(props: CreateRoomModalProps) {
  const {
    show,
    newName,
    newDesc,
    friends,
    agents,
    scenes,
    selectedSceneId,
    setSelectedSceneId,
    selectedFriendIds,
    selectedAgents,
    setNewName,
    setNewDesc,
    setShowCreate,
    setSelectedAgents,
    handleCreate,
    toggleSelectedFriend,
    toggleSelectedAgent,
    setAgentAutoEnabled,
  } = props
  if (!show) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-xl p-4 sm:p-6 w-full max-w-md max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">新建项目</h3>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">项目名称</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="输入项目名称" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">描述（可选）</label>
            <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="项目描述" rows={3} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">项目场景（可选）</label>
            <select value={selectedSceneId} onChange={(e) => {
              const nextSceneId = e.target.value
              setSelectedSceneId(nextSceneId)
              const scene = scenes.find((item) => item.id === nextSceneId)
              if (scene?.agents?.length) {
                setSelectedAgents(scene.agents.map((agent: any) => ({ agentId: agent.agentId, autoEnabled: !!agent.autoEnabled })))
              } else if (!nextSceneId) {
                setSelectedAgents([])
              }
            }} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
              <option value="">空白项目</option>
              {scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
            </select>
            {selectedSceneId && <p className="text-xs text-gray-500 mt-1">场景会把默认 Agent、页面和初始内容克隆到项目；后续修改不会影响外部模板。</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">选择协作者（可选）</label>
            <CollaboratorPicker
              friends={friends}
              agents={agents}
              selectedFriendIds={selectedFriendIds}
              selectedAgents={selectedAgents}
              toggleSelectedFriend={toggleSelectedFriend}
              toggleSelectedAgent={toggleSelectedAgent}
              setAgentAutoEnabled={setAgentAutoEnabled}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setShowCreate(false); setSelectedAgents([]) }} className="px-4 py-2 text-gray-600 hover:text-gray-800">取消</button>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">创建</button>
          </div>
        </form>
      </div>
    </div>
  )
}

type CollaboratorPickerProps = Pick<CreateRoomModalProps,
  'friends' | 'agents' | 'selectedFriendIds' | 'selectedAgents' | 'toggleSelectedFriend' | 'toggleSelectedAgent' | 'setAgentAutoEnabled'
>

function CollaboratorPicker({ friends, agents, selectedFriendIds, selectedAgents, toggleSelectedFriend, toggleSelectedAgent, setAgentAutoEnabled }: CollaboratorPickerProps) {
  return (
    <>
      {friends.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-gray-500 mb-1">人员</p>
          <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
            {friends.map((f) => (
              <label key={f.id} className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer text-sm">
                <input type="checkbox" checked={selectedFriendIds.includes(f.id)} onChange={() => toggleSelectedFriend(f.id)} />
                {f.avatar ? <img src={f.avatar} className="w-6 h-6 rounded-full object-cover" /> : <span className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs">{(f.nickname || f.username || '?')[0].toUpperCase()}</span>}
                <span>{f.nickname || f.username}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {agents.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-1">Agent</p>
          <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
            {agents.map((a) => {
              const selected = selectedAgents.find((item) => item.agentId === a.id)
              return (
                <div key={a.id} className="flex items-center justify-between gap-2 p-2 rounded hover:bg-gray-50 text-sm">
                  <label className="flex items-center gap-2 min-w-0 cursor-pointer flex-1">
                    <input type="checkbox" checked={!!selected} onChange={() => toggleSelectedAgent(a.id)} />
                    <span className="truncate">{a.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 shrink-0">{a.roleType === 'assistant' ? '助理' : '专家'}</span>
                  </label>
                  {selected && <select value={selected.autoEnabled ? 'auto' : 'specialist'} onChange={(e) => setAgentAutoEnabled(a.id, e.target.value === 'auto')} className="text-xs border border-gray-200 rounded px-2 py-1"><option value="specialist">专家</option><option value="auto">自动助理</option></select>}
                </div>
              )
            })}
          </div>
          {selectedAgents.filter((a) => a.autoEnabled).length > 1 && <p className="text-xs text-orange-500 mt-1">只会启用第一个自动助理，其他会自动作为专家加入。</p>}
        </div>
      )}
      {friends.length === 0 && agents.length === 0 && <p className="text-sm text-gray-400">通讯录暂无可选协作者。</p>}
    </>
  )
}
