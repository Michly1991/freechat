const activeStreams = new Map<string, string>()

const keyOf = (roomId: string, agentId: string) => `${roomId}:${agentId}`

export function setActiveAgentStream(roomId: string, agentId: string, streamMessageId: string) {
  activeStreams.set(keyOf(roomId, agentId), streamMessageId)
}

export function getActiveAgentStream(roomId: string, agentId: string): string | undefined {
  return activeStreams.get(keyOf(roomId, agentId))
}

export function clearActiveAgentStream(roomId: string, agentId: string, streamMessageId?: string) {
  const key = keyOf(roomId, agentId)
  if (!streamMessageId || activeStreams.get(key) === streamMessageId) activeStreams.delete(key)
}
