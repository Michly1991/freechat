import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { api } from '../lib/api'

interface DmMessage {
  id: string
  conversationId: string
  actorId: string
  actorName: string
  content: string
  createdAt: number
}

const CACHE_LIMIT = 100
const cacheKey = (id: string) => `freechat:dm:${id}:messages`

function mergeMessages(...groups: DmMessage[][]): DmMessage[] {
  const map = new Map<string, DmMessage>()
  groups.flat().forEach((m) => { if (m?.id) map.set(m.id, { ...map.get(m.id), ...m }) })
  return Array.from(map.values()).sort((a, b) => a.createdAt - b.createdAt).slice(-CACHE_LIMIT)
}

function readCache(id: string): DmMessage[] {
  try {
    const raw = localStorage.getItem(cacheKey(id))
    return raw ? mergeMessages(JSON.parse(raw)) : []
  } catch { return [] }
}

function writeCache(id: string, messages: DmMessage[]) {
  try { localStorage.setItem(cacheKey(id), JSON.stringify(mergeMessages(messages))) } catch {}
}

function Avatar({ name, avatar, size = 'w-12 h-12' }: { name: string; avatar?: string; size?: string }) {
  return avatar ? (
    <img src={avatar} alt={name} className={`${size} rounded-full object-cover border border-gray-200 shrink-0`} />
  ) : (
    <div className={`${size} rounded-full bg-gradient-to-br from-blue-400 to-purple-500 text-white flex items-center justify-center font-semibold shrink-0`}>
      {(name || '?')[0].toUpperCase()}
    </div>
  )
}

export default function DmPage() {
  const { conversationId } = useParams<{ conversationId: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [conversation, setConversation] = useState<any>(null)
  const [messages, setMessages] = useState<DmMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!conversationId) return
    api.markConversationRead('dm', conversationId).catch(() => {})
    const cached = readCache(conversationId)
    if (cached.length) setMessages(cached)
    loadDm()
  }, [conversationId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const loadDm = async () => {
    if (!conversationId) return
    try {
      const [dm, history] = await Promise.all([api.getDm(conversationId), api.getDmMessages(conversationId, 100)])
      setConversation(dm.conversation)
      setMessages((prev) => {
        const next = mergeMessages(prev, history.messages || [])
        writeCache(conversationId, next)
        return next
      })
    } catch (err: any) {
      alert(err.message || '单聊加载失败')
      navigate('/')
    }
  }

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!conversationId || !input.trim() || sending) return
    try {
      setSending(true)
      const data = await api.sendDmMessage(conversationId, input.trim())
      setInput('')
      setMessages((prev) => {
        const next = mergeMessages(prev, [data.message])
        writeCache(conversationId, next)
        return next
      })
    } catch (err: any) {
      alert(err.message || '发送失败')
    } finally {
      setSending(false)
    }
  }

  const other = conversation?.otherUser
  const otherName = other?.nickname || other?.username || '单聊'

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0">
        <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700">← 返回</button>
        {other && <Avatar name={otherName} avatar={other.avatar} size="w-9 h-9" />}
        <div>
          <h1 className="font-semibold text-gray-800">{otherName}</h1>
          {other?.username && <p className="text-xs text-gray-400">@{other.username}</p>}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => {
          const isOwn = msg.actorId === user?.id
          const name = isOwn ? '我' : otherName
          const avatar = isOwn ? user?.avatar : other?.avatar
          return (
            <div key={msg.id} className={`flex items-end gap-2 ${isOwn ? 'justify-end' : 'justify-start'}`}>
              {!isOwn && <Avatar name={name} avatar={avatar} />}
              <div className={`max-w-[80%] rounded-xl px-4 py-2 ${isOwn ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-800'}`}>
                <div className={`text-xs mb-1 ${isOwn ? 'text-blue-200' : 'text-gray-400'}`}>{name}</div>
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              </div>
              {isOwn && <Avatar name={name} avatar={avatar} />}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </main>

      <form onSubmit={sendMessage} className="p-4 bg-white border-t border-gray-200 shrink-0 flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="输入消息..." className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        <button disabled={sending} className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-60">发送</button>
      </form>
    </div>
  )
}
