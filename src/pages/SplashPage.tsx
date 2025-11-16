import { useAuth } from '@clerk/react'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'

import { createLogger } from '../utils/logger'
import { AboutModal } from '../components/AboutModal'
import './splash.css'

const logger = createLogger('SplashPage')
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

export function SplashPage() {
  const { getToken, userId } = useAuth()
  const navigate = useNavigate()
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAboutModal, setShowAboutModal] = useState(false)

  const handleCreateOrb = async () => {
    if (!userId) {
      setError('Not authenticated')
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      // Get JWT token
      const token = await getToken()
      if (!token) {
        setError('Failed to get authentication token')
        setIsCreating(false)
        return
      }

      // Create orb via REST API
      const response = await fetch(`${API_BASE_URL}/api/orbs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          max_papers: 50
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Failed to create orb' }))
        throw new Error(errorData.detail || `HTTP ${response.status}`)
      }

      const orb = await response.json()
      if (orb.id) {
        navigate(`/o/${orb.id}`)
      } else {
        throw new Error('No orb ID in response')
      }
    } catch (err) {
      logger.error('Failed to create orb', err)
      setError(err instanceof Error ? err.message : 'Failed to create orb')
      setIsCreating(false)
    }
  }

  return (
    <div className="splash-page" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '20px',
      backgroundColor: '#f5f5f5',
      fontFamily: 'Courier New, Courier, monospace',
    }}>
      <div style={{
        maxWidth: '500px',
        width: '100%',
        textAlign: 'center',
        backgroundColor: 'white',
        padding: '20px 40px',
        paddingBottom: "20px",
        borderRadius: '20px',
        border: "3px solid black",
        // boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
      }}>
        <h1 style={{
          fontSize: '60px',
          fontWeight: 'bold',
          marginBottom: '30px',
          marginTop: "20px",
          color: '#333',
          fontFamily: "Arial",
        }}>
          CorkOrb
        </h1>
        {/* <p style={{
          fontSize: '18px',
          color: '#666',
          marginBottom: '30px'
        }}>
          Create a new orb to start pinning images.
        </p> */}
        
        <button
          onClick={handleCreateOrb}
          disabled={isCreating}
          style={{
            padding: '12px 24px',
            fontSize: '20px',
            fontWeight: '600',
            color: 'white',
            backgroundColor: isCreating ? '#ccc' : '#4CAF50',
            border: '1px dashed black',
            borderRadius: '4px',
            cursor: isCreating ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.2s',
            width: '100%',
            maxWidth: '300px'
          }}
          onMouseEnter={(e) => {
            if (!isCreating) {
              e.currentTarget.style.backgroundColor = '#45a049'
            }
          }}
          onMouseLeave={(e) => {
            if (!isCreating) {
              e.currentTarget.style.backgroundColor = '#4CAF50'
            }
          }}
        >
          {isCreating ? 'Creating CorkOrb...' : 'Create CorkOrb'}
        </button>
        <div className="about-text-container">
        <div 
          className="about-text"
          onClick={() => setShowAboutModal(true)}
        >
          about
        </div>
        </div>

        {error && (
          <div style={{
            marginTop: '20px',
            padding: '12px',
            backgroundColor: '#ffebee',
            color: '#c62828',
            borderRadius: '4px',
            fontSize: '14px'
          }}>
            {error}
          </div>
        )}
      </div>

      <AboutModal isOpen={showAboutModal} onClose={() => setShowAboutModal(false)} />
      
    </div>
  )
}

