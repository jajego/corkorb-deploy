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
        color: '#666',
        backgroundColor: "white"
      }}>
        Loading...
      </div>
    )
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
        boxShadow: "rgba(255, 255, 255, 0.2) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.9) 0px 0px 0px 1px"
      }}>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
        </div>

        <div style={{ marginTop: '0px' }}>
          {showSignUp ? (
            <>
            <div style={{ fontSize: "54px", fontFamily: "Courier", fontWeight: 600, fontStyle: "italic" }}>CorkOrb</div>
            <div style={{ margin: "12px 0px 0px 0px" }}><img height="75%" width="75%" src="/PINNED_PICTURE.PNG" /></div>
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
            </>
          ) : (
            <>
            <div style={{ fontSize: "54px", fontFamily: "Courier", fontWeight: 600, fontStyle: "italic" }}>CorkOrb</div>
            <div style={{ margin: "12px 0px 0px 0px" }}><img height="75%" width="75%" src="/PINNED_PICTURE.PNG" /></div>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}

