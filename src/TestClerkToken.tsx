import { SignIn, SignUp, useAuth } from '@clerk/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'

import { createLogger } from './utils/logger'

const logger = createLogger('TestClerkToken')

export function TestClerkToken() {
  const { getToken, isSignedIn, userId } = useAuth()
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const isSignUp = location.pathname === '/test-token/sign-up'
  const [showSignUp, setShowSignUp] = useState(isSignUp)

  // Sync state with URL path
  useEffect(() => {
    setShowSignUp(location.pathname === '/test-token/sign-up')
  }, [location.pathname])
  
  const handleGetToken = async () => {
    if (isSignedIn) {
      try {
        // Get token using the custom 'corkorb' template
        // This template should have a longer expiration time configured in Clerk
        const jwtToken = await getToken({ template: 'corkorb' })
        setToken(jwtToken || null)
        logger.debug(`JWT Token retrieved for user: ${userId}`)
        
        // Decode and show expiration info
        if (jwtToken) {
          try {
            const parts = jwtToken.split('.')
            if (parts.length === 3) {
              const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
              const exp = payload.exp
              const iat = payload.iat
              const now = Math.floor(Date.now() / 1000)
              const lifetime = exp - iat
              const remaining = exp - now
              logger.info(`Token lifetime: ${Math.floor(lifetime / 60)} minutes, remaining: ${Math.floor(remaining / 60)} minutes`)
            }
          } catch {
            // Ignore decode errors
          }
        }
      } catch (error) {
        logger.error('Error getting token', error)
        alert(`Error getting token: ${error}`)
      }
    }
  }
  
  const handleCopyToken = () => {
    if (token) {
      navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }
  
  if (!isSignedIn) {
    return (
      <div style={{ padding: '20px', maxWidth: '600px', margin: '20px auto' }}>
        <h2>Get JWT Token for Testing</h2>
        <p>Please sign in first to get a JWT token.</p>
        
        <div style={{ marginTop: '20px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <button
            onClick={() => {
              navigate('/test-token/sign-in')
              setShowSignUp(false)
            }}
            style={{
              padding: '8px 16px',
              backgroundColor: showSignUp ? '#f0f0f0' : '#4CAF50',
              color: showSignUp ? '#333' : 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Sign In
          </button>
          <button
            onClick={() => {
              navigate('/test-token/sign-up')
              setShowSignUp(true)
            }}
            style={{
              padding: '8px 16px',
              backgroundColor: showSignUp ? '#4CAF50' : '#f0f0f0',
              color: showSignUp ? 'white' : '#333',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Sign Up
          </button>
        </div>
        
        <div style={{ marginTop: '20px' }}>
          {showSignUp ? (
            <SignUp
              routing="virtual"
              signInUrl="/test-token/sign-in"
              fallbackRedirectUrl="/test-token"
              appearance={{
                elements: {
                  rootBox: {
                    margin: '0 auto',
                  },
                },
              }}
            />
          ) : (
            <SignIn
              routing="virtual"
              signUpUrl="/test-token/sign-up"
              fallbackRedirectUrl="/test-token"
              appearance={{
                elements: {
                  rootBox: {
                    margin: '0 auto',
                  },
                },
              }}
            />
          )}
        </div>
      </div>
    )
  }
  
  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '20px auto', backgroundColor: '#f9f9f9', borderRadius: '8px' }}>
      <h2>Get JWT Token for Testing</h2>
      <p><strong>User ID:</strong> {userId}</p>
      <button 
        onClick={handleGetToken} 
        style={{ 
          padding: '10px 20px', 
          margin: '10px 0',
          backgroundColor: '#4CAF50',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer'
        }}
      >
        Get JWT Token
      </button>
      {token && (
        <div style={{ marginTop: '20px' }}>
          <p><strong>JWT Token:</strong></p>
          {(() => {
            try {
              const parts = token.split('.')
              if (parts.length === 3) {
                const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
                const exp = payload.exp
                const iat = payload.iat
                const now = Math.floor(Date.now() / 1000)
                const lifetime = exp - iat
                const remaining = exp - now
                const lifetimeMinutes = Math.floor(lifetime / 60)
                const remainingMinutes = Math.floor(remaining / 60)
                const isExpired = remaining <= 0
                
                return (
                  <div style={{ marginBottom: '10px', padding: '10px', backgroundColor: isExpired ? '#ffebee' : '#e8f5e9', borderRadius: '4px' }}>
                    <p style={{ margin: '0', fontWeight: 'bold', color: isExpired ? '#c62828' : '#2e7d32' }}>
                      {isExpired 
                        ? `⚠️ Token EXPIRED ${Math.abs(remainingMinutes)} minutes ago` 
                        : `✓ Token expires in ${remainingMinutes} minutes`}
                    </p>
                    <p style={{ margin: '5px 0 0 0', fontSize: '12px', color: '#666' }}>
                      Token lifetime: {lifetimeMinutes} minutes | Issued: {new Date(iat * 1000).toLocaleTimeString()} | Expires: {new Date(exp * 1000).toLocaleTimeString()}
                    </p>
                  </div>
                )
              }
            } catch {
              // Ignore decode errors
            }
            return null
          })()}
          <textarea 
            readOnly 
            value={token} 
            style={{ 
              width: '100%', 
              height: '150px', 
              padding: '10px',
              fontFamily: 'monospace',
              fontSize: '12px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              backgroundColor: 'white'
            }} 
          />
          <button 
            onClick={handleCopyToken}
            style={{ 
              padding: '10px 20px', 
              margin: '10px 0',
              backgroundColor: copied ? '#4CAF50' : '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {copied ? 'Copied!' : 'Copy Token'}
          </button>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '10px', backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
            <p><strong>To use this token in backend tests:</strong></p>
            <pre style={{ backgroundColor: '#f0f0f0', padding: '10px', borderRadius: '4px', overflow: 'auto' }}>
              <code>cd api</code>
              <code>{'\n'}.\.venv\Scripts\python.exe test_websocket.py test_orb &lt;token&gt;</code>
            </pre>
            <p style={{ marginTop: '10px' }}>
              <strong>Or test authentication:</strong>
            </p>
            <pre style={{ backgroundColor: '#f0f0f0', padding: '10px', borderRadius: '4px', overflow: 'auto' }}>
              <code>cd api</code>
              <code>{'\n'}.\.venv\Scripts\python.exe test_auth.py &lt;token&gt;</code>
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
