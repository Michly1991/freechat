import { readFile, writeFile, stat } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import { PDFParse } from 'pdf-parse'
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'
import { v4 as uuidv4 } from 'uuid'
import { roomFileService } from './room-file.service.js'
import { config } from '../config.js'
import { safeRelativePath, assertProjectFilePathAllowed } from '../routes/agent-tools.helpers.js'
import { modelRuntimeService } from './model-runtime.service.js'
import type { AICallResult } from './ai-config.service.js'

type OfficeKind = 'pdf' | 'excel' | 'word' | 'ppt' | 'image' | 'unknown'

const MAX_TEXT_CHARS = 120_000
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function clamp(n: any, def: number, max: number) {
  const value = Number(n || def)
  return Number.isFinite(value) && value > 0 ? Math.min(Math.trunc(value), max) : def
}

function detectKind(name: string, mimeType?: string | null): OfficeKind {
  const mime = String(mimeType || '').toLowerCase()
  const ext = extname(name).toLowerCase()
  if (mime.includes('pdf') || ext === '.pdf') return 'pdf'
  if (mime.includes('spreadsheet') || mime.includes('excel') || ['.xlsx', '.xlsm'].includes(ext)) return 'excel'
  if (mime.includes('wordprocessing') || mime.includes('msword') || ext === '.docx') return 'word'
  if (mime.includes('presentation') || mime.includes('powerpoint') || ext === '.pptx') return 'ppt'
  if (mime.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return 'image'
  return 'unknown'
}

function publicFile(row: any) {
  return { id: row.id, ref: row.id ? `file:${row.id}` : undefined, name: row.name, path: row.relative_path, mimeType: row.mime_type || undefined, size: row.size || 0, source: row.source, messageId: row.message_id || undefined }
}

function resolveFile(roomId: string, ref: string) {
  const row = roomFileService.resolveRef(roomId, ref)
  const fullPath = join(config.workspace.root, roomId, 'files', row.storage_path || row.relative_path)
  return { row, fullPath, kind: detectKind(row.name || row.relative_path || ref, row.mime_type) }
}

function parseRange(range?: string, max = 9999) {
  const text = String(range || '').trim()
  if (!text) return { from: 1, to: max }
  const m = text.match(/^(\d+)(?:\s*-\s*(\d+))?$/)
  if (!m) return { from: 1, to: max }
  const from = Math.max(1, Number(m[1] || 1))
  const to = Math.max(from, Math.min(max, Number(m[2] || m[1] || from)))
  return { from, to }
}

async function readPdfText(fullPath: string, args: any) {
  const parser = new PDFParse({ data: await readFile(fullPath) })
  try {
    const info = await parser.getInfo().catch(() => null as any)
    const pages = Number(info?.total || info?.pages || info?.numPages || 0) || undefined
    const result = await parser.getText({ partial: args.pageRange ? [parseRange(args.pageRange).from, parseRange(args.pageRange).to] : undefined } as any).catch(async () => parser.getText()) as any
    const text = String(result?.text || result || '')
    const limit = clamp(args.limit || args.maxChars, MAX_TEXT_CHARS, 500_000)
    return { pages, text: text.slice(0, limit), truncated: text.length > limit, totalChars: text.length }
  } finally {
    await parser.destroy().catch(() => {})
  }
}

async function inspectExcel(fullPath: string) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(fullPath)
  return workbook.worksheets.map((sheet) => ({ name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount }))
}

function cellToText(value: any): string {
  if (value == null) return ''
  if (typeof value === 'object') {
    if (value.text) return String(value.text)
    if (value.result != null) return String(value.result)
    if (Array.isArray(value.richText)) return value.richText.map((x: any) => x.text || '').join('')
    if (value.hyperlink && value.text) return `${value.text} (${value.hyperlink})`
    return JSON.stringify(value)
  }
  return String(value)
}

