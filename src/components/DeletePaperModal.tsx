import { createPortal } from 'react-dom'
import { useEffect, useMemo } from 'react'
import { formatTimestamp } from '../utils/formatTimestamp'
import './about-modal.css'

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
    <div className="about-modal-backdrop" onClick={handleBackdropClick}>
      <div
        className="about-modal delete-paper-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-paper-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="delete-paper-modal__kicker">remove pin</div>
        <h2 id="delete-paper-modal-title">
          Are you sure you want to unpin this image?
        </h2>

        {(username || userId || formattedTimestamp) && (
          <div className="delete-paper-modal__byline">
            Pinned by {username || userId || 'Unknown user'}
            {formattedTimestamp && ` at ${formattedTimestamp}`}
          </div>
        )}

        {imageUrl && (
          <div className="delete-paper-modal__preview">
            <img
              src={imageUrl}
              alt="Paper to be deleted"
            />
          </div>
        )}

        <div className="delete-paper-modal__actions">
          <button
            type="button"
            onClick={onCancel}
            className="delete-paper-modal__button"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="delete-paper-modal__button delete-paper-modal__button--confirm"
          >
            Unpin
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

