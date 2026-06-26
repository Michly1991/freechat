export const XIAOMI_AGENT_BUILT_IN_KEY = 'xiaomi_assistant'

export function isBuiltInXiaomiConfig(config?: string | null) {
  return String(config || '').includes(`"builtInKey":"${XIAOMI_AGENT_BUILT_IN_KEY}"`)
}
