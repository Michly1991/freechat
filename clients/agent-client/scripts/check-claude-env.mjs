#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
function check(cmd, args = ['--version']) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' })
  return { ok: res.status === 0, text: (res.stdout || res.stderr || '').trim() }
}
const claude = check('claude')
const ccSwitch = check('cc-switch')
console.log(JSON.stringify({ claude, ccSwitch, node: process.version }, null, 2))
if (!claude.ok) {
  console.error('Claude Code 未检测到。请先安装并确认 `claude --version` 可用。国内用户可配置 cc-switch 后再重试。')
  process.exit(1)
}
