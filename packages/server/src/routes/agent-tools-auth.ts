const PERSONAL_TOOLS = new Set([
  'agent.my-list', 'agent.my_list',
  'conversation.list', 'conversation.mark-read', 'conversation.update-prefs',
  'friends.list', 'friends.requests', 'friends.request', 'friends.accept', 'friends.reject', 'friends.status',
  'dm.open', 'dm.get', 'dm.messages', 'dm.send',
])

export function isPersonalTool(action: string) {
  return PERSONAL_TOOLS.has(action)
}
