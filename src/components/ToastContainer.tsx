import { type ReactNode, useCallback, useState } from 'react'
import { type Toast, ToastComponent, type ToastType } from './Toast'
import './Toast.css'

let toastIdCounter = 0

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((message: ReactNode, type: ToastType = 'info', duration?: number, onClick?: () => void) => {
    const id = `toast-${++toastIdCounter}`
    const toast: Toast = { id, message, type, duration, onClick }
    
    setToasts((prev) => [...prev, toast])
    
    // Return dismiss function for programmatic dismissal
    return () => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return { toasts, showToast, dismissToast }
}

interface ToastContainerProps {
  toasts: Toast[]
  onDismiss: (id: string) => void
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <ToastComponent key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

