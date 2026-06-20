import { createServer } from 'https'
import { readFileSync } from 'fs'
import { request as httpRequest } from 'http'
import net from 'net'

const key = readFileSync(new URL('../.freechat/https/freechat-ip.key', import.meta.url))
const cert = readFileSync(new URL('../.freechat/https/freechat-ip.crt', import.meta.url))
const port = Number(process.env.FREECHAT_HTTPS_PORT || 5443)

function targetFor(pathname) {
  if (pathname.startsWith('/api/') || pathname.startsWith('/uploads/') || pathname === '/ws') return { host: '127.0.0.1', port: Number(process.env.FREECHAT_API_PORT || 3001) }
  return { host: '127.0.0.1', port: Number(process.env.FREECHAT_WEB_PORT || 5174) }
}

const server = createServer({ key, cert }, (req, res) => {
  const url = new URL(req.url || '/', 'https://localhost')
  const target = targetFor(url.pathname)
  const headers = { ...req.headers, host: `${target.host}:${target.port}`, 'x-forwarded-proto': 'https' }
  const proxy = httpRequest({ host: target.host, port: target.port, path: req.url, method: req.method, headers }, (upstream) => {
    res.writeHead(upstream.statusCode || 502, upstream.headers)
    upstream.pipe(res)
  })
  proxy.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`FreeChat HTTPS proxy error: ${err.message}`)
  })
  req.pipe(proxy)
})


server.on('upgrade', (req, socket) => {
  const url = new URL(req.url || '/', 'https://localhost')
  if (url.pathname !== '/ws') {
    socket.destroy()
    return
  }
  const target = targetFor(url.pathname)
  const upstream = net.connect(target.port, target.host, () => {
    const headers = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('\r\n')
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`)
    socket.pipe(upstream).pipe(socket)
  })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
})

server.listen(port, '0.0.0.0', () => console.log(`FreeChat HTTPS proxy listening on https://0.0.0.0:${port}`))
