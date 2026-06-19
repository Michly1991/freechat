#!/usr/bin/env node
import { spawn } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const dir = mkdtempSync(join(tmpdir(), 'freechat-remote-claude-'))
const freechat = join(dir, 'freechat')
writeFileSync(freechat, `#!/usr/bin/env bash\necho "[freechat mock] $@"\n`, 'utf8')
chmodSync(freechat, 0o755)
writeFileSync(join(dir, 'CLAUDE.md'), 'You are testing FreeChat remote Claude Agent local runtime. If you need to call FreeChat tools, use ./freechat.\n', 'utf8')

const prompt = process.argv.slice(2).join(' ') || 'Reply with exactly: FREECHAT_REMOTE_CLAUDE_OK'
const args = ['-p', prompt, '--permission-mode', 'auto', '--allowedTools', 'Bash(./freechat *)']
if (process.env.FREECHAT_CLAUDE_MODEL) args.push('--model', process.env.FREECHAT_CLAUDE_MODEL)

console.log(`Workspace: ${dir}`)
console.log(`Command: claude ${args.map((x) => JSON.stringify(x)).join(' ')}`)

const child = spawn('claude', args, { cwd: dir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
let out = '', err = ''
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d) })
child.stderr.on('data', (d) => { err += d.toString(); process.stderr.write(d) })
child.on('error', (error) => {
  console.error(`Failed to start claude: ${error.message}`)
  rmSync(dir, { recursive: true, force: true })
  process.exit(1)
})
child.on('close', (code) => {
  rmSync(dir, { recursive: true, force: true })
  if (code !== 0) {
    console.error(`claude exited with code ${code}`)
    process.exit(code || 1)
  }
  if (!out.trim()) {
    console.error('claude produced no output')
    process.exit(2)
  }
  console.log('\nLocal Claude runtime smoke test passed.')
})
