import { createPortal } from 'react-dom'
import { useEffect, useMemo } from 'react'
import { formatTimestamp } from '../utils/formatTimestamp'

type DeletePaperModalProps = {
  isOpen: boolean
  imageUrl: string | null
  username?: string | null
  userId?: string
  createdAt?: string
  onConfirm: () => void
  onCancel: () => void
}

export function DeletePaperModal({ isOpen, imageUrl, username, userId, createdAt, onConfirm, onCancel }: DeletePaperModalProps) {
  // Add/remove class to body to hide tooltips when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('delete-paper-modal-open')
    } else {
      document.body.classList.remove('delete-paper-modal-open')
    }
    return () => {
      document.body.classList.remove('delete-paper-modal-open')
    }
  }, [isOpen])

  // Format timestamp for display
  const formattedTimestamp = useMemo(() => formatTimestamp(createdAt), [createdAt])

  if (!isOpen) return null

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onCancel()
    }
  }

  // Use portal to render at body level, ensuring it's after drei's portals in DOM
  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '20px',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          backgroundColor: 'white',
          padding: '40px',
          borderRadius: '12px',
          border: '3px solid black',
          maxWidth: '500px',
          width: '100%',
          maxHeight: '80vh',
          overflowY: 'auto',
          overflowX: 'hidden',
          position: 'relative',
          fontFamily: 'Courier New, Courier, monospace',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          boxSizing: 'border-box',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          style={{
            fontSize: '24px',
            fontWeight: 'bold',
            margin: 0,
            color: '#333',
            textAlign: 'center',
          }}
        >
          Are you sure you want to unpin this image?
        </h2>

        {(username || userId || formattedTimestamp) && (
          <div
            style={{
              fontSize: '14px',
              color: '#666',
              textAlign: 'center',
              fontStyle: 'italic',
            }}
          >
            Pinned by {username || userId || 'Unknown user'}
            {formattedTimestamp && ` at ${formattedTimestamp}`}
          </div>
        )}

        {imageUrl && (
          <div
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid #ddd',
              backgroundColor: '#f5f5f5',
              minHeight: '200px',
            }}
          >
            <img
              src={imageUrl}
              alt="Paper to be deleted"
              style={{
                maxWidth: '100%',
                maxHeight: '300px',
                objectFit: 'contain',
                display: 'block',
              }}
            />
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'center',
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '12px 24px',
              fontSize: '16px',
              fontWeight: '600',
              color: '#333',
              backgroundColor: 'white',
              border: '2px solid #333',
              borderRadius: '4px',
              cursor: 'pointer',
              fontFamily: 'Courier New, Courier, monospace',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f5f5f5'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'white'
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: '12px 24px',
              fontSize: '16px',
              fontWeight: '600',
              color: 'white',
              backgroundColor: '#d32f2f',
              border: '2px solid #333',
              borderRadius: '4px',
              cursor: 'pointer',
              fontFamily: 'Courier New, Courier, monospace',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#b71c1c'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#d32f2f'
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

