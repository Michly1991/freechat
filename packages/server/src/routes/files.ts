import { FastifyInstance } from 'fastify'
import { mkdir, readdir, readFile, writeFile, unlink, stat } from 'fs/promises'
import { join, dirname, basename } from 'path'
import { existsSync } from 'fs'
import { config } from '../config.js'
import { tabConfigService } from '../services/tab-config.service.js'
import { safeRoomFilePath } from '../services/file-mention-context.service.js'
import { assertRoomEditor, assertRoomMember, routeAuthError } from './route-auth.js'

function safeOptionalDir(input = '') {
  const trimmed = String(input || '').trim().replace(/^[/\\]+/, '')
  if (!trimmed) return ''
  return safeRoomFilePath(trimmed)
}

function cleanFilename(input = 'upload.bin') {
  return basename(input).replace(/[\\/:*?"<>|]/g, '_').trim() || 'upload.bin'
}

export async function registerFileRoutes(app: FastifyInstance) {
  app.get('/api/rooms/:roomId/files', async (request, reply) => {
    const { roomId } = request.params as any
    const user = (request as any).user
    try { assertRoomMember(roomId, user.id) } catch (err: any) { return routeAuthError(reply, err) }
    const roomDir = join(config.workspace.root, roomId, 'files')

    if (!existsSync(roomDir)) await mkdir(roomDir, { recursive: true })

    async function buildTree(dir: string, prefix = ''): Promise<any[]> {
      const entries = await readdir(dir, { withFileTypes: true })
      const items = []
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) items.push({ name: entry.name, path: relativePath, type: 'directory', children: await buildTree(fullPath, relativePath) })
        else {
          const stats = await stat(fullPath)
          items.push({ name: entry.name, path: relativePath, type: 'file', size: stats.size, modifiedAt: stats.mtime.getTime() })
        }
      }
      return items.sort((a, b) => a.type === 'directory' && b.type !== 'directory' ? -1 : a.type !== 'directory' && b.type === 'directory' ? 1 : a.name.localeCompare(b.name))
    }

    try {
      const tree = await buildTree(roomDir)
      const tab = await tabConfigService.getTab(roomId, 'files')
      return { success: true, data: { files: tabConfigService.filterFileTree(tree, tab), tabConfig: tab } }
    } catch (err: any) { return reply.code(500).send({ success: false, error: err.message }) }
  })

  app.get('/api/rooms/:roomId/files/:path', async (request, reply) => {
    const { roomId, path } = request.params as any
    const user = (request as any).user
    try { assertRoomMember(roomId, user.id) } catch (err: any) { return routeAuthError(reply, err) }
    const filePath = safeRoomFilePath(path)
    try {
      const content = await readFile(join(config.workspace.root, roomId, 'files', filePath), 'utf-8')
      return { success: true, data: { content, path: filePath } }
    } catch (err: any) {
      if (err.code === 'ENOENT') return reply.code(404).send({ success: false, error: 'File not found' })
      return reply.code(500).send({ success: false, error: err.message })
    }
  })

  app.put('/api/rooms/:roomId/files/:path', async (request, reply) => {
    const { roomId, path } = request.params as any
    const user = (request as any).user
    try { assertRoomEditor(roomId, user.id) } catch (err: any) { return routeAuthError(reply, err) }
    const { content } = request.body as any
    const filePath = safeRoomFilePath(path)
    const fullPath = join(config.workspace.root, roomId, 'files', filePath)
    try {
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, content, 'utf-8')
      await tabConfigService.addFile(roomId, 'files', filePath)
      return { success: true, data: { path: filePath } }
    } catch (err: any) { return reply.code(500).send({ success: false, error: err.message }) }
  })

  app.delete('/api/rooms/:roomId/files/:path', async (request, reply) => {
    const { roomId, path } = request.params as any
    const user = (request as any).user
    try { assertRoomEditor(roomId, user.id) } catch (err: any) { return routeAuthError(reply, err) }
    const filePath = safeRoomFilePath(path)
    try {
      await unlink(join(config.workspace.root, roomId, 'files', filePath))
      await tabConfigService.removeFile(roomId, 'files', filePath)
      return { success: true }
    } catch (err: any) {
      if (err.code === 'ENOENT') return reply.code(404).send({ success: false, error: 'File not found' })
      return reply.code(500).send({ success: false, error: err.message })
    }
  })

  const handleUpload = async (request: any, reply: any) => {
    const { roomId } = request.params as any
    const user = request.user
    try {
      assertRoomEditor(roomId, user.id)
      const file = await request.file()
      if (!file) return reply.code(400).send({ success: false, error: { message: 'No file uploaded' } })
      const dir = safeOptionalDir((file.fields?.path as any)?.value || (file.fields?.dir as any)?.value || '')
      const rel = safeRoomFilePath(dir ? `${dir}/${cleanFilename(file.filename)}` : cleanFilename(file.filename))
      const fullPath = join(config.workspace.root, roomId, 'files', rel)
      await mkdir(dirname(fullPath), { recursive: true })
      const buffer = await file.toBuffer()
      await writeFile(fullPath, buffer)
      await tabConfigService.addFile(roomId, 'files', rel)
      return { success: true, data: { filename: cleanFilename(file.filename), path: rel, size: buffer.length, mimeType: file.mimetype } }
    } catch (err: any) {
      if (err?.code === 'NOT_ROOM_MEMBER' || err?.code === 'FORBIDDEN') return routeAuthError(reply, err)
      return reply.code(err?.code === 'INVALID_PATH' ? 400 : 500).send({ success: false, error: { message: err.message || String(err) } })
    }
  }

  app.post('/api/rooms/:roomId/upload', handleUpload)
  app.post('/api/rooms/:roomId/files/upload', handleUpload)

  app.post('/api/rooms/:roomId/files/mkdir', async (request, reply) => {
    const { roomId } = request.params as any
    const user = (request as any).user
    try { assertRoomEditor(roomId, user.id) } catch (err: any) { return routeAuthError(reply, err) }
    const { path } = request.body as any
    const dirPath = safeRoomFilePath(path)
    try {
      await mkdir(join(config.workspace.root, roomId, 'files', dirPath), { recursive: true })
      await tabConfigService.addDir(roomId, 'files', dirPath)
      return { success: true, data: { path: dirPath } }
    } catch (err: any) { return reply.code(500).send({ success: false, error: err.message }) }
  })
}
