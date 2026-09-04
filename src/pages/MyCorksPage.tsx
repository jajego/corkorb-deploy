import { useAuth } from '@clerk/react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'

import type { CorkShape } from '../types/orb'
import '../components/about-modal.css'
import './my-corks.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

type CorkSummary = {
  id: string
  shape: CorkShape
  paper_count: number
  max_papers: number
  expires_at: string
}

type MyCorksResponse = {
  created: CorkSummary[]
  contributed: CorkSummary[]
}

type CorkCollection = keyof MyCorksResponse

const PAGE_SIZE = 9

function expirationLabel(expiresAt: string) {
  const milliseconds = new Date(expiresAt).getTime() - Date.now()
  if (milliseconds <= 0) return 'Expired'
  const hours = Math.max(1, Math.ceil(milliseconds / 3_600_000))
  return hours < 24 ? `${hours}h` : `${Math.ceil(hours / 24)}d`
}

function CorkCard({ cork }: { cork: CorkSummary }) {
  const expires = expirationLabel(cork.expires_at)

  return (
    <Link
      className="cork-card"
      to={`/o/${cork.id}`}
      state={{ shape: cork.shape }}
      aria-label={`${cork.id}, ${cork.shape}, ${cork.paper_count} of ${cork.max_papers} images, ${expires === 'Expired' ? 'expired' : `expires in ${expires}`}`}
    >
      <span className={`cork-card__shape cork-card__shape--${cork.shape}`} aria-hidden="true">
        {cork.shape === 'pyramid' && (
          <svg className="cork-card__outline" viewBox="0 0 100 86.6" preserveAspectRatio="none">
            <polygon points="50,1 99,85.6 1,85.6" />
          </svg>
        )}
      </span>
      <strong>{cork.id}</strong>
      <span className="cork-card__meta">
        <span>{cork.paper_count}/{cork.max_papers}</span>
        <span className="cork-card__expiry" title={new Date(cork.expires_at).toLocaleString()}>{expires}</span>
      </span>
    </Link>
  )
}

function CorkGrid({
  corks,
  page,
  onPageChange,
  panelId,
  labelledBy,
}: {
  corks: CorkSummary[]
  page: number
  onPageChange: (page: number) => void
  panelId: string
  labelledBy: string
}) {
  const pageCount = Math.max(1, Math.ceil(corks.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const visibleCorks = corks.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

  return (
    <section className="cork-list-section" id={panelId} role="tabpanel" aria-labelledby={labelledBy}>
      {corks.length ? (
        <>
          <div className="cork-list">
            {visibleCorks.map((cork) => <CorkCard key={cork.id} cork={cork} />)}
          </div>
          {pageCount > 1 && (
            <nav className="cork-pagination" aria-label="Cork pages">
              <button
                type="button"
                aria-label="Previous page"
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage === 0}
              >
                ←
              </button>
              <span>{currentPage + 1} / {pageCount}</span>
              <button
                type="button"
                aria-label="Next page"
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage === pageCount - 1}
              >
                →
              </button>
            </nav>
          )}
        </>
      ) : (
        <p className="cork-list-empty">Nothing here yet.</p>
      )}
    </section>
  )
}

type MyCorksModalProps = {
  isOpen: boolean
  onClose: () => void
}

export function MyCorksModal({ isOpen, onClose }: MyCorksModalProps) {
  const { getToken } = useAuth()
  const [data, setData] = useState<MyCorksResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeCollection, setActiveCollection] = useState<CorkCollection>('created')
  const [page, setPage] = useState(0)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    if (isOpen) {
      document.body.classList.add('about-modal-open')
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.body.classList.remove('about-modal-open')
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) return
    const controller = new AbortController()

    async function loadCorks() {
      try {
        setError(null)
        setData(null)
        const token = await getToken()
        const response = await fetch(`${API_BASE_URL}/api/me/orbs`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('Could not load your corks')
        setData(await response.json())
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load your corks')
        }
      }
    }

    loadCorks()
    return () => controller.abort()
  }, [getToken, isOpen])

  useEffect(() => {
    setPage(0)
  }, [activeCollection])

  if (!isOpen) return null

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose()
  }

  return createPortal(
    <div className="about-modal-backdrop" onClick={handleBackdropClick}>
      <div className="about-modal my-corks-modal" role="dialog" aria-modal="true" aria-labelledby="my-corks-modal-title">
        <button type="button" className="about-modal__close" onClick={onClose} aria-label="Close My corks dialog">×</button>
        <header className="my-corks-header">
          <div>
            <div className="my-corks-kicker">shared image space</div>
            <h2 id="my-corks-modal-title">My corks</h2>
          </div>
        </header>

        {error ? (
          <div className="my-corks-message" role="alert">{error}</div>
        ) : !data ? (
          <div className="my-corks-message" role="status">Looking for your corks…</div>
        ) : (
          <div className="my-corks-sections">
            <div className="my-corks-tabs" role="tablist" aria-label="Cork collections">
              {(['created', 'contributed'] as const).map((collection) => {
                const label = collection === 'created' ? 'Created by you' : 'Contributed to'
                const selected = activeCollection === collection
                return (
                  <button
                    type="button"
                    role="tab"
                    id={`my-corks-${collection}-tab`}
                    aria-controls={`my-corks-${collection}-panel`}
                    aria-selected={selected}
                    className={selected ? 'is-active' : undefined}
                    onClick={() => setActiveCollection(collection)}
                    key={collection}
                  >
                    {label} <span>{data[collection].length}</span>
                  </button>
                )
              })}
            </div>
            <CorkGrid
              corks={data[activeCollection]}
              page={page}
              onPageChange={setPage}
              panelId={`my-corks-${activeCollection}-panel`}
              labelledBy={`my-corks-${activeCollection}-tab`}
            />
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
