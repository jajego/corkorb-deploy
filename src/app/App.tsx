import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { useAuth } from '@clerk/react'

import { OrbScene } from '../scenes/orb/OrbScene'
import { SplashPage } from '../pages/SplashPage'
import { AuthPage } from '../pages/AuthPage'
import { TestRoutes } from './TestRoutes'

function HomeRoute() {
  const { isSignedIn, isLoaded } = useAuth()
  
  if (!isLoaded) {
    // Still loading auth state
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
  
  if (isSignedIn) {
    return <SplashPage />
  }
  
  return <Navigate to="/sign-in" replace />
}

function OrbRoute() {
  const { orbId } = useParams<{ orbId: string }>()
  if (!orbId) {
    return <Navigate to="/" replace />
  }
  return <OrbScene orbId={orbId} />
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/sign-in" element={<AuthPage />} />
        <Route path="/sign-up" element={<AuthPage />} />
        <Route path="/o/:orbId" element={<OrbRoute />} />
        {/* Test routes are only available in development - excluded from production builds */}
        {import.meta.env.DEV && (
          <>
            <Route path="/test-token" element={<TestRoutes />} />
            <Route path="/test-token/sign-in" element={<TestRoutes />} />
            <Route path="/test-token/sign-up" element={<TestRoutes />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