async function readExcel(fullPath: string, args: any) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(fullPath)
  const sheet = args.sheet ? workbook.getWorksheet(String(args.sheet)) : workbook.worksheets[0]
  if (!sheet) throw { code: 'SHEET_NOT_FOUND', message: 'Excel sheet not found' }
  const rows: string[][] = []
  const maxRows = clamp(args.maxRows, 80, 500)
  const maxCols = clamp(args.maxCols, 30, 100)
  const range = String(args.range || '').trim()
  let rowStart = 1, rowEnd = Math.min(sheet.rowCount, maxRows), colStart = 1, colEnd = Math.min(sheet.columnCount || maxCols, maxCols)
  const m = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i)
  if (m) {
    const colNum = (s: string) => s.toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
    colStart = colNum(m[1]); rowStart = Number(m[2]); colEnd = Math.min(colNum(m[3]), colStart + maxCols - 1); rowEnd = Math.min(Number(m[4]), rowStart + maxRows - 1)
  }
  for (let r = rowStart; r <= rowEnd; r++) {
    const row = sheet.getRow(r)
    const out: string[] = []
    for (let c = colStart; c <= colEnd; c++) out.push(cellToText(row.getCell(c).value))
    rows.push(out)
  }
  return { sheet: sheet.name, range: { rowStart, rowEnd, colStart, colEnd }, rows, csv: rows.map((r) => r.map((v) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\n') }
}

async function writeExcel(roomId: string, actorUserId: string, args: any) {
  const targetPath = safeRelativePath(args.targetPath || args.path || `outputs/${Date.now()}.xlsx`)
  assertProjectFilePathAllowed(targetPath)
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(String(args.sheet || 'Sheet1'))
  const rows = Array.isArray(args.rows) ? args.rows : String(args.csv || args.content || '').split(/\r?\n/).filter(Boolean).map((line) => line.split(','))
  rows.forEach((row: any) => sheet.addRow(Array.isArray(row) ? row : [String(row)]))
  const fullPath = join(config.workspace.root, roomId, 'files', targetPath)
  await import('fs/promises').then((m) => m.mkdir(dirname(fullPath), { recursive: true })).catch(() => {})
  await workbook.xlsx.writeFile(fullPath)
  return roomFileService.promote(roomId, targetPath, targetPath, actorUserId).catch(async () => {
    const st = await stat(fullPath)
    const folderId = roomFileService.ensureFolder(roomId, targetPath.split('/').slice(0, -1).join('/') || 'files', 'project', actorUserId)
    return roomFileService.upsertFileRecord({ roomId, folderId, name: basename(targetPath), rel: targetPath, storagePath: targetPath, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: st.size, source: 'generated', uploadedBy: actorUserId })
  })
}

async function readWord(fullPath: string, args: any) {
  const result = await mammoth.extractRawText({ path: fullPath })
  const text = String(result.value || '')
  const limit = clamp(args.limit || args.maxChars, MAX_TEXT_CHARS, 500_000)
  return { text: text.slice(0, limit), truncated: text.length > limit, totalChars: text.length, messages: result.messages || [] }
}

async function writeWord(roomId: string, actorUserId: string, args: any) {
  const targetPath = safeRelativePath(args.targetPath || args.path || `outputs/${Date.now()}.docx`)
  assertProjectFilePathAllowed(targetPath)
  const paragraphs = String(args.content || '').split(/\n{2,}/).map((para) => new Paragraph({ children: [new TextRun(para)] }))
  const doc = new Document({ sections: [{ properties: {}, children: paragraphs.length ? paragraphs : [new Paragraph('')] }] })
  const buf = await Packer.toBuffer(doc)
  const fullPath = join(config.workspace.root, roomId, 'files', targetPath)
  await import('fs/promises').then((m) => m.mkdir(dirname(fullPath), { recursive: true })).catch(() => {})
  await writeFile(fullPath, buf)
  const st = await stat(fullPath)
  const folderId = roomFileService.ensureFolder(roomId, targetPath.split('/').slice(0, -1).join('/') || 'files', 'project', actorUserId)
  return roomFileService.upsertFileRecord({ roomId, folderId, name: basename(targetPath), rel: targetPath, storagePath: targetPath, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: st.size, source: 'generated', uploadedBy: actorUserId })
}

async function readPpt(fullPath: string, args: any) {
  const zip = await JSZip.loadAsync(await readFile(fullPath))
  const files = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => Number(a.match(/slide(\d+)/)?.[1] || 0) - Number(b.match(/slide(\d+)/)?.[1] || 0))
  const { from, to } = parseRange(args.slideRange || args.range, files.length)
  const slides = []
  for (let i = from - 1; i < Math.min(to, files.length); i++) {
    const xml = await zip.files[files[i]].async('text')
    const texts = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)).map((m) => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
    slides.push({ slide: i + 1, text: texts.join('\n') })
  }
  return { slideCount: files.length, slides, text: slides.map((s) => `# Slide ${s.slide}\n${s.text}`).join('\n\n') }
}

