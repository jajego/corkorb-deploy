import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import './Toast.css'

export type ToastType = 'error' | 'info' | 'success' | 'warning'

export interface Toast {
  id: string
  message: ReactNode
  type: ToastType
  duration?: number // Duration in ms (default: 5000)
  onClick?: () => void // Optional click handler
}

interface ToastProps {
  toast: Toast
  onDismiss: (id: string) => void
}

const EXIT_ANIMATION_DURATION = 300 // ms

export function ToastComponent({ toast, onDismiss }: ToastProps) {
  const timerRef = useRef<number | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const isRemovingRef = useRef(false)

  const handleDismiss = useCallback(() => {
    if (isRemovingRef.current) return // Already dismissing
    
    isRemovingRef.current = true
    setIsRemoving(true)
    
    // Wait for exit animation to complete before actually removing
    setTimeout(() => {
      onDismiss(toast.id)
    }, EXIT_ANIMATION_DURATION)
  }, [onDismiss, toast.id])

  useEffect(() => {
    const duration = toast.duration ?? 5000
    if (duration > 0) {
      timerRef.current = window.setTimeout(() => {
        handleDismiss()
      }, duration)
    }

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [toast.id, toast.duration, handleDismiss])

  const handleClick = useCallback((event: React.MouseEvent) => {
    // Don't trigger onClick if clicking the dismiss button
    if ((event.target as HTMLElement).closest('.toast__dismiss')) {
      return
    }
    // Don't trigger if toast is being removed
    if (isRemovingRef.current) {
      return
    }
    // Trigger onClick if provided
    if (toast.onClick) {
      toast.onClick()
    }
  }, [toast.onClick, toast.id])

  return (
    <div 
      className={`toast toast--${toast.type} ${isRemoving ? 'toast--removing' : ''} ${toast.onClick ? 'toast--clickable' : ''}`}
      onClick={toast.onClick ? handleClick : undefined}
      style={{ cursor: toast.onClick ? 'pointer' : 'default' }}
    >
      <div className="toast__content">
        <span className="toast__message">{toast.message}</span>
        <button
          className="toast__dismiss"
          onClick={(e) => {
            e.stopPropagation() // Prevent triggering toast onClick
            handleDismiss()
          }}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  )
}

