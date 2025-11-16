import { SignIn, SignUp, useAuth } from '@clerk/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'

import { createLogger } from '../utils/logger'

const logger = createLogger('AuthPage')

export function AuthPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { isSignedIn, isLoaded } = useAuth()
  const isSignUp = location.pathname === '/sign-up'
  const [showSignUp, setShowSignUp] = useState(isSignUp)

  // Sync state with URL path
  useEffect(() => {
    setShowSignUp(location.pathname === '/sign-up')
  }, [location.pathname])

  // Handle authentication state change - redirect when signed in
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      logger.debug('User signed in, redirecting to home')
      // Small delay to ensure Clerk has finished processing
      const timeoutId = setTimeout(() => {
        if (location.pathname === '/sign-in' || location.pathname === '/sign-up') {
          navigate('/', { replace: true })
        }
      }, 100)
      return () => clearTimeout(timeoutId)
    }
  }, [isLoaded, isSignedIn, navigate, location.pathname])

  // If already signed in, show redirect message
  if (isLoaded && isSignedIn) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        fontSize: '18px',
        color: '#666'
      }}>
        Redirecting...
      </div>
    )
  }

  // Show loading while auth state is being determined
  if (!isLoaded) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        fontSize: '18px',
        color: '#666'
      }}>
        Loading...
      </div>
    )
  }

  const handleSwitchToSignIn = () => {
    navigate('/sign-in')
    setShowSignUp(false)
  }

  const handleSwitchToSignUp = () => {
    navigate('/sign-up')
    setShowSignUp(true)
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '20px',
      backgroundColor: '#f5f5f5',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{
        maxWidth: '500px',
        width: '100%',
        textAlign: 'center',
        backgroundColor: 'white',
        padding: '40px',
        borderRadius: '12px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
      }}>
        {/* <h1 style={{
          fontSize: '48px',
          fontWeight: 'bold',
          marginBottom: '20px',
          color: '#333'
        }}>
          corkorb
        </h1>
        <p style={{
          fontSize: '18px',
          color: '#666',
          marginBottom: '30px'
        }}>
          {showSignUp ? 'Create an account to continue' : 'Please sign in to continue'}
        </p> */}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          {/* <button
            onClick={handleSwitchToSignIn}
            style={{
              padding: '8px 16px',
              backgroundColor: showSignUp ? '#f0f0f0' : '#4CAF50',
              color: showSignUp ? '#333' : 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '600'
            }}
          >
            Sign In
          </button>
          <button
            onClick={handleSwitchToSignUp}
            style={{
              padding: '8px 16px',
              backgroundColor: showSignUp ? '#4CAF50' : '#f0f0f0',
              color: showSignUp ? 'white' : '#333',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '600'
            }}
          >
            Sign Up
          </button>
        </div> */}
        </div>

        <div style={{ marginTop: '0px' }}>
          {showSignUp ? (
            <SignUp
              routing="virtual"
              signInUrl="/sign-in"
              fallbackRedirectUrl="/"
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
              signUpUrl="/sign-up"
              fallbackRedirectUrl="/"
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
    </div>
  )
}

