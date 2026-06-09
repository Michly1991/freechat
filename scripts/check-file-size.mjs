#!/usr/bin/env node
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const ignoreParts = new Set(['node_modules', 'dist', '.git', 'workspace-data'])
const extensions = new Set(['.ts', '.tsx', '.md'])
const defaultLimit = 700
const markdownLimit = 600

// Existing hotspots are allowed temporarily but may not grow further.
// Refactor these down over time instead of raising the ceilings.
const baselines = new Map([
  ['packages/web/src/pages/RoomPage.tsx', 1690],
  ['packages/server/src/services/agent.service.ts', 980],
  ['packages/server/src/ws/gateway.ts', 830],
  ['packages/web/src/pages/HomePage.tsx', 700],
])

function extOf(path) {
  const i = path.lastIndexOf('.')
  return i >= 0 ? path.slice(i) : ''
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (ignoreParts.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (extensions.has(extOf(full))) out.push(full)
  }
  return out
}

const files = walk(root)
const violations = []
for (const file of files) {
  const rel = relative(root, file)
  const lines = readFileSync(file, 'utf8').split('\n').length
  const limit = baselines.get(rel) ?? (rel.endsWith('.md') ? markdownLimit : defaultLimit)
  if (lines > limit) violations.push({ rel, lines, limit })
}

if (violations.length > 0) {
  console.error('File size budget exceeded. Split large files before adding more logic/docs:')
  for (const v of violations.sort((a, b) => b.lines - a.lines)) {
    console.error(`- ${v.rel}: ${v.lines} lines > ${v.limit}`)
  }
  process.exit(1)
}

console.log(`File size check passed for ${files.length} files.`)
