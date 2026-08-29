import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface OrbDebugHudProps {
  connectedUsersCount: number
  connectedUsernames: string[]
  wsStatus: string
  cameraDeltaThetaDeg: string
  cameraDeltaPhiDeg: string
  viewCenterLatLon: { lat: number; lon: number } | null
  pointerLatLon: { lat: number; lon: number } | null
  lastClickLatLon: { lat: number; lon: number } | null
  pendingCenterLatLon: { lat: number; lon: number } | null
  lastImageLatLon: { lat: number; lon: number } | null
  autoRotateEnabled: boolean
  onAutoRotateChange: (enabled: boolean) => void
  autoRotateSpeed: number
  onAutoRotateSpeedChange: (speed: number) => void
  showAllTooltips: boolean
  onShowAllTooltipsChange: (enabled: boolean) => void
  onUploadPhoto: (file: File) => void
  orbId: string
  isSignedIn: boolean
  username: string
  onSignOut: () => void | Promise<void>
  onNavigateToSignIn: () => void
  onNavigateToSignUp: () => void
  anonymousUsersCount: number
  onShowAbout: () => void
}

export function OrbDebugHud({
  autoRotateEnabled,
  onAutoRotateChange,
  autoRotateSpeed,
  onAutoRotateSpeedChange,
  showAllTooltips,
  onShowAllTooltipsChange,
  onUploadPhoto,
  orbId,
  connectedUsersCount,
  connectedUsernames,
  wsStatus,
  isSignedIn,
  username,
  onSignOut,
  onNavigateToSignIn,
  onNavigateToSignUp,
  anonymousUsersCount,
  onShowAbout,
}: OrbDebugHudProps) {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showUsernames, setShowUsernames] = useState(false)

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onUploadPhoto(file)
    event.target.value = ''
  }

  const peopleLabel = wsStatus === 'connected'
    ? `${connectedUsersCount} ${connectedUsersCount === 1 ? 'person' : 'people'} here`
    : 'Connecting'

  return (
    <>
      <header className="orb-hud">
        <button type="button" className="orb-hud__home" onClick={() => navigate('/')}>
          <span aria-hidden="true">←</span>
          <span>CorkOrb</span>
        </button>

        <div className="orb-hud__identity">
          <span>Shared cork</span>
          <strong title={orbId}>{orbId}</strong>
        </div>

        <div className="orb-hud__controls">
          <div className="orb-hud__presence">
            <button
              type="button"
              className="orb-hud__presence-button"
              aria-expanded={showUsernames}
              onClick={() => setShowUsernames((visible) => !visible)}
            >
              <span className={`orb-hud__status-dot${wsStatus === 'connected' ? ' is-connected' : ''}`} />
              {peopleLabel}
            </button>
            {showUsernames && (
              <div className="orb-hud__presence-popover" role="status">
                {connectedUsernames.length > 0 ? connectedUsernames.join(', ') : 'No named visitors'}
                {anonymousUsersCount > 0 && ` · ${anonymousUsersCount} anonymous`}
              </div>
            )}
          </div>

          <label className="orb-hud__toggle" title="Rotate the cork when idle">
            <input
              type="checkbox"
              checked={autoRotateEnabled}
              onChange={(event) => onAutoRotateChange(event.target.checked)}
            />
            <span className="orb-hud__toggle-track" aria-hidden="true" />
            <span>Drift</span>
          </label>

          {autoRotateEnabled && (
            <div className="orb-hud__speeds" aria-label="Drift speed">
              {([['1×', 0.05], ['2×', 0.1], ['5×', 0.25]] as const).map(([label, speed]) => (
                <button
                  key={speed}
                  type="button"
                  className={autoRotateSpeed === speed ? 'is-active' : ''}
                  aria-pressed={autoRotateSpeed === speed}
                  onClick={() => onAutoRotateSpeedChange(speed)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <label className="orb-hud__toggle" title="Keep every image label visible">
            <input
              type="checkbox"
              checked={showAllTooltips}
              onChange={(event) => onShowAllTooltipsChange(event.target.checked)}
            />
            <span className="orb-hud__toggle-track" aria-hidden="true" />
            <span>Labels</span>
          </label>
        </div>

        <button type="button" className="orb-hud__upload" onClick={() => fileInputRef.current?.click()}>
          <span aria-hidden="true">＋</span>
          <span>Pin image</span>
        </button>
        <input
          ref={fileInputRef}
          className="orb-hud__file-input"
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
          onChange={handleFileChange}
          aria-label="Upload image"
        />
      </header>

      <footer className="orb-hud-footer">
        <button type="button" className="orb-hud-footer__about" onClick={onShowAbout}>About</button>
        <div className="orb-hud-footer__account">
          {isSignedIn ? (
            <>
              <span>Signed in as <strong>{username}</strong></span>
              <button type="button" onClick={() => onSignOut()}>Sign out</button>
            </>
          ) : (
            <>
              <span>Want to add something?</span>
              <button type="button" onClick={onNavigateToSignIn}>Log in</button>
              <button type="button" className="is-accent" onClick={onNavigateToSignUp}>Join</button>
            </>
          )}
        </div>
      </footer>
    </>
  )
}
