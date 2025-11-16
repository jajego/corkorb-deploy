import { useAuth } from '@clerk/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { createLogger } from '../utils/logger'
import type { WebSocketMessage, ServerPaper, ViewCenter } from '../types/websocket'

const logger = createLogger('WebSocket')

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

interface UseOrbWebSocketOptions {
  orbId: string
  username?: string | null
  onState?: (papers: ServerPaper[]) => void
  onPaperCreated?: (paper: ServerPaper) => void
  onPaperDeleted?: (paperId: string, reason?: string) => void
  onUserJoined?: (userId: string, username?: string | null) => void
  onUserLeft?: (userId: string, username?: string | null) => void
  onViewCenterUpdate?: (userId: string, viewCenter: ViewCenter) => void
  onError?: (error: string) => void
  enabled?: boolean
}

interface QueuedMessage {
  type: string
  [key: string]: unknown
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export function useOrbWebSocket({
  orbId,
  username,
  onState,
  onPaperCreated,
  onPaperDeleted,
  onUserJoined,
  onUserLeft,
  onViewCenterUpdate,
  onError,
  enabled = true,
}: UseOrbWebSocketOptions) {
  const { getToken, isSignedIn, userId: authUserId } = useAuth()
  const [status, setStatus] = useState<WebSocketStatus>('disconnected')
  const [connectedUsers, setConnectedUsers] = useState<Set<string>>(new Set())
  const [anonymousUsers, setAnonymousUsers] = useState<Set<string>>(new Set())
  const wsRef = useRef<WebSocket | null>(null)
  const currentUserIdRef = useRef<string | null>(null) // Track current user's ID
  const reconnectTimeoutRef = useRef<number | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const messageQueueRef = useRef<QueuedMessage[]>([])
  const requestIdCounterRef = useRef(0)
  const pendingRequestsRef = useRef<Map<string, PendingRequest>>(new Map())
  const wasHiddenRef = useRef<boolean>(false)
  
  // Use refs for callbacks to prevent reconnection loops
  const callbacksRef = useRef({
    onState,
    onPaperCreated,
    onPaperDeleted,
    onUserJoined,
    onUserLeft,
    onViewCenterUpdate,
    onError,
  })
  
  // Update callbacks ref when they change
  useEffect(() => {
    callbacksRef.current = {
      onState,
      onPaperCreated,
      onPaperDeleted,
      onUserJoined,
      onUserLeft,
      onViewCenterUpdate,
      onError,
    }
  }, [onState, onPaperCreated, onPaperDeleted, onUserJoined, onUserLeft, onViewCenterUpdate, onError])

  const wsUrl = API_BASE_URL.replace('http://', 'ws://').replace('https://', 'wss://')
  const maxReconnectAttempts = 5
  const reconnectDelay = 1000 // Start with 1 second

  const generateRequestId = useCallback(() => {
    return `req_${Date.now()}_${++requestIdCounterRef.current}`
  }, [])

  const sendMessage = useCallback(
    async (message: QueuedMessage, waitForResponse = false): Promise<unknown> => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        // Queue message if not connected
        if (waitForResponse) {
          return Promise.reject(new Error('WebSocket not connected'))
        }
        messageQueueRef.current.push(message)
        return
      }

      const requestId = generateRequestId()
      const messageWithId = { ...message, request_id: requestId }

      if (waitForResponse) {
        return new Promise((resolve, reject) => {
          pendingRequestsRef.current.set(requestId, { resolve, reject })
          wsRef.current!.send(JSON.stringify(messageWithId))
          
          // Timeout after 10 seconds
          setTimeout(() => {
            if (pendingRequestsRef.current.has(requestId)) {
              pendingRequestsRef.current.delete(requestId)
              reject(new Error('Request timeout'))
            }
          }, 10000)
        })
      } else {
        wsRef.current.send(JSON.stringify(messageWithId))
      }
    },
    [generateRequestId]
  )

  const connect = useCallback(async () => {
    if (!enabled || !orbId) return

    // Check if already connected or connecting
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      logger.debug('Already connected or connecting, skipping')
      return // Already connected or connecting
    }

    // Clear any pending reconnection attempts
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    setStatus('connecting')
    logger.debug(`Attempting to connect to orb: ${orbId}`)

    try {
      // Get JWT token if user is authenticated (optional for viewing)
      const token = await getToken()

      // Connect to WebSocket
      // Pass token and username as query parameters (frontend has direct access via useUser())
      // This is more reliable than extracting from JWT token, which may not include username
      let url = `${wsUrl}/ws/orb/${orbId}`
      if (token) {
        url += `?token=${encodeURIComponent(token)}`
        if (username) {
          url += `&username=${encodeURIComponent(username)}`
        }
      }
      const ws = new WebSocket(url)

      // Set up onmessage handler FIRST, before onopen, so we can receive messages
      // that the server sends immediately after accepting the connection
      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data)
          
          // Log all incoming paper_created messages for debugging
          if (message.type === 'paper_created' || (message.type === 'success' && message.data && typeof message.data === 'object' && 'type' in message.data && message.data.type === 'paper_created')) {
            const paperId = message.type === 'paper_created' ? message.paper.id : (message.data as any).paper.id
            logger.debug(`[WebSocket] Received message with type="${message.type}" for paper: ${paperId}`)
          }

          // Handle ping/pong
          if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }))
            return
          }

          // Handle responses to pending requests (resolve promise, but continue processing for callbacks)
          if (message.request_id && pendingRequestsRef.current.has(message.request_id)) {
            const { resolve, reject } = pendingRequestsRef.current.get(message.request_id)!
            pendingRequestsRef.current.delete(message.request_id)

            if (message.type === 'error') {
              reject(new Error(message.error))
              return // Error messages don't need callback processing
            } else {
              // Resolve with the data (for SuccessMessage, this is the wrapped message)
              resolve(message.type === 'success' ? message.data : message)
            }
          }

          // Handle broadcast messages and responses (for callback processing)
          // Use callbacks from ref to get latest version without causing reconnections
          const callbacks = callbacksRef.current
          switch (message.type) {
            case 'state':
              callbacks.onState?.(message.papers || [])
              break

            case 'success': {
              // Success messages can contain wrapped events (paper_created, paper_deleted, etc.)
              // This happens both for responses to requests (with request_id) and broadcasts
              const wrappedData = message.data
              if (wrappedData && typeof wrappedData === 'object' && 'type' in wrappedData) {
                if (wrappedData.type === 'paper_created' && 'paper' in wrappedData) {
                  logger.debug(`Received paper_created message (wrapped in success) for paper: ${(wrappedData.paper as ServerPaper).id}`)
                  callbacks.onPaperCreated?.(wrappedData.paper as ServerPaper)
                } else if (wrappedData.type === 'paper_deleted' && 'paper_id' in wrappedData) {
                  const reason = (wrappedData as any).reason as string | undefined
                  logger.info(`[WebSocket] Received paper_deleted message (wrapped) for paper: ${wrappedData.paper_id}, reason: ${reason}`)
                  callbacks.onPaperDeleted?.(wrappedData.paper_id as string, reason)
                } else if (wrappedData.type === 'user_joined' && 'user_id' in wrappedData) {
                  const userId = wrappedData.user_id as string
                  const username = (wrappedData as any).username as string | null | undefined
                  const isAnonymous = userId.startsWith('user:anonymous:')
                  
                  // Track our own user_id when we receive our own user_joined message
                  if (!currentUserIdRef.current) {
                    currentUserIdRef.current = userId
                  }
                  
                  setConnectedUsers((prev) => {
                    const next = new Set(prev)
                    next.add(userId)
                    return next
                  })
                  if (isAnonymous) {
                    setAnonymousUsers((prev) => {
                      const next = new Set(prev)
                      next.add(userId)
                      return next
                    })
                  }
                  // Only call onUserJoined callback for OTHER users (not ourselves)
                  if (currentUserIdRef.current && userId === currentUserIdRef.current) {
                    // This is our own join - don't show toast
                  } else {
                    callbacks.onUserJoined?.(userId, username)
                  }
                } else if (wrappedData.type === 'user_left' && 'user_id' in wrappedData) {
                  const userId = wrappedData.user_id as string
                  const username = (wrappedData as any).username as string | null | undefined
                  const isAnonymous = userId.startsWith('user:anonymous:')
                  setConnectedUsers((prev) => {
                    const next = new Set(prev)
                    next.delete(userId)
                    return next
                  })
                  if (isAnonymous) {
                    setAnonymousUsers((prev) => {
                      const next = new Set(prev)
                      next.delete(userId)
                      return next
                    })
                  }
                  callbacks.onUserLeft?.(userId, username)
                } else if (wrappedData.type === 'view_center_update' && 'user_id' in wrappedData && 'view_center' in wrappedData) {
                  callbacks.onViewCenterUpdate?.(wrappedData.user_id as string, wrappedData.view_center as ViewCenter)
                } else if (wrappedData.type === 'orb_created') {
                  // Orb created event (not used in OrbScene, but handled for completeness)
                  logger.debug('Orb created event received')
                } else if (wrappedData.type === 'orb_deleted') {
                  // Orb deleted event (not used in OrbScene, but handled for completeness)
                  logger.debug('Orb deleted event received')
                }
              }
              break
            }

            case 'paper_created':
              // Direct paper_created message (if not wrapped)
              logger.debug(`Received paper_created message (direct) for paper: ${message.paper.id}`)
              callbacks.onPaperCreated?.(message.paper)
              break

            case 'paper_deleted':
              // Direct paper_deleted message (if not wrapped)
              const reason = (message as any).reason as string | undefined
              logger.info(`[WebSocket] Received paper_deleted message (direct) for paper: ${message.paper_id}, reason: ${reason}`)
              callbacks.onPaperDeleted?.(message.paper_id, reason)
              break

            case 'user_joined':
              const isJoinedAnonymous = message.user_id.startsWith('user:anonymous:')
              
              // Track our own user_id when we receive our own user_joined message
              // The backend sends us our own user_joined message first so we can add ourselves
              if (!currentUserIdRef.current) {
                currentUserIdRef.current = message.user_id
              }
              
              setConnectedUsers((prev) => {
                const next = new Set(prev)
                next.add(message.user_id)
                return next
              })
              if (isJoinedAnonymous) {
                setAnonymousUsers((prev) => {
                  const next = new Set(prev)
                  next.add(message.user_id)
                  return next
                })
              }
              // Only call onUserJoined callback for OTHER users (not ourselves)
              // We know it's ourselves if currentUserIdRef matches
              if (currentUserIdRef.current && message.user_id === currentUserIdRef.current) {
                // This is our own join - don't show toast
              } else {
                callbacks.onUserJoined?.(message.user_id, message.username)
              }
              break

            case 'user_left':
              logger.debug(`User left: ${message.user_id} (username: ${message.username || 'unknown'})`)
              const isLeftAnonymous = message.user_id.startsWith('user:anonymous:')
              setConnectedUsers((prev) => {
                const next = new Set(prev)
                next.delete(message.user_id)
                return next
              })
              if (isLeftAnonymous) {
                setAnonymousUsers((prev) => {
                  const next = new Set(prev)
                  next.delete(message.user_id)
                  return next
                })
              }
              callbacks.onUserLeft?.(message.user_id, message.username)
              break

            case 'view_center_update':
              callbacks.onViewCenterUpdate?.(message.user_id, message.view_center)
              break

            case 'error':
              callbacks.onError?.(message.error)
              break

            default:
              logger.warn(`Unknown message type: ${(message as { type: string }).type}`)
          }
        } catch (error) {
          logger.error('Error parsing message', error)
        }
      }

      ws.onopen = () => {
        logger.info(`Connected to orb: ${orbId}`)
        setStatus('connected')
        reconnectAttemptsRef.current = 0
        wasHiddenRef.current = false
        
        // The backend will send us our own user_joined message so we can add ourselves
        // to connectedUsers. We'll handle it in the onmessage handler.
        
        // Send queued messages
        while (messageQueueRef.current.length > 0) {
          const message = messageQueueRef.current.shift()
          if (message && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message))
          }
        }

        // Request initial state
        ws.send(JSON.stringify({
          type: 'get_state',
          orb_id: orbId,
        }))
      }

      ws.onerror = (error) => {
        logger.error('WebSocket error', error)
        setStatus('error')
        callbacksRef.current.onError?.('WebSocket error')
      }

      ws.onclose = (event) => {
        logger.debug(`WebSocket closed: code=${event.code}, reason=${event.reason || 'none'}`)
        
        // Only update state if this is the current connection
        if (wsRef.current === ws) {
          setStatus('disconnected')
          wsRef.current = null
        }

        // Clear pending requests
        pendingRequestsRef.current.forEach(({ reject }) => {
          reject(new Error('WebSocket closed'))
        })
        pendingRequestsRef.current.clear()

        // Don't reconnect if disabled or if this is not the current connection
        if (!enabled || wsRef.current !== null) {
          return
        }

        // Attempt reconnect if not a normal closure and not disabled
        if (event.code !== 1000 && event.code !== 1001 && reconnectAttemptsRef.current < maxReconnectAttempts && enabled) {
          const delay = reconnectDelay * Math.pow(2, reconnectAttemptsRef.current)
          reconnectAttemptsRef.current++
          logger.debug(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`)
          
          reconnectTimeoutRef.current = window.setTimeout(() => {
            // Check if still enabled before reconnecting
            // Allow both signed-in and anonymous users to reconnect
            if (enabled && orbId) {
              connect()
            }
          }, delay)
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setStatus('error')
          callbacksRef.current.onError?.('Failed to reconnect after multiple attempts')
        }
      }

      wsRef.current = ws
    } catch (error) {
      logger.error('Connection error', error)
      setStatus('error')
      callbacksRef.current.onError?.(error instanceof Error ? error.message : 'Connection error')
    }
  }, [orbId, enabled, getToken, wsUrl, username])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnect')
      wsRef.current = null
    }
    setStatus('disconnected')
    setConnectedUsers(new Set())
    messageQueueRef.current = []
    pendingRequestsRef.current.clear()
  }, [])

  // Reconnect on window/tab focus or visibility change (only if actually disconnected)
  useEffect(() => {
    if (!enabled || !orbId) {
      return
    }

    let reconnectTimeoutId: number | null = null

    const checkAndReconnectIfNeeded = () => {
      // Allow both signed-in and anonymous users to reconnect
      if (!enabled || !orbId) {
        return
      }
      
      // Clear any pending reconnect timeout
      if (reconnectTimeoutId !== null) {
        clearTimeout(reconnectTimeoutId)
      }
      
      // Wait a bit before checking (give browser time to resume and check actual connection state)
      reconnectTimeoutId = window.setTimeout(() => {
        reconnectTimeoutId = null
        // Check WebSocket state directly (don't rely on React state which might be stale)
        const ws = wsRef.current
        const wsState = ws?.readyState
        
        // Only reconnect if WebSocket is actually CLOSED (not connected, connecting, or closing)
        // This prevents unnecessary reconnections that would wipe out optimistic updates
        if (!ws || wsState === WebSocket.CLOSED) {
          logger.debug('Window/tab became visible/focused and WebSocket is disconnected, reconnecting')
          reconnectAttemptsRef.current = 0
          connect()
        } else {
          const stateName = wsState === WebSocket.CONNECTING ? 'connecting' :
            wsState === WebSocket.OPEN ? 'connected' :
            wsState === WebSocket.CLOSING ? 'closing' : 'unknown'
          logger.debug(`Window/tab became visible/focused, WebSocket is already ${stateName}`)
        }
      }, 2000) // Wait 2 seconds - only reconnect if truly disconnected for a while
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Tab/window became visible - check if we need to reconnect
        if (wasHiddenRef.current) {
          wasHiddenRef.current = false
          checkAndReconnectIfNeeded()
        }
      } else {
        // Tab/window became hidden - clear any pending reconnect
        wasHiddenRef.current = true
        if (reconnectTimeoutId !== null) {
          clearTimeout(reconnectTimeoutId)
          reconnectTimeoutId = null
        }
      }
    }

    const handleFocus = () => {
      // Window gained focus - check if we need to reconnect
      // Only check if tab is visible (focus can fire even when tab is hidden)
      if (document.visibilityState === 'visible') {
        checkAndReconnectIfNeeded()
      }
    }

    // Listen for visibility changes (most reliable for tab switching)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    // Also listen for window focus (useful for window switching)
    window.addEventListener('focus', handleFocus)

    return () => {
      if (reconnectTimeoutId !== null) {
        clearTimeout(reconnectTimeoutId)
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [enabled, orbId, connect]) // Removed isSignedIn - allow anonymous users to reconnect

  // Connect on mount and when orbId changes
  useEffect(() => {
    if (!enabled || !orbId) {
      disconnect()
      return
    }

    // Disconnect any existing connection first
    disconnect()

    // Small delay to avoid race conditions and allow cleanup to complete
    const timeoutId = setTimeout(() => {
      // Check again if still enabled (might have changed during delay)
      // Allow both signed-in and anonymous users to connect
      if (enabled && orbId) {
        connect()
      }
    }, 200)

    return () => {
      clearTimeout(timeoutId)
      disconnect()
      // Reset reconnect attempts when orbId or username changes
      reconnectAttemptsRef.current = 0
      // Clear current user ID when disconnecting
      currentUserIdRef.current = null
      // Clear user sets when disconnecting
      setConnectedUsers(new Set())
      setAnonymousUsers(new Set())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orbId, enabled, username]) // connect and disconnect are stable (memoized), so we don't need them in deps

  return {
    status,
    connectedUsersCount: connectedUsers.size,
    anonymousUsersCount: anonymousUsers.size,
    connectedUsers: Array.from(connectedUsers),
    sendMessage,
    connect,
    disconnect,
  }
}

