import { join, resolve } from 'path'
import type { AgentCredential } from '../config/types.js'
import { workRoot } from '../config/store.js'

function safeSegment(value: string, fallback: string) {
  return String(value || fallback).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || fallback
}

export function agentRoot(agent: Pick<AgentCredential, 'agentId' | 'workdir'> | string) {
  const agentId = typeof agent === 'string' ? agent : agent.agentId
  const customRoot = typeof agent === 'string' ? undefined : agent.workdir
  const base = customRoot ? resolve(customRoot) : workRoot()
  return join(base, 'agents', safeSegment(agentId, 'agent'))
}

export function agentKnowledgeDir(agent: Pick<AgentCredential, 'agentId' | 'workdir'> | string) {
  return join(agentRoot(agent), 'knowledge')
}

export function agentRoomWorkspace(agent: Pick<AgentCredential, 'agentId' | 'workdir'> | string, roomId: string) {
  return join(agentRoot(agent), 'rooms', safeSegment(roomId, 'room'))
}
