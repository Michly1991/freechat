import { spawnSync } from 'child_process'

function commandVersion(command: string) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' })
  return { ok: result.status === 0, text: (result.stdout || result.stderr || '').trim() }
}

export function healthSnapshot() {
  return {
    node: { ok: true, text: process.version },
    claude: commandVersion('claude'),
    ccSwitch: commandVersion('cc-switch'),
    checkedAt: Date.now(),
  }
}
