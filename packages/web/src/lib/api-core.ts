import { addClientLog } from './clientLog'

const API_BASE = '/api'

async function buildHeaders(options?: RequestInit): Promise<Record<string, string>> {
  const token = localStorage.getItem('auth-storage')
    ? JSON.parse(localStorage.getItem('auth-storage')!).state.token
    : null

  const isFormData = options?.body instanceof FormData
  const hasBody = options?.body !== undefined && options?.body !== null
  return {
    ...(hasBody && !isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('auth-storage')
    ? JSON.parse(localStorage.getItem('auth-storage')!).state.token
    : null

  const headers = await buildHeaders(options)

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

async function requestText(url: string, options?: RequestInit): Promise<string> {
  const headers = await buildHeaders(options)
  const method = options?.method || 'GET'
  const startedAt = Date.now()
  addClientLog('info', 'api', `${method} ${url} start`, { responseType: 'text' })
  const res = await fetch(`${API_BASE}${url}`, { ...options, headers: { ...headers, ...options?.headers } })
  const text = await res.text()
  const elapsed = Date.now() - startedAt
  addClientLog(res.ok ? 'info' : 'error', 'api', `${method} ${url} ${res.status}`, { elapsed })
  if (!res.ok) throw new Error(text || `请求失败 (${res.status})`)
  return text
}

export { request, requestText }
