import React, { useEffect, useRef, useState } from 'react'

export type SwipeAction = {
  label: string
  color?: 'blue' | 'gray' | 'red' | 'amber'
  onClick: () => void | Promise<void>
}

const colorClass: Record<NonNullable<SwipeAction['color']>, string> = {
  blue: 'bg-blue-500 text-white',
  gray: 'bg-gray-500 text-white',
  red: 'bg-red-500 text-white',
  amber: 'bg-amber-500 text-white',
}

export function SwipeActionItem({
  id,
  openId,
  setOpenId,
  actions,
  children,
}: {
  id: string
  openId: string | null
  setOpenId: (id: string | null) => void
  actions: SwipeAction[]
  children: React.ReactNode
}) {
  const actionWidth = actions.length * 72
  const isOpen = openId === id
  const [dragX, setDragX] = useState(0)
  const startX = useRef(0)
  const startY = useRef(0)
  const dragging = useRef(false)
  const horizontal = useRef(false)

  useEffect(() => {
    setDragX(isOpen ? -actionWidth : 0)
  }, [isOpen, actionWidth])

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    startX.current = t.clientX
    startY.current = t.clientY
    dragging.current = true
    horizontal.current = false
  }

  const onTouchMove = (e: React.TouchEvent) => {
    if (!dragging.current) return
    const t = e.touches[0]
    const dx = t.clientX - startX.current
    const dy = t.clientY - startY.current
    if (!horizontal.current && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) horizontal.current = true
    if (!horizontal.current) return
    const base = isOpen ? -actionWidth : 0
    const next = Math.min(0, Math.max(-actionWidth, base + dx))
    setDragX(next)
  }

  const onTouchEnd = () => {
    if (!dragging.current) return
    dragging.current = false
    if (dragX < -actionWidth / 3) {
      setOpenId(id)
      setDragX(-actionWidth)
    } else {
      setOpenId(null)
      setDragX(0)
    }
  }

  return (
    <div className="relative overflow-hidden bg-white">
      <div className="absolute inset-y-0 right-0 flex">
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={async (e) => {
              e.stopPropagation()
              await action.onClick()
              setOpenId(null)
            }}
            className={`w-[72px] text-xs font-medium ${colorClass[action.color || 'gray']}`}
          >
            {action.label}
          </button>
        ))}
      </div>
      <div
        className="relative bg-white transition-transform duration-200 ease-out"
        style={{ transform: `translateX(${dragX}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={() => {
          if (isOpen) setOpenId(null)
        }}
      >
        {children}
      </div>
    </div>
  )
}
