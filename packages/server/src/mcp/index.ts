#!/usr/bin/env node
/**
 * MCP Server for FreeChat
 *
 * A stdio-based MCP server that Claude Code can call as a tool provider.
 * It exposes FreeChat room operations (send_message, manage tasks, etc.)
 * so agents can interact with the room programmatically.
 *
 * Usage: spawned by the agent service or run standalone with:
 *   FREECHAT_ROOM_ID=room_xxx FREECHAT_API_URL=http://localhost:3000 FREECHAT_API_KEY=fc_xxx node mcp/index.js
 */

import { createInterface } from 'readline'

// === Configuration from environment ===
const ROOM_ID = process.env.FREECHAT_ROOM_ID || ''
const API_URL = process.env.FREECHAT_API_URL || 'http://localhost:3000'
const API_KEY = process.env.FREECHAT_API_KEY || ''

// === HTTP helper ===
async function apiRequest(method: string, path: string, body?: any): Promise<any> {
  const url = `${API_URL}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`
  }

  const options: RequestInit = { method, headers }
  if (body) {
    options.body = JSON.stringify(body)
  }

  const res = await fetch(url, options)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`)
  }
  return res.json()
}

// === MCP Tool definitions ===
interface MCPTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
  handler: (args: any) => Promise<any>
}

const tools: MCPTool[] = [
  {
    name: 'send_message',
    description: 'Send a message to the current FreeChat room. Use this to communicate with other members.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The message content to send',
        },
      },
      required: ['content'],
    },
    handler: async (args) => {
      const result = await apiRequest('POST', `/api/rooms/${ROOM_ID}/messages`, {
        content: args.content,
      })
      return { success: true, message: 'Message sent', data: result }
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task in the room. Tasks help track work and assign responsibilities.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Task title',
        },
        description: {
          type: 'string',
          description: 'Optional task description',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Task priority (default: medium)',
        },
        assignee: {
          type: 'string',
          description: 'Assignee name or ID',
        },
      },
      required: ['title'],
    },
    handler: async (args) => {
      const result = await apiRequest('POST', `/api/rooms/${ROOM_ID}/tasks`, {
        title: args.title,
        description: args.description,
        priority: args.priority || 'medium',
        assignee_name: args.assignee,
      })
      return { success: true, message: 'Task created', data: result }
    },
  },
  {
    name: 'update_task',
    description: 'Update an existing task (status, title, description, priority, assignee, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The task ID to update',
        },
        updates: {
          type: 'object',
          description: 'Fields to update (title, description, status, priority, assigneeId, assigneeName, blockedReason, reviewNote)',
        },
      },
      required: ['task_id', 'updates'],
    },
    handler: async (args) => {
      const result = await apiRequest('PATCH', `/api/rooms/${ROOM_ID}/tasks/${args.task_id}`, {
        updates: args.updates,
      })
      return { success: true, message: 'Task updated', data: result }
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks in the room, optionally filtered by status.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['todo', 'assigned', 'doing', 'review', 'blocked', 'done', 'failed', 'cancelled'],
          description: 'Filter by task status',
        },
      },
    },
    handler: async (args) => {
      const query = args.status ? `?status=${args.status}` : ''
      const result = await apiRequest('GET', `/api/rooms/${ROOM_ID}/tasks${query}`)
      return { success: true, data: result }
    },
  },
  {
    name: 'list_members',
    description: 'List all members (humans and agents) in the current room.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const result = await apiRequest('GET', `/api/rooms/${ROOM_ID}/members`)
      return { success: true, data: result }
    },
  },
  {
    name: 'get_room_info',
    description: 'Get information about the current room (name, description, members, etc.).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const result = await apiRequest('GET', `/api/rooms/${ROOM_ID}`)
      return { success: true, data: result }
    },
  },
]

// === MCP Protocol types ===
interface MCPRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: any
}

interface MCPResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

// === MCP Server ===
function handleRequest(req: MCPRequest): MCPResponse {
  const { id, method, params } = req

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'freechat-mcp',
            version: '1.0.0',
          },
        },
      }

    case 'notifications/initialized':
      // This is a notification, no response needed per spec
      return { jsonrpc: '2.0', id, result: {} }

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: tools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      }

    case 'tools/call': {
      const toolName = params?.name
      const toolArgs = params?.arguments || {}
      const tool = tools.find(t => t.name === toolName)

      if (!tool) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Unknown tool: ${toolName}`,
          },
        }
      }

      // Return a promise-wrapped response
      // Since we're synchronous in readline, we'll handle this async
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ pending: true, tool: toolName }),
            },
          ],
        },
      }
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Unknown method: ${method}`,
        },
      }
  }
}

/**
 * Handle a tools/call request asynchronously and return the proper response
 */
async function handleToolCall(id: string | number, params: any): Promise<MCPResponse> {
  const toolName = params?.name
  const toolArgs = params?.arguments || {}
  const tool = tools.find(t => t.name === toolName)

  if (!tool) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Unknown tool: ${toolName}`,
      },
    }
  }

  try {
    const result = await tool.handler(toolArgs)
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      },
    }
  } catch (err: any) {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: err.message || 'Tool execution failed',
            }),
          },
        ],
        isError: true,
      },
    }
  }
}

// === Main: stdio JSON-RPC loop ===
async function main() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  })

  // Log to stderr so stdout stays clean for JSON-RPC
  console.error('[freechat-mcp] Server started, waiting for requests...')
  console.error(`[freechat-mcp] Room: ${ROOM_ID || '(not set)'}`)
  console.error(`[freechat-mcp] API: ${API_URL}`)

  rl.on('line', async (line) => {
    const trimmed = line.trim()
    if (!trimmed) return

    try {
      const req = JSON.parse(trimmed) as MCPRequest

      // Special async handling for tools/call
      if (req.method === 'tools/call') {
        const response = await handleToolCall(req.id, req.params)
        process.stdout.write(JSON.stringify(response) + '\n')
        return
      }

      const response = handleRequest(req)

      // Skip response for notifications (no id means it's a notification)
      if (req.method.startsWith('notifications/')) {
        return
      }

      process.stdout.write(JSON.stringify(response) + '\n')
    } catch (err: any) {
      const errorResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 'unknown',
        error: {
          code: -32700,
          message: `Parse error: ${err.message}`,
        },
      }
      process.stdout.write(JSON.stringify(errorResponse) + '\n')
    }
  })

  rl.on('close', () => {
    console.error('[freechat-mcp] stdin closed, shutting down')
    process.exit(0)
  })
}

// Run
main().catch(err => {
  console.error('[freechat-mcp] Fatal error:', err)
  process.exit(1)
})
