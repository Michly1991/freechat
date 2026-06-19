#!/usr/bin/env node
import { spawnSync } from 'child_process'

function run(cmd, args = []) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' })
  return {
    ok: result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    status: result.status,
  }
}

function printInstallTips() {
  console.log(`\nInstall tips / 安装提示:\n\n1. Install Claude Code CLI / 安装 Claude Code CLI\n\n   npm install -g @anthropic-ai/claude-code\n\n2. China mainland users often need cc-switch / 国内用户通常还需要 cc-switch\n\n   npm install -g cc-switch\n   cc-switch\n\n3. Configure Claude Code locally on this remote server / 在远程服务器本机配置 Claude Code\n\n   claude -p "hello"\n\nFreeChat does not need your model API key. Keep model credentials on this remote server.\nFreeChat 不需要你的模型 API Key，模型凭证只保存在这台远程服务器。\n`)
}

const claudeVersion = run('claude', ['--version'])
const ccSwitchVersion = run('cc-switch', ['--version'])

console.log('FreeChat Remote Claude Agent environment check')
console.log('================================================')
console.log(`Claude Code: ${claudeVersion.ok ? `OK ${claudeVersion.stdout || claudeVersion.stderr}` : 'MISSING'}`)
console.log(`cc-switch:   ${ccSwitchVersion.ok ? `OK ${ccSwitchVersion.stdout || ccSwitchVersion.stderr}` : 'not found (optional, recommended for China mainland users)'}`)

if (!claudeVersion.ok) {
  printInstallTips()
  process.exit(1)
}

const smokePrompt = process.argv.includes('--smoke')
if (smokePrompt) {
  console.log('\nRunning Claude smoke test: claude -p "hello"')
  const smoke = run('claude', ['-p', 'hello'])
  if (!smoke.ok) {
    console.error('Claude smoke test failed:')
    console.error(smoke.stderr || smoke.stdout)
    printInstallTips()
    process.exit(2)
  }
  console.log('Claude smoke test OK')
}

console.log('\nEnvironment check passed.')
if (!ccSwitchVersion.ok) console.log('Tip: if you are in China mainland and Claude Code cannot connect, install/configure cc-switch.')
