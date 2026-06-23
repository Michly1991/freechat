import { useState } from 'react'
import type { AddFriendModalProps, CreateRoomModalProps, JoinRoomModalProps } from './types'

function IdentityBadge({ identityType }: { identityType?: string }) {
  const isAgent = identityType === 'agent'
  return <span className={`inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${isAgent ? 'bg-violet-50 text-violet-600' : 'bg-gray-100 text-gray-500'}`}>{isAgent ? 'Agent' : '真人'}</span>
}

export function JoinRoomModal({ show, inviteCode, joining, setInviteCode, setShowJoin, handleJoinRoom }: JoinRoomModalProps) {
  if (!show) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl sm:max-h-[85vh] sm:rounded-xl sm:p-6">
        <h3 className="text-lg font-semibold mb-4">加入群聊</h3>
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
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl sm:max-h-[85vh] sm:rounded-xl sm:p-6">
        <h3 className="text-lg font-semibold mb-1">添加好友</h3>
        <p className="text-sm text-gray-500 mb-4">搜索用户名或昵称，向对方发送好友申请。</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchUsers()} placeholder="输入用户名/昵称" className="min-h-11 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base sm:text-sm" autoFocus />
          <button onClick={searchUsers} className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 sm:min-h-0">搜索</button>
        </div>
        <div className="mt-4 space-y-2">
          {searchResults.length === 0 ? <p className="text-sm text-gray-400 text-center py-6">输入关键词后搜索用户</p> : searchResults.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-3 p-3 border border-gray-100 rounded-xl">
              <div className="flex items-center gap-3 min-w-0">
                {u.avatar ? <img src={u.avatar} className="w-9 h-9 rounded-full object-cover" /> : <span className="w-9 h-9 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm">{(u.nickname || u.username || '?')[0].toUpperCase()}</span>}
                <div className="min-w-0">
                  <p className="flex items-center gap-1 text-sm font-medium text-gray-800"><span className="truncate">{u.nickname || u.username}</span><IdentityBadge identityType={u.identityType} /></p>
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
        <div className="mt-5 flex justify-end">
          <button type="button" onClick={close} className="min-h-11 rounded-lg px-4 py-2 text-gray-600 hover:text-gray-800 sm:min-h-0">关闭</button>
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
    workgroups,
    selectedWorkgroupId,
    setSelectedWorkgroupId,
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex w-full max-w-md max-h-[calc(100dvh-1rem)] flex-col rounded-t-3xl bg-white shadow-xl sm:max-h-[85vh] sm:rounded-xl">
        <div className="shrink-0 border-b border-gray-100 p-4 sm:p-6 sm:pb-4">
          <h3 className="text-lg font-semibold text-gray-900">新建群聊</h3>
          <p className="mt-1 text-sm text-gray-500">创建一个归属于工作组的协作空间。</p>
        </div>
        <form onSubmit={handleCreate} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6 sm:pt-4">
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">基础信息</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">群聊名称</label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="输入群聊名称" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述（可选）</label>
                <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="群聊描述" rows={3} />
              </div>
            </section>
            <section className="space-y-3 rounded-2xl border border-gray-100 bg-gray-50/70 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">资源归属</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">工作组</label>
                <select value={selectedWorkgroupId} onChange={(e) => setSelectedWorkgroupId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                  <option value="">自动选择默认工作组</option>
                  {workgroups.map((workgroup) => <option key={workgroup.id} value={workgroup.id}>{workgroup.name}</option>)}
                </select>
                <p className="text-xs text-gray-500 mt-1">工作组是人和 Agent 的资源池。</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">场景模板（可选）</label>
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
                  <option value="">空白群聊</option>
                  {scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
                </select>
                {selectedSceneId && <p className="text-xs text-gray-500 mt-1">场景会克隆默认 Agent、页面和初始内容。</p>}
              </div>
            </section>
            <section>
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
            </section>
          </div>
          <div className="flex shrink-0 gap-2 border-t border-gray-100 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-end sm:p-4">
            <button type="button" onClick={() => { setShowCreate(false); setSelectedAgents([]) }} className="fc-pressable min-h-11 flex-1 rounded-xl bg-gray-100 px-4 py-2 text-gray-600 hover:text-gray-800 sm:flex-none">取消</button>
            <button type="submit" className="fc-pressable min-h-11 flex-1 rounded-xl bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 sm:flex-none">创建</button>
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
  const [activeKind, setActiveKind] = useState<'people' | 'agents'>(friends.length > 0 ? 'people' : 'agents')
  if (friends.length === 0 && agents.length === 0) return <p className="text-sm text-gray-400">通讯录暂无可选协作者。</p>

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-2">
      {friends.length > 0 && agents.length > 0 && (
        <div className="mb-2 grid grid-cols-2 rounded-xl bg-gray-100 p-1 text-sm">
          <button type="button" onClick={() => setActiveKind('people')} className={`rounded-lg px-3 py-2 ${activeKind === 'people' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>人员</button>
          <button type="button" onClick={() => setActiveKind('agents')} className={`rounded-lg px-3 py-2 ${activeKind === 'agents' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>Agent</button>
        </div>
      )}
      {friends.length > 0 && activeKind === 'people' && (
        <div className="max-h-[30dvh] overflow-y-auto space-y-1 pr-1">
          {friends.map((f) => (
            <label key={f.id} className="fc-pressable flex min-h-11 items-center gap-2 rounded-xl p-2 text-sm hover:bg-gray-50 cursor-pointer">
              <input type="checkbox" checked={selectedFriendIds.includes(f.id)} onChange={() => toggleSelectedFriend(f.id)} />
              {f.avatar ? <img src={f.avatar} className="w-7 h-7 rounded-full object-cover" /> : <span className="w-7 h-7 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs">{(f.nickname || f.username || '?')[0].toUpperCase()}</span>}
              <span className="truncate">{f.nickname || f.username}</span>
            </label>
          ))}
        </div>
      )}
      {agents.length > 0 && activeKind === 'agents' && (
        <div>
          <div className="max-h-[30dvh] overflow-y-auto space-y-1 pr-1">
            {agents.map((a) => {
              const selected = selectedAgents.find((item) => item.agentId === a.id)
              return (
                <div key={a.id} className="fc-pressable flex min-h-11 items-center justify-between gap-2 rounded-xl p-2 text-sm hover:bg-gray-50">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input type="checkbox" checked={!!selected} onChange={() => toggleSelectedAgent(a.id)} />
                    <span className="truncate">{a.name}</span>
                  </label>
                  {selected && <select value={selected.autoEnabled ? 'auto' : 'normal'} onChange={(e) => setAgentAutoEnabled(a.id, e.target.value === 'auto')} className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"><option value="normal">普通</option><option value="auto">房间助理</option></select>}
                </div>
              )
            })}
          </div>
          <p className="text-xs text-gray-500 mt-2 px-1">每个群聊只有一个房间助理；默认第一个选中的 Agent 作为房间助理。</p>
        </div>
      )}
    </div>
  )
}
