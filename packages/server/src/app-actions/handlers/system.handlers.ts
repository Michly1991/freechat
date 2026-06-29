import { getAppAction } from '../registry.js'
import type { ToolExecutionContext, ToolHandlerOutcome } from '../types.js'

export async function handleSystemAction(ctx: ToolExecutionContext, args: any = {}): Promise<ToolHandlerOutcome> {
  switch (ctx.action) {
    case 'tool.help':
    case 'tool.schema': {
      const name = String(args.name || args.tool || args.action || '').trim()
      const meta = getAppAction(name)
      return { handled: true, response: { success: true, data: meta ? { tool: meta } : { name, input: 'JSON object args', transport: { action: name, args: {} } } } }
    }
    case 'app.call':
    case 'tool.call': {
      const target = String(args.action || args.tool || args.name || '').trim()
      if (!target) throw { code: 'VALIDATION_ERROR', message: 'action is required' }
      if (target === 'app.call' || target === 'tool.call') throw { code: 'VALIDATION_ERROR', message: 'nested app.call is not allowed' }
      const nextArgs = args.args || args.params || {}
      const scopeRoomId = args.roomId || args.scopeRoomId || nextArgs.roomId || nextArgs.scopeRoomId || ctx.scopeRoomId
      const { executeTool } = await import('../router.js')
      const response = await executeTool({ ...ctx, action: target, args: nextArgs, scopeRoomId, transport: ctx.transport || 'server-internal' }, { audit: false })
      return { handled: true, response }
    }
    default:
      return { handled: false }
  }
}
