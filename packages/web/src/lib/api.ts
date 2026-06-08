import { addClientLog } from './clientLog'

const API_BASE = '/api'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('auth-storage')
    ? JSON.parse(localStorage.getItem('auth-storage')!).state.token
    : null

  const isFormData = options?.body instanceof FormData
  const hasBody = options?.body !== undefined && options?.body !== null
  const headers: Record<string, string> = {
    ...(hasBody && !isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  const method = options?.method || 'GET'
  const startedAt = Date.now()
  addClientLog('info', 'api', `${method} ${url} start`, { token: token ? 'present' : 'missing' })

  let res: Response
  try {
    res = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers: { ...headers, ...options?.headers },
    })
  } catch (err: any) {
    addClientLog('error', 'api', `${method} ${url} network error`, { message: err?.message })
    throw err
  }

  let data: any = null
  try {
    data = await res.json()
  } catch (err: any) {
    addClientLog('error', 'api', `${method} ${url} invalid json`, { status: res.status, message: err?.message })
    throw err
  }

  const elapsed = Date.now() - startedAt
  addClientLog(res.ok ? 'info' : 'error', 'api', `${method} ${url} ${res.status}`, { elapsed, error: data?.error?.message || data?.error })
  if (!res.ok) {
    throw new Error(data.error?.message || `请求失败 (${res.status})`)
  }
  return data.data || data
}

