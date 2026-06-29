import { useEffect, useState } from 'react'
import { BrainCircuit, Download, Save } from 'lucide-react'
import { api } from '../../../lib/api'
import { requestText } from '../../../lib/api-core'
import type { Message } from '../../room-page-model'

interface MindmapPreviewCardProps {
  msg: Message
  own?: boolean
}

function downloadText(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 500)
}

function buildSrcDoc(preview: any) {
  if (preview?.html) return preview.html
  if (preview?.svg) return `<!doctype html><html><body style="margin:0;background:#f8fafc">${preview.svg}</body></html>`
  return '<!doctype html><html><body style="font-family:sans-serif;color:#64748b;padding:16px">脑图预览不可用</body></html>'
}

export function MindmapPreviewCard({ msg, own }: MindmapPreviewCardProps) {
  const preview = msg.payload?.preview || msg.payload?.artifact?.preview
  const [tmpHtml, setTmpHtml] = useState('')
  const [saving, setSaving] = useState(false)
  const title = preview?.title || '脑图预览'
  const shouldFetchTmp = Boolean(preview?.storage === 'tmp' && preview?.id && msg.roomId && !preview?.html)

  useEffect(() => {
    let cancelled = false
    if (!shouldFetchTmp) return
    requestText(`/rooms/${msg.roomId}/mindmap-previews/${preview.id}/index.html`, { headers: { Accept: 'text/html' } })
      .then((html) => { if (!cancelled) setTmpHtml(String(html || '')) })
      .catch(() => { if (!cancelled) setTmpHtml('') })
    return () => { cancelled = true }
  }, [shouldFetchTmp, msg.roomId, preview?.id])

  if (!preview) return null

  const save = async () => {
    if (!msg.roomId || saving) return
    setSaving(true)
    try {
      await api.saveMindmapPreview(msg.roomId, { previewId: preview.id, title, html: preview.html || tmpHtml, svg: preview.svg, root: preview.root })
      window.alert('脑图已保存到房间文件。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`mt-2 overflow-hidden rounded-2xl border ${own ? 'border-blue-400/40 bg-blue-500/10' : 'border-blue-100 bg-blue-50/40'} shadow-sm`}>
      <div className="flex items-center justify-between gap-2 border-b border-blue-100 bg-white/80 px-3 py-2 text-gray-700">
        <div className="flex min-w-0 items-center gap-2"><BrainCircuit className="h-4 w-4 shrink-0 text-blue-600" /><span className="truncate text-sm font-medium">{title}</span></div>
        <div className="flex shrink-0 items-center gap-1">
          {preview.svg && <button type="button" onClick={() => downloadText(`${title}.svg`, preview.svg, 'image/svg+xml;charset=utf-8')} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-gray-500 hover:bg-blue-50 hover:text-blue-600"><Download className="h-3.5 w-3.5" />SVG</button>}
          <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-60"><Save className="h-3.5 w-3.5" />{saving ? '保存中' : '保存'}</button>
        </div>
      </div>
      <div className="h-[320px] w-full bg-slate-50 sm:h-[420px]">
        <iframe title={title} srcDoc={tmpHtml || buildSrcDoc(preview)} sandbox="allow-scripts" className="h-full w-full border-0" />
      </div>
      <div className="border-t border-blue-100 bg-white/75 px-3 py-2 text-xs text-gray-500">这是临时预览；不保存也可以，下次让 Agent 重新生成即可。</div>
    </div>
  )
}
