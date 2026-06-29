export type InlineToolCall = { name: string; args: any }

function tryParseJson(text: string): any | null {
  try { return JSON.parse(text) } catch { return null }
}

function parseToolCallPayload(raw: string): any | null {
  const text = String(raw || '').trim()
  const parsed = tryParseJson(text)
  if (parsed) return parsed
  let depth = 0
  let inString = false
  let escape = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (escape) { escape = false; continue }
    if (ch === '\\') { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return tryParseJson(text.slice(0, i + 1))
    }
  }
  return null
}

export function extractInlineToolCalls(text: string): InlineToolCall[] {
  const calls: InlineToolCall[] = []
  const markerRe = /<\|FunctionCallBegin\|>([\s\S]*?)<\|FunctionCallEnd\|>/g
  for (const match of String(text || '').matchAll(markerRe)) {
    const parsed = tryParseJson(match[1].trim())
    if (Array.isArray(parsed)) {
      for (const item of parsed) if (item?.name) calls.push({ name: String(item.name), args: item.args || {} })
    } else if (parsed?.name) calls.push({ name: String(parsed.name), args: parsed.args || {} })
  }
  const toolCallRe = /<toolcall>([\s\S]*?)<\/toolcall>/gi
  for (const match of String(text || '').matchAll(toolCallRe)) {
    const parsed = tryParseJson(match[1].trim())
    if (parsed?.name) calls.push({ name: String(parsed.name), args: parsed.args || parsed.params || {} })
    else if (parsed?.action || parsed?.tool) calls.push({ name: String(parsed.action || parsed.tool), args: parsed.args || parsed.params || {} })
  }
  const openToolCallRe = /<toolcall>\s*([\s\S]*?)(?:$|```|\n\n)/gi
  for (const match of String(text || '').matchAll(openToolCallRe)) {
    const parsed = parseToolCallPayload(match[1])
    if (parsed?.name) calls.push({ name: String(parsed.name), args: parsed.args || parsed.params || {} })
    else if (parsed?.action || parsed?.tool) calls.push({ name: String(parsed.action || parsed.tool), args: parsed.args || parsed.params || {} })
  }
  const codeRe = /```(?:json)?\s*([\s\S]*?)```/g
  for (const match of String(text || '').matchAll(codeRe)) {
    const parsed = tryParseJson(match[1].trim())
    if (parsed?.action || parsed?.tool) calls.push({ name: String(parsed.action || parsed.tool), args: parsed.args || {} })
  }
  return calls.slice(0, 5)
}

export function containsInlineToolMarkup(text: string): boolean {
  const raw = String(text || '')
  return /<\|FunctionCallBegin\|>[\s\S]*?<\|FunctionCallEnd\|>/i.test(raw) || /<toolcall>[\s\S]*?(?:<\/toolcall>|$)/i.test(raw)
}

export function stripInlineToolMarkup(text: string): string {
  return String(text || '')
    .replace(/<\|FunctionCallBegin\|>[\s\S]*?<\|FunctionCallEnd\|>/gi, '')
    .replace(/<toolcall>[\s\S]*?(?:<\/toolcall>|$)/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isLikelyToolPreamble(text: string): boolean {
  const normalized = String(text || '').trim()
  if (!normalized) return false
  return normalized.length <= 80 && /(?:我来|我先|先|稍等|正在|我需要先|接下来).{0,24}(?:读取|查看|查询|检查|分析|调用|处理|打开|加载)/.test(normalized)
}

export function sanitizeAiCompletionForChat(text: string): string {
  const raw = String(text || '')
  if (!containsInlineToolMarkup(raw)) return raw.trim()
  const stripped = stripInlineToolMarkup(raw)
  return isLikelyToolPreamble(stripped) ? '' : stripped
}