async function writePpt(roomId: string, actorUserId: string, args: any) {
  const targetPath = safeRelativePath(args.targetPath || args.path || `outputs/${Date.now()}.pptx`)
  assertProjectFilePathAllowed(targetPath)
  const PptxCtor = (PptxGenJS as any).default || PptxGenJS
  const pptx = new PptxCtor()
  const slides = Array.isArray(args.slides) ? args.slides : String(args.content || '').split(/\n---+\n/).map((text) => ({ title: '', text }))
  for (const item of slides) {
    const slide = pptx.addSlide()
    if (item.title) slide.addText(String(item.title), { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 24, bold: true })
    slide.addText(String(item.text || item.content || ''), { x: 0.5, y: item.title ? 1 : 0.5, w: 9, h: 4.8, fontSize: 16, fit: 'shrink' })
  }
  const fullPath = join(config.workspace.root, roomId, 'files', targetPath)
  await import('fs/promises').then((m) => m.mkdir(dirname(fullPath), { recursive: true })).catch(() => {})
  await pptx.writeFile({ fileName: fullPath })
  const st = await stat(fullPath)
  const folderId = roomFileService.ensureFolder(roomId, targetPath.split('/').slice(0, -1).join('/') || 'files', 'project', actorUserId)
  return roomFileService.upsertFileRecord({ roomId, folderId, name: basename(targetPath), rel: targetPath, storagePath: targetPath, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', size: st.size, source: 'generated', uploadedBy: actorUserId })
}

export class OfficeDocumentService {
  inspect(roomId: string, ref: string) {
    const { row, kind } = resolveFile(roomId, ref)
    return { file: publicFile(row), kind, capabilities: this.capabilities(kind) }
  }

  capabilities(kind: OfficeKind) {
    if (kind === 'pdf') return ['pdf.read']
    if (kind === 'excel') return ['excel.read', 'excel.write']
    if (kind === 'word') return ['word.read', 'word.write']
    if (kind === 'ppt') return ['ppt.read', 'ppt.write']
    if (kind === 'image') return ['image.read']
    return []
  }

  async read(kind: OfficeKind, roomId: string, ref: string, args: any) {
    const file = resolveFile(roomId, ref)
    if (kind !== 'unknown' && file.kind !== kind) throw { code: 'UNSUPPORTED_FILE_TYPE', message: `Expected ${kind} file, got ${file.kind}` }
    if (file.kind === 'pdf') return { file: publicFile(file.row), kind: file.kind, ...(await readPdfText(file.fullPath, args)) }
    if (file.kind === 'excel') return { file: publicFile(file.row), kind: file.kind, ...(await readExcel(file.fullPath, args)) }
    if (file.kind === 'word') return { file: publicFile(file.row), kind: file.kind, ...(await readWord(file.fullPath, args)) }
    if (file.kind === 'ppt') return { file: publicFile(file.row), kind: file.kind, ...(await readPpt(file.fullPath, args)) }
    throw { code: 'UNSUPPORTED_FILE_TYPE', message: 'Unsupported document type' }
  }

  async write(kind: OfficeKind, roomId: string, actorUserId: string, args: any) {
    if (kind === 'excel') return { file: await writeExcel(roomId, actorUserId, args), kind }
    if (kind === 'word') return { file: await writeWord(roomId, actorUserId, args), kind }
    if (kind === 'ppt') return { file: await writePpt(roomId, actorUserId, args), kind }
    throw { code: 'UNSUPPORTED_FILE_TYPE', message: 'Unsupported document write type' }
  }

  async readImage(roomId: string, agentId: string, actorUserId: string, ref: string, args: any): Promise<{ file: any; kind: 'image'; text: string; usage: AICallResult['usage']; model: string }> {
    const file = resolveFile(roomId, ref)
    if (file.kind !== 'image') throw { code: 'UNSUPPORTED_FILE_TYPE', message: 'Expected image file' }
    const st = await stat(file.fullPath)
    if (st.size > MAX_IMAGE_BYTES) throw { code: 'FILE_TOO_LARGE', message: '图片过大，请压缩到 8MB 以内再读取' }
    const mediaType = file.row.mime_type || (extname(file.row.name).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg')
    if (!IMAGE_MIMES.has(mediaType)) throw { code: 'UNSUPPORTED_FILE_TYPE', message: '当前只支持 png/jpeg/webp/gif 图片读取' }
    const data = (await readFile(file.fullPath)).toString('base64')
    const task = String(args.task || 'describe')
    const prompt = task === 'ocr' ? '请识别图片中的文字，保持原有结构。' : task === 'extract_table' ? '请识别图片中的表格/票据/结构化信息，尽量用 Markdown 表格输出。' : '请用中文描述图片内容，并提取其中的重要文字和关键信息。'
    const result = await modelRuntimeService.callRoomAgentVision({ roomId, agentId, payerUserId: actorUserId, maxTokens: clamp(args.maxTokens, 1200, 4000), content: [{ type: 'text', text: prompt }, { type: 'image', mediaType, data }] })
    return { file: publicFile(file.row), kind: 'image', text: result.text, usage: result.usage, model: result.model }
  }
}

export const officeDocumentService = new OfficeDocumentService()
