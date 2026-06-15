import { useRef } from 'react'
import { FileText, Folder, Upload } from 'lucide-react'
import type { FileNode } from '../../room-page-model'

interface RoomFilesPanelProps {
  files: FileNode[]
  currentFile: { path: string; content: string } | null
  setCurrentFile: React.Dispatch<React.SetStateAction<{ path: string; content: string } | null>>
  fileDirty: boolean
  setFileDirty: (value: boolean) => void
  openFile: (node: FileNode) => void
  saveFile: () => void
  deleteFile: (path: string) => void
  createFile: () => void
  createFolder: () => void
  uploadLocalFile: (file: File) => void
}

export function RoomFilesPanel({ files, currentFile, setCurrentFile, fileDirty, setFileDirty, openFile, saveFile, deleteFile, createFile, createFolder, uploadLocalFile }: RoomFilesPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const onPickFiles = (picked: FileList | null) => {
    Array.from(picked || []).forEach(uploadLocalFile)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }
  const renderFileTree = (nodes: FileNode[], depth = 0): React.ReactNode => (
    <div className={depth > 0 ? 'ml-4' : ''}>
      {nodes.map((node) => (
        <div key={node.path}>
          <div className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-blue-50 ${currentFile?.path === node.path ? 'bg-blue-100' : ''}`} onClick={() => node.type === 'directory' ? null : openFile(node)}>
            <span className="text-sm text-gray-500">{node.type === 'directory' ? <Folder className="w-4 h-4" /> : <FileText className="w-4 h-4" />}</span>
            <span className="min-w-0 text-sm flex-1 truncate" title={node.path}>{node.name}</span>
            {node.type === 'file' && <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`确定删除文件“${node.path}”？`)) deleteFile(node.path) }} className="min-w-8 min-h-8 rounded text-xs text-red-400 hover:bg-red-50 hover:text-red-600">×</button>}
          </div>
          {node.type === 'directory' && node.children && renderFileTree(node.children, depth + 1)}
        </div>
      ))}
    </div>
  )

  return (
    <div className="h-full flex">
      <div className={`${currentFile ? 'hidden sm:block' : 'block'} w-full sm:w-64 border-r border-gray-200 bg-white overflow-y-auto p-3 shrink-0`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onPickFiles(e.dataTransfer.files) }}>
        <div className="flex items-center justify-between mb-3">
          <div><h3 className="text-sm font-semibold text-gray-700">文件</h3><p className="text-xs text-gray-400 mt-0.5">仅显示已加入当前 Tab 配置的文件</p></div>
          <div className="flex gap-1"><input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => onPickFiles(e.target.files)} /><button onClick={() => fileInputRef.current?.click()} className="text-xs bg-green-50 text-green-600 px-2 py-1 rounded hover:bg-green-100 inline-flex items-center gap-1"><Upload className="w-3 h-3" />上传</button><button onClick={createFile} className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100">+文件</button><button onClick={createFolder} className="text-xs bg-gray-50 text-gray-600 px-2 py-1 rounded hover:bg-gray-100">+目录</button></div>
        </div>
        {files.length > 0 ? renderFileTree(files) : <div className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-400 text-center">当前 Tab 没有配置要显示的文件</div>}
      </div>
      <div className={`${currentFile ? 'flex' : 'hidden sm:flex'} flex-1 flex-col overflow-hidden`}>
        {currentFile ? <>
          <div className="flex items-center justify-between gap-3 px-4 py-2 bg-white border-b border-gray-200">
            <div className="flex items-center gap-2 min-w-0"><button onClick={() => setCurrentFile(null)} className="sm:hidden text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">← 文件列表</button><span className="min-w-0 text-sm text-gray-600 font-mono truncate" title={currentFile.path}>{currentFile.path}</span>{fileDirty && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">未保存</span>}</div>
            <div className="flex gap-2 shrink-0"><button onClick={saveFile} className="text-xs bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600">保存</button><button onClick={() => setCurrentFile(null)} className="hidden sm:inline text-xs bg-gray-200 text-gray-600 px-3 py-1 rounded hover:bg-gray-300">关闭</button></div>
          </div>
          <textarea value={currentFile.content} onChange={(e) => { setCurrentFile({ ...currentFile, content: e.target.value }); setFileDirty(true) }} className="flex-1 p-4 pb-20 font-mono text-sm resize-none focus:outline-none break-words [overflow-wrap:anywhere]" />
        </> : <div className="flex-1 flex items-center justify-center text-gray-400"><p>选择一个文件以查看/编辑</p></div>}
      </div>
    </div>
  )
}
