import { existsSync, rmSync } from 'fs'
import { configPath, loadConfig, removeAgent, saveConfig, upsertAgent } from './config/store.js'
import { pairAgent } from './connector/api.js'
import { startLocalServer } from './local-api/server.js'
import { startWorker } from './worker/runtime.js'

function usage() {
  console.log(`FreeChat Agent Client

Commands:
  serve                 start local web console/API (default port 5188)
  worker                run worker loop only
  pair --server <url> --code <pairing-code> [--name <name>]
  list                  list local Agent logins
  remove --agent <id>   remove local Agent login
  reset                 delete local client config

Environment:
  AGENT_CLIENT_HOST     default 127.0.0.1, set 0.0.0.0 for public access
  AGENT_CLIENT_PORT     default 5188
  AGENT_CLIENT_ADMIN_PASSWORD required for public access
  FREECHAT_SERVER_URL   one central FreeChat Server URL
`)
}

function arg(name: string) {
  const idx = process.argv.indexOf(name)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

function normalizeServer(url: string) {
  return url.replace(/\/+$/, '')
}

async function pairCli() {
  const current = loadConfig()
  const server = arg('--server') || process.env.FREECHAT_SERVER_URL || current.serverUrl
  const code = arg('--code') || process.env.FREECHAT_PAIRING_CODE
  if (!server || !code) throw new Error('pair requires --server and --code')
  const cfg = { ...current, serverUrl: normalizeServer(server) }
  saveConfig(cfg)
  const agent = await pairAgent(cfg, code, arg('--name'))
  upsertAgent(agent)
  console.log(`Paired Agent ${agent.agentId}. Local credentials saved to ${configPath()}`)
}

async function main() {
  const cmd = process.argv[2] || 'serve'
  if (cmd === 'help' || cmd === '--help') return usage()
  if (cmd === 'serve') {
    startLocalServer()
    if (process.env.AGENT_CLIENT_AUTOSTART_WORKER !== '0') void startWorker()
    return
  }
  if (cmd === 'worker') return startWorker()
  if (cmd === 'pair') return pairCli()
  if (cmd === 'list') {
    const cfg = loadConfig()
    console.log(JSON.stringify({ serverUrl: cfg.serverUrl, agents: cfg.agents.map((a) => ({ ...a, accessToken: undefined, connectorToken: undefined })) }, null, 2))
    return
  }
  if (cmd === 'remove') { const id = arg('--agent'); if (!id) throw new Error('remove requires --agent <id>'); removeAgent(id); return console.log(`Removed ${id}`) }
  if (cmd === 'reset') { if (existsSync(configPath())) rmSync(configPath()); return console.log('Agent Client config removed') }
  usage()
}

main().catch((err) => { console.error(err?.message || err); process.exit(1) })
