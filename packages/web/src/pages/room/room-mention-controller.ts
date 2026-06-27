import { getMemberDisplayName } from './room-ui-utils'
import type { FileNode } from '../room-page-model'

export function createRoomMentionController(input: {
  user: any
  input: string
  inputRef: React.RefObject<HTMLTextAreaElement>
  members: any[]
  roomAgents: any[]
  files: FileNode[]
  mentionFilter: string
  selectedMentions: any[]
  setInput: (value: string) => void
  setShowMentionPopup: (value: boolean) => void
  setMentionFilter: (value: string) => void
  setSelectedMentions: React.Dispatch<React.SetStateAction<any[]>>
}) {
  const allFiles = (nodes: FileNode[]): FileNode[] => nodes.flatMap((node) => node.type === 'directory' ? allFiles(node.children || []) : [node])
  const filteredMembers = input.members.filter((m) => {
    const id = m.id || m.userId
    if (id === input.user?.id) return false
    return getMemberDisplayName(m).toLowerCase().includes(input.mentionFilter)
  })
  const filteredAgents = input.roomAgents.filter((a) => (a.name || '').toLowerCase().includes(input.mentionFilter))
  const filteredFiles = allFiles(input.files).filter((f) => f.name.toLowerCase().includes(input.mentionFilter) || f.path.toLowerCase().includes(input.mentionFilter)).slice(0, 20)

  const buildMentionsForSend = (content: string) => {
    const mentions = [...input.selectedMentions]
    input.members.forEach((m) => {
      const id = m.id || m.userId
      const name = getMemberDisplayName(m)
      if (id && content.includes(`@${name}`) && !mentions.some((x) => x.id === id)) mentions.push({ id, name, role: 'human' })
    })
    input.roomAgents.forEach((a) => {
      if (a.id && content.includes(`@${a.name}`) && !mentions.some((x) => x.id === a.id)) mentions.push({ id: a.id, name: a.name, role: 'ai' })
    })
    allFiles(input.files).forEach((node) => {
      if (content.includes(`@${node.name}`) && !mentions.some((x) => (x.type === 'file' || x.role === 'file') && x.path === node.path)) mentions.push({ id: node.path, name: node.name, role: 'file', type: 'file', path: node.path })
    })
    return mentions.filter((m) => content.includes(`@${m.name}`))
  }

  const insertMention = (target: any, type: 'member' | 'agent' | 'file') => {
    const name = type === 'member' ? getMemberDisplayName(target) : target.name
    const cursorPos = input.inputRef.current?.selectionStart || input.input.length
    const beforeCursor = input.input.slice(0, cursorPos)
    const afterCursor = input.input.slice(cursorPos)
    const atIdx = beforeCursor.lastIndexOf('@')
    input.setInput(beforeCursor.slice(0, atIdx) + `@${name} ` + afterCursor)
    input.setSelectedMentions((prev) => {
      const mention = type === 'file' ? { id: target.path, name, role: 'file', type: 'file', path: target.path } : { id: target.id || target.userId, name, role: type === 'agent' ? 'ai' as const : 'human' as const }
      return prev.some((m) => m.id === mention.id && m.role === mention.role) ? prev : [...prev, mention]
    })
    input.setShowMentionPopup(false)
    input.inputRef.current?.focus()
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    input.setInput(val)
    const cursorPos = e.target.selectionStart || 0
    const beforeCursor = val.slice(0, cursorPos)
    const atMatch = beforeCursor.match(/@([^@\s]*)$/)
    if (atMatch) {
      input.setShowMentionPopup(true)
      input.setMentionFilter(atMatch[1].toLowerCase())
    } else {
      input.setShowMentionPopup(false)
    }
  }

  return { filteredMembers, filteredAgents, filteredFiles, buildMentionsForSend, insertMention, handleInputChange }
}
