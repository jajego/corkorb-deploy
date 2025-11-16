import { lazy, Suspense } from 'react'

// Lazy load test component only in development
const TestClerkToken = import.meta.env.DEV
  ? lazy(() => import('../TestClerkToken').then((mod) => ({ default: mod.TestClerkToken })))
  : null

export function TestRoutes() {
  if (!import.meta.env.DEV || !TestClerkToken) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <TestClerkToken />
    </Suspense>
  )
}

