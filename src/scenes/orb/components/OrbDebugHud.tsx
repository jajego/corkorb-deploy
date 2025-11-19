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

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      onUploadPhoto(file)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <>
    <div className="info-bar">
      <button
        type="button"
        onClick={() => navigate('/')}
        style={{
          padding: '11px 12px',
          fontSize: '14px',
          fontFamily: 'inherit',
          fontWeight: 600,
          border: '1px solid black',
          borderRadius: '4px',
          backgroundColor: 'white',
          color: 'black',
          cursor: 'pointer',
          pointerEvents: 'auto',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = '#f5f5f5'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'white'
        }}
      >
        Home
      </button>
      <div className="info-bar-content">
        <strong>
          CorkOrb <span>{orbId}</span>
        </strong>
        <strong>|</strong>
        <div className="info-line">
          {wsStatus === 'connected' ? (
            <>
              <strong>Connected</strong>{' '}
              <span
                style={{
                  marginLeft: '4px',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
                onClick={() => setShowUsernames(!showUsernames)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.fontWeight = '600'
                  e.currentTarget.style.textDecoration = 'underline'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.fontWeight = '400'
                  e.currentTarget.style.textDecoration = 'none'
                }}
              >
                {showUsernames ? (
                  <>
                    {connectedUsernames.length > 0 ? (
                      connectedUsernames.join(', ')
                    ) : (
                      'No users'
                    )}
                    {anonymousUsersCount > 0 && <> ({anonymousUsersCount} anonymous)</>}
                  </>
                ) : (
                  <>
                    {connectedUsersCount} {connectedUsersCount === 1 ? 'user' : 'users'}
                    {anonymousUsersCount > 0 && <> ({anonymousUsersCount} anonymous)</>}
                  </>
                )}
              </span>
            </>
          ) : (
            <span>Connecting...</span>
          )}
        </div>
        <label>
          <strong>|</strong>
        </label>
        <label>
          <input
            type="checkbox"
            checked={autoRotateEnabled}
            onChange={(event) => onAutoRotateChange(event.target.checked)}
          />
          Auto rotate
        </label>
        {autoRotateEnabled && (
          <>
            <button
              type="button"
              onClick={() => onAutoRotateSpeedChange(0.05)}
              style={{
                padding: '2px 8px',
                fontSize: '12px',
                fontFamily: 'inherit',
                fontWeight: autoRotateSpeed === 0.05 ? 700 : 500,
                border: '1px dotted black',
                borderRadius: '4px',
                backgroundColor: autoRotateSpeed === 0.05 ? '#f0f0f0' : 'white',
                color: 'black',
                cursor: 'pointer',
                pointerEvents: 'auto',
              }}
              onMouseEnter={(e) => {
                if (autoRotateSpeed !== 0.05) {
                  e.currentTarget.style.backgroundColor = '#f5f5f5'
                }
              }}
              onMouseLeave={(e) => {
                if (autoRotateSpeed !== 0.05) {
                  e.currentTarget.style.backgroundColor = 'white'
                }
              }}
            >
              1x
            </button>
            <button
              type="button"
              onClick={() => onAutoRotateSpeedChange(0.1)}
              style={{
                padding: '2px 8px',
                fontSize: '12px',
                fontFamily: 'inherit',
                fontWeight: autoRotateSpeed === 0.1 ? 700 : 500,
                border: '1px dotted black',
                borderRadius: '4px',
                backgroundColor: autoRotateSpeed === 0.1 ? '#f0f0f0' : 'white',
                color: 'black',
                cursor: 'pointer',
                pointerEvents: 'auto',
              }}
              onMouseEnter={(e) => {
                if (autoRotateSpeed !== 0.1) {
                  e.currentTarget.style.backgroundColor = '#f5f5f5'
                }
              }}
              onMouseLeave={(e) => {
                if (autoRotateSpeed !== 0.1) {
                  e.currentTarget.style.backgroundColor = 'white'
                }
              }}
            >
              2x
            </button>
            <button
              type="button"
              onClick={() => onAutoRotateSpeedChange(0.25)}
              style={{
                padding: '2px 8px',
                fontSize: '12px',
                fontFamily: 'inherit',
                fontWeight: autoRotateSpeed === 0.25 ? 700 : 500,
                border: '1px dotted black',
                borderRadius: '4px',
                backgroundColor: autoRotateSpeed === 0.25 ? '#f0f0f0' : 'white',
                color: 'black',
                cursor: 'pointer',
                pointerEvents: 'auto',
              }}
              onMouseEnter={(e) => {
                if (autoRotateSpeed !== 0.25) {
                  e.currentTarget.style.backgroundColor = '#f5f5f5'
                }
              }}
              onMouseLeave={(e) => {
                if (autoRotateSpeed !== 0.25) {
                  e.currentTarget.style.backgroundColor = 'white'
                }
              }}
            >
              5x
            </button>
          </>
        )}
        <label>
          <strong>|</strong>
        </label>
        <label>
          <input
            type="checkbox"
            checked={showAllTooltips}
            onChange={(event) => onShowAllTooltipsChange(event.target.checked)}
          />
          Show all tooltips
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
          style={{ display: 'none' }}
          onChange={handleFileChange}
          aria-label="Upload image"
        />
        
      </div>
      <button
          type="button"
          onClick={handleUploadClick}
          style={{
            padding: '11px 12px',
            fontSize: '14px',
            fontFamily: 'inherit',
            fontWeight: 600,
            border: '1px solid black',
            borderRadius: '4px',
            backgroundColor: 'white',
            color: 'black',
            cursor: 'pointer',
            pointerEvents: 'auto',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#f5f5f5'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'white'
          }}
        >
          Upload
        </button>
    </div>
    <div className="info-bar info-bar-bottom">
      <div className="info-bar-content about-button" onClick={onShowAbout}>
        about
      </div>
      <div className="info-bar-content">
        {isSignedIn ? (
          <>
            Logged in as <span style={{ fontWeight: 600 }}>{username}</span>{' '}
            |
            <button
              type="button"
              onClick={() => {
                onSignOut()
              }}
              style={{
                padding: '2px 6px',
                fontSize: '14px',
                fontFamily: 'inherit',
                fontWeight: 500,
                border: 'none',
                background: 'none',
                color: 'black',
                cursor: 'pointer',
                textDecoration: 'underline',
                pointerEvents: 'auto',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.fontWeight = '600'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.fontWeight = '500'
              }}
            >
              Sign Out
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onNavigateToSignIn}
              style={{
                padding: '2px 6px',
                fontSize: '14px',
                fontFamily: 'inherit',
                fontWeight: 500,
                border: 'none',
                background: 'none',
                color: 'black',
                cursor: 'pointer',
                textDecoration: 'underline',
                pointerEvents: 'auto',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.fontWeight = '600'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.fontWeight = '500'
              }}
            >
              Login
            </button>
            or
            <button
              type="button"
              onClick={onNavigateToSignUp}
              style={{
                padding: '2px 6px',
                fontSize: '14px',
                fontFamily: 'inherit',
                fontWeight: 500,
                border: 'none',
                background: 'none',
                color: 'black',
                cursor: 'pointer',
                textDecoration: 'underline',
                pointerEvents: 'auto',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.fontWeight = '600'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.fontWeight = '500'
              }}
            >
              Sign Up
            </button>
            to pin images to the CorkOrb.
          </>
        )}
      </div>
    </div>
    </>
  )
}

