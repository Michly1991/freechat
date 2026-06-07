const API_BASE = '/api'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('auth-storage')
    ? JSON.parse(localStorage.getItem('auth-storage')!).state.token
    : null

  const isFormData = options?.body instanceof FormData
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  })

  const data = await res.json()
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
  updateProfile: (body: { nickname?: string; avatar?: string }) =>
    request<any>('/user/profile', { method: 'PATCH', body: JSON.stringify(body) }),
  changePassword: (body: { old_password: string; new_password: string }) =>
    request('/user/password', { method: 'POST', body: JSON.stringify(body) }),

  // Rooms
  getRooms: () => request<{ rooms: any[] }>('/rooms'),
  createRoom: (body: { name: string; description?: string }) =>
    request<{ room: any }>('/rooms', { method: 'POST', body: JSON.stringify(body) }),
  getRoom: (id: string) => request<{ room: any; members: any[] }>(`/rooms/${id}`),
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
  updateProfile: (roomId: string, memberId: string, body: {
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

  // Users
  getUser: (userId: string) => request<any>(`/users/${userId}`),
  searchUsers: (q: string) => request<{ users: any[] }>(`/users/search?q=${encodeURIComponent(q)}`),
}
