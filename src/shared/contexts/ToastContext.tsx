import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import {
  ToastProvider as RadixToastProvider,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastViewport,
} from '../components/ui/Toast'

type ToastType = 'default' | 'success' | 'error' | 'warning'

interface ToastState {
  id: string
  title?: string
  description?: string
  type: ToastType
  open: boolean
}

interface ToastContextValue {
  toast: (options: Omit<ToastState, 'id' | 'open'>) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastState[]>([])

  const toast = useCallback((options: Omit<ToastState, 'id' | 'open'>) => {
    const id = Math.random().toString(36).substr(2, 9)
    setToasts(prev => [...prev, { ...options, id, open: true }])

    // Auto-dismiss after 3s
    setTimeout(() => {
      setToasts(prev => prev.map(t => (t.id === id ? { ...t, open: false } : t)))
      // Cleanup after animation
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, 300)
    }, 3000)
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      <RadixToastProvider>
        {children}
        {toasts.map(({ id, title, description, open, type }) => (
          <Toast
            key={id}
            open={open}
            onOpenChange={isOpen => {
              if (!isOpen) {
                setToasts(prev => prev.map(t => (t.id === id ? { ...t, open: false } : t)))
              }
            }}
          >
            <div className="flex gap-4 items-start w-full">
              {/* Colored Dot Indicator based on toast type */}
              {type !== 'default' && (
                <div className="mt-1.5 shrink-0">
                  <span
                    className={
                      'block w-2.5 h-2.5 rounded-full ring-2 ring-white/10 dark:ring-black/20 shadow-sm ' +
                      (type === 'success'
                        ? 'bg-emerald-500 shadow-emerald-500/20'
                        : type === 'error'
                          ? 'bg-red-500 shadow-red-500/20'
                          : type === 'warning'
                            ? 'bg-amber-500 shadow-amber-500/20'
                            : '')
                    }
                  />
                </div>
              )}

              <div className="grid gap-1 flex-1">
                {title && <ToastTitle>{title}</ToastTitle>}
                {description && <ToastDescription>{description}</ToastDescription>}
              </div>
            </div>
            <ToastClose />
          </Toast>
        ))}
        <ToastViewport />
      </RadixToastProvider>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
