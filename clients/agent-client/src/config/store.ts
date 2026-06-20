import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { homedir, hostname } from 'os'
import { dirname, join, resolve } from 'path'
import type { AgentCredential, ClientConfig } from './types.js'

const VERSION = 1

function expandHome(path: string) {
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

export function clientHome() {
  return resolve(expandHome(process.env.AGENT_CLIENT_HOME || join(homedir(), '.freechat-agent-client')))
}

export function configPath() {
  return join(clientHome(), 'config.json')
}

export function workRoot() {
  return join(clientHome(), 'workspaces')
}

function normalizeServer(url: string) {
  return String(url || 'http://localhost:3001').replace(/\/+$/, '')
}

function baseConfig(): ClientConfig {
  return {
    serverUrl: normalizeServer(process.env.FREECHAT_SERVER_URL || 'http://localhost:3001'),
    clientName: process.env.AGENT_CLIENT_NAME || hostname(),
    host: process.env.AGENT_CLIENT_HOST || '127.0.0.1',
    port: Number(process.env.AGENT_CLIENT_PORT || 5188),
    publicUrl: process.env.AGENT_CLIENT_PUBLIC_URL || undefined,
    adminPassword: process.env.AGENT_CLIENT_ADMIN_PASSWORD || undefined,
    serverAuthToken: process.env.FREECHAT_AUTH_TOKEN || undefined,
    serverUsername: process.env.FREECHAT_USERNAME || undefined,
    serverPassword: process.env.FREECHAT_PASSWORD || undefined,
    maxConcurrency: Number(process.env.AGENT_CLIENT_MAX_CONCURRENCY || 2),
    pollIntervalMs: Number(process.env.FREECHAT_POLL_INTERVAL_MS || 3000),
    agents: [],
  }
}

export function loadConfig(): ClientConfig {
  const defaults = baseConfig()
  if (!existsSync(configPath())) return defaults
  const raw = JSON.parse(readFileSync(configPath(), 'utf8'))
  return {
    ...defaults,
    ...raw,
    serverUrl: normalizeServer(raw.serverUrl || defaults.serverUrl),
    agents: Array.isArray(raw.agents) ? raw.agents : [],
  }
}

export function saveConfig(config: ClientConfig) {
  mkdirSync(dirname(configPath()), { recursive: true })
  const payload = { version: VERSION, ...config, serverUrl: normalizeServer(config.serverUrl), adminPassword: undefined }
  const tmp = `${configPath()}.tmp`
  writeFileSync(tmp, JSON.stringify(payload, null, 2))
  try { chmodSync(tmp, 0o600) } catch {}
  renameSync(tmp, configPath())
}

export function upsertAgent(agent: AgentCredential) {
  const cfg = loadConfig()
  const idx = cfg.agents.findIndex((item) => item.agentId === agent.agentId || item.connectorId === agent.connectorId)
  if (idx >= 0) cfg.agents[idx] = { ...cfg.agents[idx], ...agent, updatedAt: Date.now() }
  else cfg.agents.push(agent)
  saveConfig(cfg)
  return agent
}

export function updateAgent(agentId: string, patch: Partial<AgentCredential>) {
  const cfg = loadConfig()
  const idx = cfg.agents.findIndex((item) => item.agentId === agentId)
  if (idx < 0) throw new Error('Agent not found')
  cfg.agents[idx] = { ...cfg.agents[idx], ...patch, updatedAt: Date.now() }
  saveConfig(cfg)
  return cfg.agents[idx]
}

export function removeAgent(agentId: string) {
  const cfg = loadConfig()
  cfg.agents = cfg.agents.filter((item) => item.agentId !== agentId)
  saveConfig(cfg)
}
