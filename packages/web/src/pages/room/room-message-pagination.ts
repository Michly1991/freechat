import type React from 'react'
import { api } from '../../lib/api'
import { addClientLog } from '../../lib/clientLog'
import { mergeMessages, writeCachedMessages, type Message } from '../room-page-model'

export const INITIAL_MESSAGE_LIMIT = 10
export const OLDER_MESSAGE_PAGE_SIZE = 20

interface PaginationDeps {
  roomId?: string
  messages: Message[]
  messagesScrollRef: React.RefObject<HTMLDivElement>
  initialScrollDoneRef: React.MutableRefObject<boolean>
  suppressNextAutoScrollRef: React.MutableRefObject<boolean>
  hasMoreMessages: boolean
  loadingOlderMessages: boolean
  setHasMoreMessages: (value: boolean) => void
  setLoadingOlderMessages: (value: boolean) => void
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  feedback: { error: (message: string) => void }
}

export function createMessagePaginationActions(deps: PaginationDeps) {
  const {
    roomId,
    messages,
    messagesScrollRef,
    initialScrollDoneRef,
    suppressNextAutoScrollRef,
    hasMoreMessages,
    loadingOlderMessages,
    setHasMoreMessages,
    setLoadingOlderMessages,
    setMessages,
    feedback,
  } = deps

  const loadOlderMessages = async () => {
    if (!roomId || loadingOlderMessages || !hasMoreMessages) return
    const oldest = messages.find((msg) => msg.kind !== 'agent_stream')
    const el = messagesScrollRef.current
    if (!oldest || !el) return
    const prevScrollHeight = el.scrollHeight
    const prevScrollTop = el.scrollTop
    setLoadingOlderMessages(true)
    try {
      const res = await api.getRoomMessages(roomId, OLDER_MESSAGE_PAGE_SIZE, oldest.id)
      setHasMoreMessages(res.hasMore !== false)
      suppressNextAutoScrollRef.current = true
      setMessages((prev) => {
        const next = mergeMessages(res.messages || [], prev)
        writeCachedMessages(roomId, next)
        return next
      })
      requestAnimationFrame(() => {
        const current = messagesScrollRef.current
        if (current) current.scrollTop = current.scrollHeight - prevScrollHeight + prevScrollTop
      })
    } catch (err: any) {
      feedback.error(err?.message || '加载历史消息失败')
      addClientLog('error', 'ui', 'load older messages failed', { message: err?.message })
    } finally {
      setLoadingOlderMessages(false)
    }
  }

  const handleMessagesScroll = () => {
    const el = messagesScrollRef.current
    if (!el || !initialScrollDoneRef.current) return
    if (el.scrollTop < 80) void loadOlderMessages()
  }

  return { loadOlderMessages, handleMessagesScroll }
}
