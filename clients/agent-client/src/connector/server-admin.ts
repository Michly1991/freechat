import type { ClientConfig } from '../config/types.js'
import { request } from './api.js'

export async function testServer(serverUrl: string) {
  return request<any>(serverUrl.replace(/\/+$/, ''), '/api/health')
}

export async function loginServer(serverUrl: string, username: string, password: string) {
  return request<any>(serverUrl.replace(/\/+$/, ''), '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export async function getServerMe(cfg: ClientConfig) {
  if (!cfg.serverAuthToken) throw new Error('请先登录 FreeChat Server')
  return request<any>(cfg.serverUrl, '/api/auth/me', {}, cfg.serverAuthToken)
}

export async function listServerAgents(cfg: ClientConfig) {
  if (!cfg.serverAuthToken) throw new Error('请先登录 FreeChat Server')
  const data = await request<{ agents: any[] }>(cfg.serverUrl, '/api/agents', {}, cfg.serverAuthToken)
  return data.agents || []
}

export async function createServerAgent(cfg: ClientConfig, body: any) {
  if (!cfg.serverAuthToken) throw new Error('请先登录 FreeChat Server')
  return request<any>(cfg.serverUrl, '/api/agents', {
    method: 'POST',
    body: JSON.stringify(body),
  }, cfg.serverAuthToken)
}

export async function updateServerAgent(cfg: ClientConfig, agentId: string, body: any) {
  if (!cfg.serverAuthToken) throw new Error('请先登录 FreeChat Server')
  return request<any>(cfg.serverUrl, `/api/agents/${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }, cfg.serverAuthToken)
}

export async function createPairingCode(cfg: ClientConfig, agentId: string) {
  if (!cfg.serverAuthToken) throw new Error('请先登录 FreeChat Server')
  return request<any>(cfg.serverUrl, `/api/agents/${encodeURIComponent(agentId)}/connectors/pairing-code`, {
    method: 'POST',
    body: JSON.stringify({}),
  }, cfg.serverAuthToken)
}

export async function listManagedRooms(cfg: ClientConfig) {
  if (!cfg.serverAuthToken) throw new Error('请先登录 FreeChat Server')
  const data = await request<{ rooms: any[] }>(cfg.serverUrl, '/api/managed-agent-rooms?limit=50', {}, cfg.serverAuthToken)
  return data.rooms || []
}
