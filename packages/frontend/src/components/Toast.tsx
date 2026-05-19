import { useEffect, useState, createContext, useContext, useCallback, useRef } from 'react'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: string
  type: ToastType
  message: string
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

// Global state for toasts outside of React tree
let globalShowToast: ((message: string, type: ToastType) => void) | null = null

export function useToast() {
  const context = useContext(ToastContext)
  
  // If not in provider, use global fallback
  if (!context) {
    return {
      showToast: (message: string, type: ToastType = 'info') => {
        if (globalShowToast) {
          globalShowToast(message, type)
        }
      }
    }
  }
  return context
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastRefs = useRef<((message: string, type: ToastType) => void)[]>([])

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { id, type, message }])

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4000)
  }, [])

  // Register this provider's showToast globally
  useEffect(() => {
    globalShowToast = showToast
    return () => {
      globalShowToast = null
    }
  }, [showToast])

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [isVisible, setIsVisible] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true))
  }, [])

  const handleClose = () => {
    setIsLeaving(true)
    setTimeout(onClose, 200)
  }

  const icons = {
    success: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
    error: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
    info: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  }

  const colors = {
    success: 'bg-sand-100 border-border-low text-sand-1600',
    error: 'bg-[#b75000]/10 border-[#b75000]/30 text-[#b75000]',
    info: 'bg-sand-100 border-border-low text-sand-1600',
  }

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3 border backdrop-blur-xl
        ${colors[toast.type]}
        transition-all duration-300
        ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'}
        ${isLeaving ? 'translate-x-8 opacity-0' : ''}
        min-w-[280px] max-w-[400px]
        shadow-lg
      `}
    >
      <span className={toast.type === 'error' ? 'text-[#b75000]' : 'text-sand-1600'}>
        {icons[toast.type]}
      </span>
      <p className="text-sm text-sand-1600 flex-1">{toast.message}</p>
      <button
        onClick={handleClose}
        aria-label="Dismiss notification"
        className="text-sand-1100 hover:text-sand-1600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400 focus-visible:ring-offset-1"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
