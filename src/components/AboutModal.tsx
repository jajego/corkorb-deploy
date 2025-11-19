import { createPortal } from 'react-dom'
import { useEffect } from 'react'

type AboutModalProps = {
  isOpen: boolean
  onClose: () => void
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  // Add/remove class to body to hide tooltips when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('about-modal-open')
    } else {
      document.body.classList.remove('about-modal-open')
    }
    return () => {
      document.body.classList.remove('about-modal-open')
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose()
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
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          backgroundColor: 'white',
          padding: '40px',
          borderRadius: '12px',
          border: '3px solid black',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '80vh',
          overflowY: 'auto',
          position: 'relative',
          fontFamily: 'Courier New, Courier, monospace',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            background: 'none',
            border: 'none',
            fontSize: '28px',
            cursor: 'pointer',
            color: '#333',
            padding: '0',
            width: '30px',
            height: '30px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Courier New, Courier, monospace',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#000'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#333'
          }}
          aria-label="Close About dialog"
        >
          ×
        </button>

        <h2
          style={{
            fontSize: '32px',
            fontWeight: 'bold',
            marginBottom: '20px',
            color: '#333',
            marginTop: '0',
          }}
        >
          About CorkOrb
        </h2>

        <div
          style={{
            fontSize: '16px',
            color: '#666',
            lineHeight: '1.6',
          }}
        >
          <p style={{ marginBottom: '16px' }}>
            CorkOrb is an experimental, collaborative 3D space where users can create their own orb and pin images to it.
            Up to 64 users can be connected to a CorkOrb, and updates are broadcast to all connected users in real-time.
            A CorkOrb is a shared, living object that can be explored and contributed to by all connected users.
          </p>
        </div>

        <div
          style={{
            marginTop: '32px',
            paddingTop: '20px',
            borderTop: '1px dashed #ddd',
          }}
        >
          <h3
            style={{
              fontSize: '18px',
              fontWeight: 700,
              margin: '0 0 12px 0',
              color: '#333',
              textAlign: 'left',
            }}
          >
            Tips
          </h3>
          <div
            style={{
              display: 'grid',
              rowGap: '10px',
              textAlign: 'left',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
              }}
            >
              <span
                style={{
                  marginTop: '4px',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: '#333',
                  flexShrink: 0,
                }}
              />
              <span>
                You can use the <strong>Upload</strong> button, or drag an image from your device or browser directly
                onto the window to start pinning.
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
              }}
            >
              <span
                style={{
                  marginTop: '4px',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: '#333',
                  flexShrink: 0,
                }}
              />
              <span>
                While placing an image, use the <strong>mouse wheel</strong> to scale it, and hold <strong>Shift</strong>{' '}
                + mouse wheel to rotate.
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
              }}
            >
              <span
                style={{
                  marginTop: '4px',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: '#333',
                  flexShrink: 0,
                }}
              />
              <span>
                CorkOrbs are automatically deleted after <strong>1 week</strong> of inactivity.
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
              }}
            >
              <span
                style={{
                  marginTop: '4px',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: '#333',
                  flexShrink: 0,
                }}
              />
              <span>
                Anyone with a link to a CorkOrb can explore it, even if they&apos;re not logged in. Only registered
                users can pin and unpin images.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}