export const api = {
  // Auth
  register: (body: { username: string; password: string; nickname: string }) =>
    request<{ user: any; token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  login: (body: { username: string; password: string }) =>
    request<{ user: any; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getMe: () => request<any>('/auth/me'),
  updateUserProfile: (body: { nickname?: string; avatar?: string }) =>
    request<any>('/user/profile', { method: 'PATCH', body: JSON.stringify(body) }),
  uploadAvatar: (file: File) => {
    const formData = new FormData()
    formData.append('avatar', file)
    return request<{ user: any; avatar: string }>('/user/avatar', { method: 'POST', body: formData })
  },
  changePassword: (body: { old_password: string; new_password: string }) =>
    request('/user/password', { method: 'POST', body: JSON.stringify(body) }),

  // Rooms
  getRooms: () => request<{ rooms: any[] }>('/rooms'),
  createRoom: (body: { name: string; description?: string; memberIds?: string[] }) =>
    request<{ room: any }>('/rooms', { method: 'POST', body: JSON.stringify(body) }),
  getRoom: (id: string) => request<{ room: any; members: any[] }>(`/rooms/${id}`),
  getRoomMessages: (id: string, limit = 100) => request<{ messages: any[] }>(`/rooms/${id}/messages?limit=${limit}`),
  sendRoomMessage: (id: string, body: { content: string; mentions?: any[]; reply_to?: string }) =>
    request<{ message: any }>(`/rooms/${id}/messages`, { method: 'POST', body: JSON.stringify(body) }),
  updateRoom: (id: string, body: { name?: string; description?: string }) =>
    request(`/rooms/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRoom: (id: string) => request(`/rooms/${id}`, { method: 'DELETE' }),
  getMembers: (id: string) => request<{ members: any[] }>(`/rooms/${id}/members`),
  createInvite: (id: string, body?: { max_uses?: number; expires_in_days?: number }) =>
    request<{ code: string; url: string }>(`/rooms/${id}/invite-link`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  joinRoom: (invite_code: string) =>
    request<{ room: any; role: string }>('/rooms/join', {
      method: 'POST',
      body: JSON.stringify({ invite_code }),
    }),
  leaveRoom: (id: string) => request(`/rooms/${id}/leave`, { method: 'POST' }),

  // Files
  getFiles: (roomId: string) => request<{ files: any[] }>(`/rooms/${roomId}/files`),
  getFileContent: (roomId: string, path: string) =>
    request<{ content: string }>(`/rooms/${roomId}/files/${encodeURIComponent(path)}`),
  saveFile: (roomId: string, path: string, content: string) =>
    request(`/rooms/${roomId}/files/${encodeURIComponent(path)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
  deleteFile: (roomId: string, path: string) =>
    request(`/rooms/${roomId}/files/${encodeURIComponent(path)}`, { method: 'DELETE' }),
  uploadFile: (roomId: string, formData: FormData) =>
    request(`/rooms/${roomId}/upload`, {
      method: 'POST',
      body: formData,
      headers: {},
    }),
  mkdir: (roomId: string, path: string) =>
    request(`/rooms/${roomId}/files/mkdir`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  getTabConfig: (roomId: string, tabKey = 'files') =>
    request<{ tab: any }>(`/rooms/${roomId}/tab-config/${encodeURIComponent(tabKey)}`),
  addTabConfigFile: (roomId: string, path: string, tabKey = 'files') =>
    request<{ tab: any }>(`/rooms/${roomId}/tab-config/${encodeURIComponent(tabKey)}/files`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  removeTabConfigFile: (roomId: string, path: string, tabKey = 'files') =>
    request<{ tab: any }>(`/rooms/${roomId}/tab-config/${encodeURIComponent(tabKey)}/files`, {
      method: 'DELETE',
      body: JSON.stringify({ path }),
    }),

  // Tabs
  getTabs: (roomId: string) => request<{ tabs: any[] }>(`/rooms/${roomId}/tabs`),
  createTab: (roomId: string, body: { title: string; content?: string; icon?: string }) =>
    request(`/rooms/${roomId}/tabs`, { method: 'POST', body: JSON.stringify(body) }),
  updateTab: (roomId: string, tabId: string, body: { title?: string; content?: string; icon?: string }) =>
    request(`/rooms/${roomId}/tabs/${tabId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTab: (roomId: string, tabId: string) =>
    request(`/rooms/${roomId}/tabs/${tabId}`, { method: 'DELETE' }),

  // Agents
  getAgents: () => request<{ agents: any[] }>('/agents'),
  createAgent: (body: { name: string; roleType: string; deployment: string; description?: string; specialties?: string[]; config?: Record<string, any> }) =>
    request<{ agent: any; apiKey: string }>('/agents', { method: 'POST', body: JSON.stringify(body) }),
  updateAgent: (id: string, body: Record<string, any>) =>
    request(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAgent: (id: string) => request(`/agents/${id}`, { method: 'DELETE' }),
  getRoomAgents: (roomId: string) => request<{ agents: any[] }>(`/rooms/${roomId}/agents`),
  addRoomAgent: (roomId: string, agentId: string) =>
    request(`/rooms/${roomId}/agents`, { method: 'POST', body: JSON.stringify({ agentId }) }),
  removeRoomAgent: (roomId: string, agentId: string) =>
    request(`/rooms/${roomId}/agents/${agentId}`, { method: 'DELETE' }),
  invokeAgent: (roomId: string, agentId: string, message: string) =>
    request(`/rooms/${roomId}/agents/${agentId}/invoke`, { method: 'POST', body: JSON.stringify({ message }) }),
  searchMarket: (q?: string) => request<{ agents: any[] }>(`/agent-market/search${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  featuredMarket: () => request<{ agents: any[] }>('/agent-market/featured'),

  // Profiles
  getProfiles: (roomId: string) => request<{ profiles: any[] }>(`/rooms/${roomId}/profiles`),
  updateRoomProfile: (roomId: string, memberId: string, body: {
    displayName?: string
    roleDescription?: string
    avatar?: string
    customData?: Record<string, any>
  }) =>
    request(`/rooms/${roomId}/profiles/${memberId}`, { method: 'PUT', body: JSON.stringify(body) }),
  updateMemberProfile: (roomId: string, memberId: string, body: any) =>
    request(`/rooms/${roomId}/profiles/${memberId}`, { method: 'PUT', body: JSON.stringify(body) }),
  batchUpdateProfiles: (roomId: string, profiles: any[]) =>
    request(`/rooms/${roomId}/profiles/batch`, { method: 'POST', body: JSON.stringify({ profiles }) }),

  // Friends
  getFriends: () => request<{ friends: any[] }>('/friends'),
  getFriendRequests: () => request<{ received: any[]; sent: any[] }>('/friends/requests'),
  sendFriendRequest: (targetUserId: string, message?: string) =>
    request('/friends/requests', { method: 'POST', body: JSON.stringify({ targetUserId, message }) }),
  acceptFriendRequest: (requestId: string) => request(`/friends/requests/${requestId}/accept`, { method: 'POST' }),
  rejectFriendRequest: (requestId: string) => request(`/friends/requests/${requestId}/reject`, { method: 'POST' }),

  // Conversations
  getConversations: () => request<{ conversations: any[] }>('/conversations'),
  markConversationRead: (type: 'dm' | 'project', id: string) =>
    request('/conversations/read', { method: 'POST', body: JSON.stringify({ type, id }) }),
  updateConversationPrefs: (type: 'dm' | 'project', id: string, body: { pinned?: boolean; muted?: boolean }) =>
    request(`/conversations/${type}/${id}/prefs`, { method: 'PATCH', body: JSON.stringify(body) }),

  // DM
  openDm: (userId: string) => request<{ conversation: any }>('/dm/open', { method: 'POST', body: JSON.stringify({ userId }) }),
  getDm: (id: string) => request<{ conversation: any }>(`/dm/${id}`),
  getDmMessages: (id: string, limit = 100) => request<{ messages: any[] }>(`/dm/${id}/messages?limit=${limit}`),
  sendDmMessage: (id: string, content: string) =>
    request<{ message: any }>(`/dm/${id}/messages`, { method: 'POST', body: JSON.stringify({ content }) }),

  // Users
  getUser: (userId: string) => request<any>(`/users/${userId}`),
  searchUsers: (q: string) => request<{ users: any[] }>(`/users/search?q=${encodeURIComponent(q)}`),
}
