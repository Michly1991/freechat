import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

type Toast = {
  id: string
  type: ToastType
  message: string
}

type ConfirmOptions = {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

type ConfirmState = ConfirmOptions & {
  resolve: (value: boolean) => void
}

type FeedbackContextValue = {
  toast: (type: ToastType, message: string) => void
  success: (message: string) => void
  error: (message: string) => void
  warning: (message: string) => void
  info: (message: string) => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null)

const styles: Record<ToastType, string> = {
  success: 'bg-green-600 text-white',
  error: 'bg-red-600 text-white',
  warning: 'bg-amber-500 text-white',
  info: 'bg-gray-900 text-white',
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  const toast = useCallback((type: ToastType, message: string) => {
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`
    setToasts((prev) => [...prev, { id, type, message }].slice(-5))
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3500)
  }, [])

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...options, resolve })
    })
  }, [])

  const closeConfirm = (value: boolean) => {
    setConfirmState((state) => {
      state?.resolve(value)
      return null
    })
  }

  const value = useMemo<FeedbackContextValue>(() => ({
    toast,
    success: (message) => toast('success', message),
    error: (message) => toast('error', message),
    warning: (message) => toast('warning', message),
    info: (message) => toast('info', message),
    confirm,
  }), [toast, confirm])

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-3 top-3 z-[80] flex w-[calc(100vw-24px)] max-w-sm flex-col gap-2 sm:right-4 sm:top-4">
        {toasts.map((item) => (
          <div key={item.id} className={`rounded-lg px-4 py-3 text-sm shadow-lg ${styles[item.type]}`}>
            {item.message}
          </div>
        ))}
      </div>
      {confirmState && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl">
            <div className="p-5">
              <h3 className="text-base font-semibold text-gray-900">{confirmState.title}</h3>
              {confirmState.message && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-500">{confirmState.message}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <button onClick={() => closeConfirm(false)} className="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-600 hover:bg-gray-200">
                {confirmState.cancelText || '取消'}
              </button>
              <button
                onClick={() => closeConfirm(true)}
                className={`rounded-lg px-4 py-2 text-sm text-white ${confirmState.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
              >
                {confirmState.confirmText || '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  )
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext)
  if (!ctx) throw new Error('useFeedback must be used within FeedbackProvider')
  return ctx
}
