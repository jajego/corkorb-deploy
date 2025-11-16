import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import { App } from './app/App'
import './styles.css'

import { logger } from './utils/logger'

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

// Validate required configuration in production
if (!clerkPublishableKey) {
  const errorMessage = 'VITE_CLERK_PUBLISHABLE_KEY is required but not set in environment variables'
  if (import.meta.env.PROD) {
    // In production, fail hard
    throw new Error(errorMessage)
  } else {
    // In development, warn but continue
    logger.warn(errorMessage)
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider 
      publishableKey={clerkPublishableKey || ''}
    >
      <App />
    </ClerkProvider>
  </React.StrictMode>
)
