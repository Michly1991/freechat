export interface AgentCliTemplateInput {
  apiUrl: string
  roomId: string
  token: string
}

import { AGENT_CLI_CJS_TEMPLATE } from './agent-cli-template.cjs.js'

export function renderAgentCliWrapper(): string {
  return `#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$DIR/.freechat/freechat.cjs" "$@"
`
}

export function renderAgentCliCjs(input: AgentCliTemplateInput): string {
  return AGENT_CLI_CJS_TEMPLATE
    .replace('__FREECHAT_API_URL__', JSON.stringify(input.apiUrl))
    .replace('__FREECHAT_ROOM_ID__', JSON.stringify(input.roomId))
    .replace('__FREECHAT_TOKEN__', JSON.stringify(input.token))
}
