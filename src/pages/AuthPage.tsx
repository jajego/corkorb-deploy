import { SignIn, SignUp, useAuth } from '@clerk/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'

import { createLogger } from '../utils/logger'
import './auth.css'

const logger = createLogger('AuthPage')

export function AuthPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { isSignedIn, isLoaded } = useAuth()
  const isSignUp = location.pathname === '/sign-up'

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
      <main className="auth-page auth-status">Redirecting…</main>
    )
  }

  // Show loading while auth state is being determined
  if (!isLoaded) {
    return (
      <main className="auth-page auth-status">Loading…</main>
    )
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-kicker">shared image space</div>
        <h1 className="auth-title">CorkOrb</h1>
        <img className="auth-preview" src="/PINNED_PICTURE.PNG" alt="A CorkOrb covered with pinned pictures" />

        <div className="auth-form">
          {isSignUp ? (
            <>
              <SignUp
                routing="virtual"
                signInUrl="/sign-in"
                fallbackRedirectUrl="/"
                appearance={{ elements: { rootBox: { margin: '0 auto' } } }}
              />
            </>
          ) : (
            <>
              <SignIn
                routing="virtual"
                signUpUrl="/sign-up"
                fallbackRedirectUrl="/"
                appearance={{ elements: { rootBox: { margin: '0 auto' } } }}
              />
            </>
          )}
        </div>
      </section>
    </main>
  )
}

