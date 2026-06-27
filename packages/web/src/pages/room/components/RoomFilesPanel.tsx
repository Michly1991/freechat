import { useState, useRef, type ChangeEvent } from 'react'
import { FileText, Folder, Image, Film, Music, Archive, Search, Upload, FolderPlus, Download, Trash2, ChevronRight, ChevronDown } from 'lucide-react'

interface FileNode {
  id: string
  name: string
  type: 'file' | 'directory'
  size?: number
  createdAt?: number
  updatedAt?: number
  path?: string
  children?: FileNode[]
  expanded?: boolean
}

interface RoomFilesPanelProps {
  files: FileNode[]
  currentFile?: FileNode | null
  setCurrentFile?: (file: FileNode | null) => void
  fileDirty?: boolean
  setFileDirty?: (dirty: boolean) => void
  openFile?: (file: FileNode) => void
  saveFile?: (file: FileNode, content: string) => void
  onUpload?: (file: File, folder?: string) => void
  onDownload?: (file: FileNode) => void
  onDelete?: (file: FileNode) => void
  deleteFile?: (path: string) => void
  createFile?: (name?: string, folder?: string) => void
  createFolder?: (name?: string) => void
  uploadLocalFile?: (file: File, folder?: string) => void
  onNewFolder?: (name: string) => void
  uploading?: boolean
}

const getFileIcon = (file: FileNode) => {
  if (file.type === 'directory' || !file.type) {
    return <Folder className="w-5 h-5 text-yellow-500" />
  }
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext || '')) return <Image className="w-5 h-5 text-blue-500" />
  if (['mp4', 'webm', 'avi', 'mov'].includes(ext || '')) return <Film className="w-5 h-5 text-purple-500" />
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext || '')) return <Music className="w-5 h-5 text-green-500" />
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext || '')) return <Archive className="w-5 h-5 text-orange-500" />
  return <FileText className="w-5 h-5 text-gray-400" />
}

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const formatFileDate = (ts?: number): string => {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function RoomFilesPanel(props: RoomFilesPanelProps) {
  const { files, onUpload, onDownload, onDelete, onNewFolder, uploading, deleteFile, uploadLocalFile, createFolder, openFile } = props
  const [search, setSearch] = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const toggleExpand = (key: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase())
  )

  const uploadHandler = onUpload || uploadLocalFile
  const createFolderHandler = onNewFolder || createFolder
  const handleDelete = (file: FileNode) => {
    if (onDelete) return onDelete(file)
    if (deleteFile) return deleteFile(file.path || file.name)
  }
  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files ? Array.from(event.target.files) : []
    selected.forEach((file) => uploadHandler?.(file))
    event.target.value = ''
  }

  const renderFileRow = (file: FileNode, depth = 0) => {
    const isDirectory = file.type === 'directory' || !file.type
    const hasChildren = isDirectory && file.children && file.children.length > 0
    const uniqueKey = file.id || `${file.name}-${depth}`
    const isExpanded = expandedIds.has(uniqueKey)
    const matchesSearch = file.name.toLowerCase().includes(search.toLowerCase())
    const childrenMatchSearch = file.children?.some((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    if (search && !matchesSearch && !childrenMatchSearch) return null

    return (
      <div key={uniqueKey}>
        <div
          onClick={() => {
            if (isDirectory && hasChildren) toggleExpand(uniqueKey)
            else if (!isDirectory) openFile?.(file)
          }}
          className={`flex items-center gap-3 px-3 py-3 hover:bg-gray-50 border-b border-gray-100 transition active:bg-gray-100 ${isDirectory && hasChildren ? 'cursor-pointer' : !isDirectory && openFile ? 'cursor-pointer' : ''}`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
          {isDirectory && hasChildren && (
            <span className="text-gray-400 w-4 flex-shrink-0">
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </span>
          )}
          {!isDirectory || !hasChildren ? <span className="w-4 flex-shrink-0" /> : null}
          <span className="flex-shrink-0">{getFileIcon(file)}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-800 truncate font-medium">{file.name}</p>
            {file.type === 'file' && <p className="text-xs text-gray-400 mt-0.5">{formatFileSize(file.size)} · {formatFileDate(file.updatedAt)}</p>}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {file.type === 'file' && (onDownload || props.onDownload) && (
              <button onClick={(e) => { e.stopPropagation(); (onDownload || props.onDownload)?.(file) }} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-blue-600" title="下载">
                <Download className="w-4 h-4" />
              </button>
            )}
            {(onDelete || deleteFile || props.onDelete) && (
              <button onClick={(e) => { e.stopPropagation(); handleDelete(file) }} className="p-2 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600" title="删除">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        {isDirectory && isExpanded && file.children?.map((child, index) => renderFileRow(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="p-3 sm:p-4 border-b border-gray-200 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-800">文件管理</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowNewFolder(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 text-sm">
              <FolderPlus className="w-4 h-4" />新建文件夹
            </button>
            <button onClick={() => fileInputRef.current?.click()} disabled={!uploadHandler} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
              <Upload className="w-4 h-4" />上传
            </button>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileInputChange} />
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索文件..."
            className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none"
          />
        </div>

        {showNewFolder && (
          <div className="flex gap-2">
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="文件夹名称"
              className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none"
              onKeyDown={(e) => e.key === 'Enter' && (createFolderHandler?.(newFolderName), setShowNewFolder(false), setNewFolderName(''))}
              autoFocus
            />
            <button onClick={() => { createFolderHandler?.(newFolderName); setShowNewFolder(false); setNewFolderName('') }} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm hover:bg-blue-700">
              创建
            </button>
            <button onClick={() => { setShowNewFolder(false); setNewFolderName('') }} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm hover:bg-gray-200">
              取消
            </button>
          </div>
        )}
      </div>

      {uploading && <div className="px-4 py-2 bg-blue-50 text-blue-600 text-sm">上传中...</div>}

      <div className="flex-1 overflow-y-auto">
        {filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Folder className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">暂无文件</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filteredFiles.map((file) => renderFileRow(file))}
          </div>
        )}
      </div>
    </div>
  )
}
