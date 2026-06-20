import { Server } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { remoteAgentConnectorService } from '../services/remote-agent-connector.service.js'

export function initRemoteAgentEventWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`)
    if (url.pathname !== '/api/remote-agents/events/ws') return
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })
  wss.on('connection', async (ws: WebSocket, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`)
    const token = url.searchParams.get('token') || ''
    const auth = await remoteAgentConnectorService.authenticateCredential(token)
    if (!auth) {
      ws.close(4001, 'Invalid remote Agent connector credential')
      return
    }
    const send = (event: any) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'remote-event', event }))
    }
    ws.send(JSON.stringify({ type: 'ready', agentId: auth.agentId }))
    const unsubscribe = remoteAgentConnectorService.subscribe(auth, send)
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', now: Date.now() }))
    }, 25000)
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg?.type === 'ping' && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pong', now: Date.now() }))
      } catch {}
    })
    ws.on('close', () => { clearInterval(ping); unsubscribe() })
    ws.on('error', () => { clearInterval(ping); unsubscribe() })
  })
  console.log('Remote Agent event WebSocket initialized')
}
