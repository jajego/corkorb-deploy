import { createPortal } from 'react-dom'
import { useEffect } from 'react'

import './about-modal.css'

type AboutModalProps = {
  isOpen: boolean
  onClose: () => void
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  // Add/remove class to body to hide tooltips when modal is open
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    if (isOpen) {
      document.body.classList.add('about-modal-open')
      document.addEventListener('keydown', handleKeyDown)
    } else {
      document.body.classList.remove('about-modal-open')
    }
    return () => {
      document.body.classList.remove('about-modal-open')
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  // Use portal to render at body level, ensuring it's after drei's portals in DOM
  return createPortal(
    <div
      className="about-modal-backdrop"
      onClick={handleBackdropClick}
    >
      <div
        className="about-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-modal-title"
      >
        <button
          type="button"
          onClick={onClose}
          className="about-modal__close"
          aria-label="Close About dialog"
        >
          ×
        </button>

        <div className="about-modal__kicker">shared image space</div>
        <h2 id="about-modal-title">About CorkOrb</h2>

        <div className="about-modal__body">
          <p>
            Create a cork, pin pictures to it, and send its link to other people. Everyone visiting the same cork sees
            changes in real time.
          </p>
        </div>

        <section className="about-modal__tips">
          <h3>Tips</h3>
          <ul>
            <li>
                You can use the <strong>Upload</strong> button, or drag an image from your device or browser directly
                onto the window to start pinning.
            </li>
            <li>
                While placing an image, use the <strong>mouse wheel</strong> to scale it, and hold <strong>Shift</strong>{' '}
                + mouse wheel to rotate.
            </li>
            <li>
                Inactive CorkOrbs are automatically deleted; your Corks page shows the current expiration date.
            </li>
            <li>
                Anyone with a link to a CorkOrb can explore it, even if they&apos;re not logged in. Only registered
                users can pin and unpin images.
            </li>
          </ul>
        </section>
      </div>
    </div>,
    document.body
  )
}
