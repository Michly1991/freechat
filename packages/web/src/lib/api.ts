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
  register: (body: { username: string; password: string; nickname: string; identityType?: 'human' | 'agent' }) =>
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


  getVoiceConfigs: () => request<{ configs: any[] }>('/voice/configs'),
  createVoiceConfig: (body: any) => request<{ config: any }>('/voice/configs', { method: 'POST', body: JSON.stringify(body) }),
  getEditableVoiceConfig: (id: string) => request<{ config: any }>(`/voice/configs/${id}/edit`),
  updateVoiceConfig: (id: string, body: any) => request<{ config: any }>(`/voice/configs/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteVoiceConfig: (id: string) => request(`/voice/configs/${id}`, { method: 'DELETE' }),
  testVoiceConfig: (id: string) => request<any>(`/voice/configs/${id}/test`, { method: 'POST' }),
  transcribeVoice: (formData: FormData) => request<{ text: string; provider: string; durationMs?: number }>('/voice/transcribe', { method: 'POST', body: formData }),
  synthesizeVoice: (body: { text: string; roomId?: string; messageId?: string; providerConfigId?: string; voice?: string; format?: string }) => request<{ audioUrl: string; mimeType: string; provider: string; durationMs?: number }>('/voice/synthesize', { method: 'POST', body: JSON.stringify(body) }),

  // Rooms
  getRooms: () => request<{ rooms: any[] }>('/rooms'),
  createRoom: (body: { name: string; description?: string; sceneId?: string; workgroupId?: string; memberIds?: string[]; agents?: Array<{ agentId: string; roomRole?: 'assistant' | 'specialist'; autoEnabled?: boolean; priority?: number; confirmedPurchase?: boolean }> }) =>
    request<{ room: any }>('/rooms', { method: 'POST', body: JSON.stringify(body) }),
  getWorkgroups: () => request<{ workgroups: any[] }>('/workgroups'),
  createWorkgroup: (body: { name: string; description?: string }) => request<any>('/workgroups', { method: 'POST', body: JSON.stringify(body) }),
  getWorkgroup: (id: string) => request<any>(`/workgroups/${id}`),
  updateWorkgroup: (id: string, body: { name?: string; description?: string }) => request<any>(`/workgroups/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  updateWorkgroupMember: (id: string, userId: string, body: any) => request<any>(`/workgroups/${id}/members/${userId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeWorkgroupMember: (id: string, userId: string) => request<any>(`/workgroups/${id}/members/${userId}`, { method: 'DELETE' }),
  getWorkgroupAvailableAgents: (id: string) => request<{ agents: any[] }>(`/workgroups/${id}/available-agents`),
  addWorkgroupAgent: (id: string, body: any) => request<any>(`/workgroups/${id}/agents`, { method: 'POST', body: JSON.stringify(body) }),
  updateWorkgroupAgent: (id: string, agentId: string, body: any) => request<any>(`/workgroups/${id}/agents/${agentId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeWorkgroupAgent: (id: string, agentId: string) => request<any>(`/workgroups/${id}/agents/${agentId}`, { method: 'DELETE' }),
  getWorkgroupEntries: (id: string) => request<{ entries: any[] }>(`/workgroups/${id}/entries`),
  createWorkgroupEntry: (id: string, body: any) => request<{ entry: any }>(`/workgroups/${id}/entries`, { method: 'POST', body: JSON.stringify(body) }),
  updateWorkgroupEntry: (id: string, entryId: string, body: any) => request<{ entry: any }>(`/workgroups/${id}/entries/${entryId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteWorkgroupEntry: (id: string, entryId: string) => request<{ entries: any[] }>(`/workgroups/${id}/entries/${entryId}`, { method: 'DELETE' }),
  getWorkgroupEntry: (token: string) => request<{ entry: any }>(`/workgroup-entries/${token}`),
  joinWorkgroupEntry: (token: string) => request<{ entry: any; room: any }>(`/workgroup-entries/${token}/join`, { method: 'POST' }),
  addWorkgroupMember: (id: string, userId: string) => request<any>(`/workgroups/${id}/members`, { method: 'POST', body: JSON.stringify({ userId }) }),
  openDirectUserRoom: (userId: string) => request<{ room: any }>('/rooms/direct/user', { method: 'POST', body: JSON.stringify({ userId }) }),
  openDirectAgentRoom: (agentId: string) => request<{ room: any }>('/rooms/direct/agent', { method: 'POST', body: JSON.stringify({ agentId }) }),
  getRoom: (id: string) => request<{ room: any; members: any[] }>(`/rooms/${id}`),
  getRoomMessages: (id: string, limit = 100, before?: string) => request<{ messages: any[]; hasMore?: boolean }>(`/rooms/${id}/messages?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`),
  getRoomTasks: (id: string, status?: string) => request<{ tasks: any[] }>(`/rooms/${id}/tasks${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  createTask: (roomId: string, body: any) =>
    request<{ task: any }>(`/rooms/${roomId}/tasks`, { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (roomId: string, taskId: string, body: any) =>
    request<{ task: any }>(`/rooms/${roomId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTask: (roomId: string, taskId: string) => request(`/rooms/${roomId}/tasks/${taskId}`, { method: 'DELETE' }),
  retryTask: (roomId: string, taskId: string, reason?: string) =>
    request<{ task: any; wakeItems: any[] }>(`/rooms/${roomId}/tasks/${taskId}/retry`, { method: 'POST', body: JSON.stringify({ reason }) }),
  createSubtask: (roomId: string, taskId: string, body: any) =>
    request<{ subtask: any; task: any }>(`/rooms/${roomId}/tasks/${taskId}/subtasks`, { method: 'POST', body: JSON.stringify(body) }),
  updateSubtask: (roomId: string, taskId: string, itemId: string, body: any) =>
    request<{ subtask: any; task: any; released: any[] }>(`/rooms/${roomId}/tasks/${taskId}/subtasks/${itemId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteSubtask: (roomId: string, taskId: string, itemId: string) =>
    request<{ task: any }>(`/rooms/${roomId}/tasks/${taskId}/subtasks/${itemId}`, { method: 'DELETE' }),
  retrySubtask: (roomId: string, taskId: string, itemId: string, reason?: string) =>
    request<{ subtask: any; task: any; shouldWake: boolean }>(`/rooms/${roomId}/tasks/${taskId}/subtasks/${itemId}/retry`, { method: 'POST', body: JSON.stringify({ reason }) }),
  sendRoomMessage: (id: string, body: { content: string; mentions?: any[]; reply_to?: string }) =>
    request<{ message: any }>(`/rooms/${id}/messages`, { method: 'POST', body: JSON.stringify(body) }),
  sendRoomMessageWithFiles: (id: string, content: string, files: File[]) => {
    const form = new FormData()
    form.append('content', content)
    files.forEach((file) => form.append('files', file, file.name))
    return request<{ message: any }>(`/rooms/${id}/messages/with-files`, { method: 'POST', body: form })
  },
  updateRoom: (id: string, body: { name?: string; description?: string }) =>
    request(`/rooms/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRoom: (id: string) => request(`/rooms/${id}`, { method: 'DELETE' }),
  getMembers: (id: string) => request<{ members: any[] }>(`/rooms/${id}/members`),
  addRoomMember: (id: string, userId: string, role: 'owner' | 'editor' | 'viewer' = 'editor') =>
    request<{ members: any[] }>(`/rooms/${id}/members`, { method: 'POST', body: JSON.stringify({ userId, role }) }),
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
  getRoomAnalytics: (id: string, params?: { from?: number; to?: number }) => {
    const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : ''
    return request<any>(`/rooms/${id}/analytics${qs ? `?${qs}` : ''}`)
  },
  getRoomAnalyticsRuns: (id: string, params?: { agentId?: string; from?: number; to?: number; page?: number; pageSize?: number }) => {
    const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : ''
    return request<any>(`/rooms/${id}/analytics/runs${qs ? `?${qs}` : ''}`)
  },
  getRoomAnalyticsRunDetail: (id: string, runId: string) => request<any>(`/rooms/${id}/analytics/runs/${runId}`),
  getRoomBillingSummary: (id: string, params?: { from?: number; to?: number }) => {
    const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : ''
    return request<any>(`/rooms/${id}/billing/summary${qs ? `?${qs}` : ''}`)
  },
  getRoomBillingLedger: (id: string, params?: { from?: number; to?: number; limit?: number }) => {
    const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : ''
    return request<any>(`/rooms/${id}/billing/ledger${qs ? `?${qs}` : ''}`)
  },
  getPersonalAnalytics: (params?: { from?: number; to?: number; scope?: 'member' | 'owned' | 'triggered' }) => {
    const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : ''
    return request<any>(`/me/analytics${qs ? `?${qs}` : ''}`)
  },
  getPersonalAnalyticsRuns: (params?: { agentKey?: string; roomId?: string; from?: number; to?: number; scope?: 'member' | 'owned' | 'triggered'; page?: number; pageSize?: number }) => {
    const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : ''
    return request<any>(`/me/analytics/runs${qs ? `?${qs}` : ''}`)
  },
  getPersonalAnalyticsRunDetail: (runId: string) => request<any>(`/me/analytics/runs/${runId}`),
  getModelProfiles: () => request<{ profiles: any[] }>('/model-profiles'),
  createModelProfile: (body: any) => request<{ profile: any }>('/model-profiles', { method: 'POST', body: JSON.stringify(body) }),
  updateModelProfile: (id: string, body: any) => request<{ profile: any }>(`/model-profiles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getModelBillingRules: (profileId: string) => request<{ rules: any[] }>(`/model-profiles/${profileId}/billing-rules`),
  upsertModelBillingRule: (profileId: string, model: string, body: any) => request<{ rule: any }>(`/model-profiles/${profileId}/billing-rules/${encodeURIComponent(model)}`, { method: 'PUT', body: JSON.stringify(body) }),
  getAgentBillingRule: (agentId: string) => request<{ rule: any | null }>(`/agents/${agentId}/billing-rule`),
  upsertAgentBillingRule: (agentId: string, body: any) => request<{ rule: any }>(`/agents/${agentId}/billing-rule`, { method: 'PUT', body: JSON.stringify(body) }),
  getBillingAccount: () => request<any>('/billing/account'),
  refreshBillingAggregate: (body: { from?: number; to?: number } = {}) => request<any>('/billing/aggregate', { method: 'POST', body: JSON.stringify(body) }),
  getBillingLedger: (params?: { role?: 'payer' | 'agent_provider' | 'model_provider' | 'scene_provider'; from?: number; to?: number; limit?: number }) => {
    const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : ''
    return request<any>(`/billing/ledger${qs ? `?${qs}` : ''}`)
  },
  getBillingSummary: (params?: { role?: 'payer' | 'agent_provider' | 'model_provider' | 'scene_provider'; from?: number; to?: number }) => {
    const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : ''
    return request<any>(`/billing/summary${qs ? `?${qs}` : ''}`)
  },
  getAgentDreams: (roomId?: string) => request<any>(`/agent-dreams${roomId ? `?roomId=${encodeURIComponent(roomId)}` : ''}`),
  runAgentDreams: (body: { roomId?: string; agentId?: string; date?: string; dryRun?: boolean } = {}) => request<any>('/agent-dreams/run', { method: 'POST', body: JSON.stringify(body) }),
  getAgentGrowth: (roomId: string) => request<any>(`/rooms/${roomId}/agent-growth`),
  runAgentGrowth: (roomId: string, body: { date?: string } = {}) => request<any>(`/rooms/${roomId}/agent-growth/run`, { method: 'POST', body: JSON.stringify(body) }),
  acceptAgentGrowthProposal: (id: string) => request<any>(`/agent-growth/proposals/${id}/accept`, { method: 'POST' }),
  rejectAgentGrowthProposal: (id: string) => request<any>(`/agent-growth/proposals/${id}/reject`, { method: 'POST' }),
  deleteAgentGrowthMemory: (id: string) => request<any>(`/agent-growth/memories/${id}`, { method: 'DELETE' }),

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
  uploadFile: (roomId: string, fileOrForm: File | FormData, path = '') => {
    const formData = fileOrForm instanceof FormData ? fileOrForm : new FormData()
    if (!(fileOrForm instanceof FormData)) formData.append('file', fileOrForm)
    if (path) formData.append('path', path)
    return request<{ filename: string; path: string; size: number; mimeType?: string }>(`/rooms/${roomId}/files/upload`, {
      method: 'POST',
      body: formData,
      headers: {},
    })
  },
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
  getTabs: (roomId: string) => request<{ tabs: any[]; defaultTabId?: string | null }>(`/rooms/${roomId}/tabs`),
  createTab: (roomId: string, body: { title: string; content?: string; icon?: string; makeDefault?: boolean }) =>
    request(`/rooms/${roomId}/tabs`, { method: 'POST', body: JSON.stringify(body) }),
  updateTab: (roomId: string, tabId: string, body: { title?: string; content?: string; icon?: string }) =>
    request(`/rooms/${roomId}/tabs/${tabId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTab: (roomId: string, tabId: string) =>
    request(`/rooms/${roomId}/tabs/${tabId}`, { method: 'DELETE' }),
  setDefaultTab: (roomId: string, tabId: string) =>
    request(`/rooms/${roomId}/tabs/${tabId}/default`, { method: 'POST' }),
  reorderTabs: (roomId: string, tabIds: string[]) =>
    request(`/rooms/${roomId}/tabs/reorder`, { method: 'POST', body: JSON.stringify({ tabIds }) }),

  // Agents
  getScenes: () => request<{ scenes: any[] }>('/scenes'),
  createScene: (body: { name: string; description?: string; icon?: string; agents?: any[] }) =>
    request<{ scene: any }>('/scenes', { method: 'POST', body: JSON.stringify(body) }),
  updateScene: (id: string, body: { name?: string; description?: string; icon?: string; agents?: any[]; marketListed?: boolean }) =>
    request<{ scene: any }>(`/scenes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  upsertSceneBillingRule: (id: string, body: any) =>
    request<{ scene: any }>(`/scenes/${id}/billing-rule`, { method: 'PUT', body: JSON.stringify(body) }),
  purchaseScene: (id: string, confirmed = false) => request<{ scene: any; isPurchased: boolean; priceCredits: number }>(`/scenes/${id}/purchase`, { method: 'POST', body: JSON.stringify({ confirmed }) }),
  getScenePermissions: (id: string) => request<{ canManage: boolean; members: any[]; requests: any[] }>(`/scenes/${id}/permissions`),
  grantScenePermission: (id: string, userId: string, role = 'editor') =>
    request<{ members: any[] }>(`/scenes/${id}/permissions`, { method: 'POST', body: JSON.stringify({ userId, role }) }),
  revokeScenePermission: (id: string, userId: string) =>
    request<{ members: any[] }>(`/scenes/${id}/permissions/${userId}`, { method: 'DELETE' }),
  requestScenePermission: (id: string, message?: string) =>
    request<{ request: any }>(`/scenes/${id}/permission-requests`, { method: 'POST', body: JSON.stringify({ message, role: 'editor' }) }),
  resolveScenePermissionRequest: (id: string, requestId: string, decision: 'approve' | 'reject') =>
    request<{ request: any }>(`/scenes/${id}/permission-requests/${requestId}/resolve`, { method: 'POST', body: JSON.stringify({ decision }) }),
  getAgents: () => request<{ agents: any[] }>('/agents'),
  createAgent: (body: { name: string; deployment: string; description?: string; specialties?: string[]; config?: Record<string, any> }) =>
    request<{ agent: any; apiKey: string }>('/agents', { method: 'POST', body: JSON.stringify(body) }),
  uploadAgentPackage: (file: File) => {
    const formData = new FormData()
    formData.append('package', file)
    return request<{ agent: any; package: any; mode: string; listed: boolean }>('/agents/package/upload', { method: 'POST', body: formData })
  },
  updateAgent: (id: string, body: Record<string, any>) =>
    request(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  requestAgentClientBind: (id: string) =>
    request<{ request: any }>(`/agents/${id}/client-bind-request`, { method: 'POST', body: JSON.stringify({}) }),
  deleteAgent: (id: string) => request(`/agents/${id}`, { method: 'DELETE' }),
  getAgentDetail: (id: string) => request<{ agent: any; skills: any[]; scripts: any[] }>(`/agents/${id}/detail`),
  getAgentKnowledge: (id: string) => request<{ agentId: string; files: any[]; summary: any; canEdit: boolean; managedByClient?: boolean; client?: any }>(`/agents/${id}/knowledge`),
  getAgentKnowledgeFile: (id: string, fileId: string) => request<{ file: any; canEdit: boolean }>(`/agents/${id}/knowledge/files/${fileId}`),
  createAgentKnowledgeFile: (id: string, body: any) => request<{ file: any; knowledge: any }>(`/agents/${id}/knowledge/files`, { method: 'POST', body: JSON.stringify(body) }),
  updateAgentKnowledgeFile: (id: string, fileId: string, body: any) => request<{ file: any; knowledge: any }>(`/agents/${id}/knowledge/files/${fileId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAgentKnowledgeFile: (id: string, fileId: string) => request<{ knowledge: any }>(`/agents/${id}/knowledge/files/${fileId}`, { method: 'DELETE' }),
  reindexAgentKnowledge: (id: string) => request<{ agentId: string; files: any[]; summary: any }>(`/agents/${id}/knowledge/reindex`, { method: 'POST' }),
  getAgentPermissions: (id: string) => request<{ canManage: boolean; members: any[]; requests: any[] }>(`/agents/${id}/permissions`),
  grantAgentPermission: (id: string, userId: string, role = 'editor') =>
    request<{ members: any[] }>(`/agents/${id}/permissions`, { method: 'POST', body: JSON.stringify({ userId, role }) }),
  revokeAgentPermission: (id: string, userId: string) =>
    request<{ members: any[] }>(`/agents/${id}/permissions/${userId}`, { method: 'DELETE' }),
  requestAgentPermission: (id: string, message?: string) =>
    request<{ request: any }>(`/agents/${id}/permission-requests`, { method: 'POST', body: JSON.stringify({ message, role: 'editor' }) }),
  resolveAgentPermissionRequest: (id: string, requestId: string, decision: 'approve' | 'reject') =>
    request<{ request: any }>(`/agents/${id}/permission-requests/${requestId}/resolve`, { method: 'POST', body: JSON.stringify({ decision }) }),
  followMarketTarget: (targetType: 'agent' | 'model', targetId: string) =>
    request<{ targetType: string; targetId: string; isFollowing: boolean }>('/market/follows', { method: 'POST', body: JSON.stringify({ targetType, targetId }) }),
  unfollowMarketTarget: (targetType: 'agent' | 'model', targetId: string) =>
    request<{ targetType: string; targetId: string; isFollowing: boolean }>(`/market/follows/${targetType}/${targetId}`, { method: 'DELETE' }),
  createAgentSkill: (id: string, body: any) => request<{ skill: any }>(`/agents/${id}/skills`, { method: 'POST', body: JSON.stringify(body) }),
  updateAgentSkill: (id: string, skillId: string, body: any) => request<{ skill: any }>(`/agents/${id}/skills/${skillId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAgentSkill: (id: string, skillId: string) => request(`/agents/${id}/skills/${skillId}`, { method: 'DELETE' }),
  createAgentScript: (id: string, body: any) => request<{ script: any }>(`/agents/${id}/scripts`, { method: 'POST', body: JSON.stringify(body) }),
  updateAgentScript: (id: string, scriptId: string, body: any) => request<{ script: any }>(`/agents/${id}/scripts/${scriptId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAgentScript: (id: string, scriptId: string) => request(`/agents/${id}/scripts/${scriptId}`, { method: 'DELETE' }),
  getKnowledge: (params: Record<string, any> = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString()
    return request<{ entries: any[] }>(`/knowledge${qs ? `?${qs}` : ''}`)
  },
  createKnowledge: (body: any) => request<{ entry: any }>('/knowledge', { method: 'POST', body: JSON.stringify(body) }),
  updateKnowledge: (id: string, body: any) => request<{ entry: any }>(`/knowledge/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteKnowledge: (id: string) => request(`/knowledge/${id}`, { method: 'DELETE' }),
  getRoomAgents: (roomId: string) => request<{ agents: any[] }>(`/rooms/${roomId}/agents`),
  addRoomAgent: (roomId: string, agentId: string, options?: { roomRole?: 'assistant' | 'specialist'; autoEnabled?: boolean; priority?: number; confirmedPurchase?: boolean }) =>
    request(`/rooms/${roomId}/agents`, { method: 'POST', body: JSON.stringify({ agentId, ...(options || {}) }) }),
  removeRoomAgent: (roomId: string, agentId: string) =>
    request(`/rooms/${roomId}/agents/${agentId}`, { method: 'DELETE' }),
  handoffRoomAssistant: (roomId: string, agentId: string, reason?: string) =>
    request<{ room: any; agents: any[] }>(`/rooms/${roomId}/assistant/handoff`, { method: 'POST', body: JSON.stringify({ agentId, reason }) }),
  restartRoomAgent: (roomId: string, agentId: string, clearSession = true, mode: 'soft' | 'force' = 'soft') =>
    request<{ agent: any; pendingSubtasks: any[]; mode: 'soft' | 'force'; stoppedRuntime?: any }>(`/rooms/${roomId}/agents/${agentId}/restart`, { method: 'POST', body: JSON.stringify({ clearSession, mode }) }),
  updateRoomAgentModel: (roomId: string, agentId: string, body: any) =>
    request<{ agent: any }>(`/rooms/${roomId}/agents/${agentId}/model`, { method: 'PATCH', body: JSON.stringify(body) }),
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
  getNotifications: (params?: { limit?: number; unreadOnly?: boolean }) => {
    const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : ''
    return request<{ notifications: any[]; unreadCount: number }>(`/notifications${qs ? `?${qs}` : ''}`)
  },
  markNotificationsRead: (body: { ids?: string[]; all?: boolean }) =>
    request<{ notifications: any[]; unreadCount: number }>('/notifications/read', { method: 'POST', body: JSON.stringify(body) }),
  markConversationRead: (type: 'dm' | 'project', id: string) =>
    request('/conversations/read', { method: 'POST', body: JSON.stringify({ type, id }) }),
  updateConversationPrefs: (type: 'dm' | 'project', id: string, body: { pinned?: boolean; muted?: boolean; hidden?: boolean }) =>
    request(`/conversations/${type}/${id}/prefs`, { method: 'PATCH', body: JSON.stringify(body) }),

  // DM
  openDm: (userId: string) => request<{ conversation: any }>('/dm/open', { method: 'POST', body: JSON.stringify({ userId }) }),
  getDm: (id: string) => request<{ conversation: any }>(`/dm/${id}`),
  getDmMessages: (id: string, limit = 100) => request<{ messages: any[] }>(`/dm/${id}/messages?limit=${limit}`),
  sendDmMessage: (id: string, content: string) =>
    request<{ message: any }>(`/dm/${id}/messages`, { method: 'POST', body: JSON.stringify({ content }) }),

  // Interactions
  listInteractions: (roomId: string, params = 'status=pending&target=me') =>
    request<{ interactions: any[] }>(`/rooms/${roomId}/interactions?${params}`),
  createInteraction: (roomId: string, body: any) =>
    request<{ interaction: any; message: any }>(`/rooms/${roomId}/interactions`, { method: 'POST', body: JSON.stringify(body) }),
  getInteraction: (roomId: string, id: string) =>
    request<{ interaction: any }>(`/rooms/${roomId}/interactions/${id}`),
  respondInteraction: (roomId: string, id: string, value: string | string[], inputs?: Record<string, string>) =>
    request<{ interaction: any }>(`/rooms/${roomId}/interactions/${id}/respond`, { method: 'PATCH', body: JSON.stringify(Array.isArray(value) ? { values: value, inputs } : { value, inputs }) }),
  consumeInteraction: (roomId: string, id: string) =>
    request<{ interaction: any }>(`/rooms/${roomId}/interactions/${id}/consume`, { method: 'POST' }),
  cancelInteraction: (roomId: string, id: string) =>
    request<{ interaction: any }>(`/rooms/${roomId}/interactions/${id}/cancel`, { method: 'POST' }),

  // Users
  getUser: (userId: string) => request<any>(`/users/${userId}`),
  searchUsers: (q: string) => request<{ users: any[] }>(`/users/search?q=${encodeURIComponent(q)}`),
}
