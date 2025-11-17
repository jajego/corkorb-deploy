import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { useAuth, useUser } from '@clerk/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as THREE from 'three'

import { CameraController } from './components/CameraController'
import { CorkOrb } from './components/CorkOrb'
import { NailGunFollower } from './components/NailGunFollower'
import { OrbLights } from './components/OrbLights'
import { GhostPaper, type GhostPaperTransform } from './components/GhostPaper'
import { PinnedPaper } from './components/PinnedPaper'
import { OrbDebugHud } from './components/OrbDebugHud'
import { TouchGestureHandler } from './components/TouchGestureHandler'
import { MobileGhostPaperGestures } from './components/MobileGhostPaperGestures'
import { CanvasCapture } from './components/CanvasCapture'
import { useTouchDetection } from './hooks/useTouchDetection'
import { dispatchOrbEvent, ORB_EVENT } from '../../three/constants/events'
import { ORB_MODE, useOrbStateMachine } from './state'
import { PAPER_OFFSET, PAPER_SPHERE_RADIUS, PAPER_ROTATION_STEP } from './components/papers/constants'
import { useOrbWebSocket } from '../../hooks/useOrbWebSocket'
import type { PendingPaper, PlacedPaper } from '../../types/orb'
import { ToastContainer, useToast } from '../../components/ToastContainer'
import { AboutModal } from '../../components/AboutModal'
import {
  vectorToLatLon,
  formatDegrees,
  normalizeVector,
  wrapAngle,
} from './utils/math'
import {
  ATTACH_CAMERA_RADIUS,
  DEFAULT_PAPER_SCALE,
  MIN_PAPER_SCALE,
  MAX_PAPER_SCALE,
  PIN_LIMIT,
  PIN_COLORS,
  initialSpherical,
} from './utils/constants'
import { applyLayerOffsetToGeometry } from './utils/texture'
import { computeNextLayerOffset, makeId } from './utils/paper'
import { useOrbInitialLoad } from './hooks/useOrbInitialLoad'
import { useCameraSpherical } from './hooks/useCameraSpherical'
import { useOptimisticPapers } from './hooks/useOptimisticPapers'
import { usePaperCreation } from './hooks/usePaperCreation'
import { usePaperUpload } from './hooks/usePaperUpload'
import { usePaperDeletion } from './hooks/usePaperDeletion'
import { useOrbWebSocketHandlers } from './hooks/useOrbWebSocketHandlers'

const cameraRight = new THREE.Vector3()
const cameraUp = new THREE.Vector3()


type OrbSceneProps = {
  orbId: string
}


export function OrbScene({ orbId }: OrbSceneProps) {
  const { userId, signOut, isSignedIn } = useAuth()
  const { user } = useUser()
  const username = user?.username || null
  const navigate = useNavigate()
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const { toasts, showToast, dismissToast } = useToast()
  const [hoveringOrb, setHoveringOrb] = useState(false)
  const [draggingOrb, setDraggingOrb] = useState(false)
  const [pendingPaper, setPendingPaper] = useState<PendingPaper | null>(null)
  const [placedPapers, setPlacedPapers] = useState<PlacedPaper[]>([])
  const placedPapersRef = useRef<PlacedPaper[]>([])
  const websocketHasLoadedPapersRef = useRef(false)
  const initialConnectionCompleteRef = useRef(false)
  const seenUsersRef = useRef<Set<string>>(new Set())
  const [cameraOverride, setCameraOverride] = useState<{ radius?: number; phi?: number; theta?: number } | null>(null)
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(false)
  const [autoRotateSpeed, setAutoRotateSpeed] = useState(0.05)
  const [showAllTooltips, setShowAllTooltips] = useState(false)
  const [orbExists, setOrbExists] = useState<boolean | null>(null)
  const captureOrbRef = useRef<((options: { duration: number; fps?: number; onProgress?: (progress: number) => void }) => Promise<void>) | null>(null)
  const { cameraSpherical, handleSphericalChange } = useCameraSpherical()
  const [lastClickVector, setLastClickVector] = useState<THREE.Vector3 | null>(null)
  const [lastImageVector, setLastImageVector] = useState<THREE.Vector3 | null>(null)
  const [hoveringPin, setHoveringPin] = useState(false)
  const pinHoverCountRef = useRef(0)
  const ghostTransformRef = useRef<GhostPaperTransform | null>(null)
  const ghostGeometryRef = useRef<{ positions: Float32Array; normals: Float32Array } | null>(null)
  const pointerOverrideRef = useRef<{ x: number; y: number } | null>(null)
  const [showAboutModal, setShowAboutModal] = useState(false)
  const isTouchDevice = useTouchDetection()
  const [isGhostPaperInteracting, setIsGhostPaperInteracting] = useState(false) // Track if ghost paper gestures are active
  const isGestureActiveRef = useRef(false) // Track if any gesture is currently active (for preventing commits)

  // Optimistic paper tracking hooks
  const {
    optimisticPapersRef,
    optimisticPapersByIdRef,
    optimisticallyDeletedPapersRef,
    optimisticallyDeletedSourceUrlsRef,
    deletionInProgressRef,
    processingPapersRef,
    pendingDeletionsRef,
  } = useOptimisticPapers()
  const {
    state,
    actions: { enterAttach, enterExplore, debugExitAttach, updatePointer },
  } = useOrbStateMachine()
  const cameraInteractionEnabled = state.mode === ORB_MODE.Explore
  const attachActive = state.mode === ORB_MODE.Attach
  const pendingStage = pendingPaper?.stage
  const nextLayerOffset = useMemo(() => computeNextLayerOffset(placedPapers), [placedPapers])

  useOrbInitialLoad({
    orbId,
    websocketHasLoadedPapersRef,
    setOrbExists,
    setPlacedPapers,
    setLastImageVector,
    placedPapersRef,
  })

  // Handle paper creation when pinning is complete
  usePaperCreation({
    pendingPaper,
    orbId,
    setPendingPaper,
    setPlacedPapers,
    setLastImageVector,
    setCameraOverride,
    ghostTransformRef,
    ghostGeometryRef,
    optimisticPapersRef,
    optimisticPapersByIdRef,
    placedPapersRef,
    enterExplore,
  })

  // Handle file upload - memoize callbacks to avoid unnecessary re-renders
  const handleFileSelected = useCallback((pendingPaper: PendingPaper) => {
    // Use provided pointer position or default to center
    const finalPointerX = pointerOverrideRef.current?.x ?? window.innerWidth / 2
    const finalPointerY = pointerOverrideRef.current?.y ?? window.innerHeight / 2

    setCameraOverride(null)
    ghostTransformRef.current = null
    ghostGeometryRef.current = null
    setPendingPaper((prev) => {
      if (prev?.texture) prev.texture.dispose()
      return null
    })
    updatePointer({ x: finalPointerX, y: finalPointerY })
    pointerOverrideRef.current = { x: finalPointerX, y: finalPointerY }
    enterAttach()
    setPendingPaper(pendingPaper)
  }, [setCameraOverride, setPendingPaper, updatePointer, enterAttach])

  const handleFileUploadError = useCallback((message: string) => {
    enterExplore()
    showToast(message, 'error')
  }, [enterExplore, showToast])

  const { handleFileSelection: handleFileSelectionFromHook } = usePaperUpload({
    onFileSelected: handleFileSelected,
    onError: handleFileUploadError,
    nextLayerOffset,
  })

  // Wrapper to handle pointer position from drag events
  const handleFileSelection = useCallback((file: File, pointerX?: number, pointerY?: number) => {
    pointerOverrideRef.current = {
      x: pointerX !== undefined && Number.isFinite(pointerX) ? pointerX : window.innerWidth / 2,
      y: pointerY !== undefined && Number.isFinite(pointerY) ? pointerY : window.innerHeight / 2,
    }
    handleFileSelectionFromHook(file, pointerX, pointerY)
  }, [handleFileSelectionFromHook])

  // Create a ref to store sendMessage so handlers can access it
  // This allows handlers to be created before useOrbWebSocket returns sendMessage
  const sendMessageRef = useRef<((message: unknown, expectResponse: boolean) => Promise<unknown>) | null>(null)

  // WebSocket handlers (extracted to hook for better organization)
  const webSocketHandlers = useOrbWebSocketHandlers({
    orbId,
    userId: userId ?? null,
    placedPapersRef,
    setPlacedPapers,
    setLastImageVector,
    optimisticPapersRef,
    optimisticPapersByIdRef,
    optimisticallyDeletedPapersRef,
    optimisticallyDeletedSourceUrlsRef,
    deletionInProgressRef,
    processingPapersRef,
    pendingDeletionsRef,
    websocketHasLoadedPapersRef,
    initialConnectionCompleteRef,
    seenUsersRef,
    sendMessage: async (message: unknown, expectResponse: boolean): Promise<void> => {
      // Use ref to get sendMessage (will be set after useOrbWebSocket initializes)
      // Gracefully handle case where sendMessage isn't available yet (shouldn't happen in practice)
      if (!sendMessageRef.current) {
        // Log warning but don't throw - allows handlers to be called before WebSocket fully initializes
        // This is defensive: in practice, handlers won't be called until after useEffect runs
        console.warn('[OrbScene] sendMessage not available yet - message queued or skipped')
        if (expectResponse) {
          throw new Error('sendMessage not available yet')
        }
        return // Skip non-response messages if sendMessage isn't ready
      }
      await sendMessageRef.current(message, expectResponse)
    },
    showToast,
    setCameraOverride,
  })

  // WebSocket integration
  const {
    status: wsStatus,
    connectedUsersCount,
    anonymousUsersCount,
    sendMessage,
    // @ts-ignore
  } = useOrbWebSocket({
    orbId,
    username,
    enabled: orbExists === true, // Only connect if orb exists
    ...webSocketHandlers,
  })

  // Update sendMessage ref so handlers can access it
  useEffect(() => {
    sendMessageRef.current = async (message: unknown, expectResponse: boolean) => {
      return sendMessage(message as Parameters<typeof sendMessage>[0], expectResponse)
    }
  }, [sendMessage])

    // Reset connection state when WebSocket connects (handles reconnections)
  useEffect(() => {
    if (wsStatus === 'connected') {
      // Reset initial connection flag to suppress toasts during reconnection
      // BUT: Don't clear seenUsersRef - we want to remember which users were already
      // connected when we first joined, so we don't show duplicate toasts on reconnect.
      // onUserLeft already removes users from seenUsersRef when they leave, so if they
      // rejoin, they won't be in seenUsersRef and we'll correctly show a toast.
      initialConnectionCompleteRef.current = false
      // NOTE: We intentionally do NOT clear seenUsersRef here to prevent duplicate toasts
      // on reconnection. Users who were already connected when we first joined should
      // remain in seenUsersRef across reconnections.
    }
  }, [wsStatus])

  // Handle paper deletion (must be after sendMessage is available)
  // Memoize callbacks to avoid unnecessary re-renders
  const handleDeletionSendMessage = useCallback(async (message: unknown, expectResponse: boolean) => {
    await sendMessage(message as Parameters<typeof sendMessage>[0], expectResponse)
  }, [sendMessage])

  const handleDeletionError = useCallback((message: string) => {
    showToast(message, 'error')
  }, [showToast])

  const { handleRemove } = usePaperDeletion({
    placedPapersRef,
    setPlacedPapers,
    setLastImageVector,
    optimisticPapersRef,
    optimisticPapersByIdRef,
    optimisticallyDeletedPapersRef,
    optimisticallyDeletedSourceUrlsRef,
    deletionInProgressRef,
    sendMessage: handleDeletionSendMessage,
    orbId,
    onError: handleDeletionError,
  })

  useEffect(() => {
    const dropZone = dropZoneRef.current
    if (!dropZone) return

    const preventDefault = (event: DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
    }

    const handleDragOver = (event: DragEvent) => {
      preventDefault(event)
      dropZone.classList.add('drag-active')
    }

    const handleDragLeave = (event: DragEvent) => {
      preventDefault(event)
      dropZone.classList.remove('drag-active')
    }

    const handleDrop = (event: DragEvent) => {
      preventDefault(event)
      dropZone.classList.remove('drag-active')
      const file = event.dataTransfer?.files?.[0]
      if (!file) return

      const pointerX = Number.isFinite(event.clientX) ? event.clientX : window.innerWidth / 2
      const pointerY = Number.isFinite(event.clientY) ? event.clientY : window.innerHeight / 2
      handleFileSelection(file, pointerX, pointerY)
    }

    dropZone.addEventListener('dragenter', preventDefault)
    dropZone.addEventListener('dragover', handleDragOver)
    dropZone.addEventListener('dragleave', handleDragLeave)
    dropZone.addEventListener('drop', handleDrop)

    return () => {
      dropZone.removeEventListener('dragenter', preventDefault)
      dropZone.removeEventListener('dragover', handleDragOver)
      dropZone.removeEventListener('dragleave', handleDragLeave)
      dropZone.removeEventListener('drop', handleDrop)
    }
  }, [handleFileSelection])

  useEffect(() => {
    if (attachActive) {
      pinHoverCountRef.current = 0
      setHoveringPin(false)
      document.body.style.cursor = 'crosshair'
      return () => {
        document.body.style.cursor = 'default'
      }
    }
    pointerOverrideRef.current = null

    if (draggingOrb) {
      document.body.style.cursor = 'grabbing'
    } else if (hoveringPin) {
      document.body.style.cursor = 'pointer'
    } else if (hoveringOrb) {
      document.body.style.cursor = 'grab'
    } else {
      document.body.style.cursor = 'default'
    }

    return () => {
      document.body.style.cursor = 'default'
    }
  }, [hoveringOrb, draggingOrb, attachActive, hoveringPin])

  useEffect(() => {
    if (!cameraInteractionEnabled) {
      setDraggingOrb(false)
      setHoveringOrb(false)
    }
  }, [cameraInteractionEnabled])

  useEffect(() => {
    if (!attachActive) return undefined
    if (!state.pointer.hasPointer && !pointerOverrideRef.current) {
      const center = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      updatePointer(center)
    }

    const handlePointerMove = (event: PointerEvent) => {
      updatePointer({ x: event.clientX, y: event.clientY })
      pointerOverrideRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
    }
  }, [attachActive, updatePointer, state.pointer.hasPointer])

  useEffect(() => {
    if (!attachActive) return undefined

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      setPendingPaper((prev) => {
        if (prev?.texture) prev.texture.dispose()
        return null
      })
      setCameraOverride(null)
      ghostTransformRef.current = null
      ghostGeometryRef.current = null
      debugExitAttach()
    }

    window.addEventListener('contextmenu', handleContextMenu)
    return () => {
      window.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [attachActive, debugExitAttach])

  // Track base scale when pinch starts (for touch gestures)
  const baseScaleRef = useRef<number>(DEFAULT_PAPER_SCALE)

  // Handle wheel events for mouse (scale and rotation)
  useEffect(() => {
    if (!attachActive || !pendingPaper || pendingPaper.stage !== 'positioning') return undefined

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rotateMode = event.shiftKey
      setPendingPaper((prev) => {
        if (!prev || prev.stage !== 'positioning') return prev
        if (rotateMode) {
          const direction = event.deltaY > 0 ? -1 : 1
          const nextRotation = wrapAngle(prev.rotation + direction * PAPER_ROTATION_STEP)
          if (Math.abs(nextRotation - prev.rotation) < 1e-6) return prev
          return { ...prev, rotation: nextRotation }
        }

        const factor = event.deltaY > 0 ? 0.92 : 1.08
        const nextScale = THREE.MathUtils.clamp(prev.scale * factor, MIN_PAPER_SCALE, MAX_PAPER_SCALE)
        if (Math.abs(nextScale - prev.scale) < 1e-6) return prev
        baseScaleRef.current = nextScale // Update base scale when using wheel
        return { ...prev, scale: nextScale }
      })
    }

    window.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      window.removeEventListener('wheel', handleWheel)
    }
  }, [attachActive, pendingPaper])

  // Handle touch gestures for pending paper (pinch to scale, twist to rotate)
  const handlePinchScale = useCallback((accumulatedScale: number) => {
    if (!pendingPaper || pendingPaper.stage !== 'positioning') return
    setPendingPaper((prev) => {
      if (!prev || prev.stage !== 'positioning') return prev
      // accumulatedScale is the total scale change from when pinch started
      // Apply it to the base scale
      const nextScale = THREE.MathUtils.clamp(
        baseScaleRef.current * accumulatedScale,
        MIN_PAPER_SCALE,
        MAX_PAPER_SCALE
      )
      if (Math.abs(nextScale - prev.scale) < 1e-6) return prev
      return { ...prev, scale: nextScale }
    })
  }, [pendingPaper])

  const handleTwistRotate = useCallback((rotationDelta: number) => {
    if (!pendingPaper || pendingPaper.stage !== 'positioning') return
    setPendingPaper((prev) => {
      if (!prev || prev.stage !== 'positioning') return prev
      // rotationDelta is the change in rotation since last update
      // Apply it to the current rotation
      const nextRotation = wrapAngle(prev.rotation + rotationDelta)
      if (Math.abs(nextRotation - prev.rotation) < 1e-6) return prev
      return { ...prev, rotation: nextRotation }
    })
  }, [pendingPaper])

  // Mobile ghost paper drag handler (single finger)
  const handleMobileGhostPaperDrag = useCallback((x: number, y: number) => {
    if (!pendingPaper || pendingPaper.stage !== 'positioning') return
    updatePointer({ x, y })
    pointerOverrideRef.current = { x, y }
  }, [pendingPaper, updatePointer])

  // Mobile ghost paper combined pinch transform handler (two fingers: scale + rotate + drag)
  const handleMobilePinchTransform = useCallback((transform: { scale: number; rotation: number; x: number; y: number }) => {
    if (!pendingPaper || pendingPaper.stage !== 'positioning') return
    
    setPendingPaper((prev) => {
      if (!prev || prev.stage !== 'positioning') return prev
      
      // Update scale
      const nextScale = THREE.MathUtils.clamp(
        baseScaleRef.current * transform.scale,
        MIN_PAPER_SCALE,
        MAX_PAPER_SCALE
      )
      
      // Update rotation
      const nextRotation = wrapAngle(prev.rotation + transform.rotation)
      
      // Update pointer position (for drag)
      updatePointer({ x: transform.x, y: transform.y })
      pointerOverrideRef.current = { x: transform.x, y: transform.y }
      
      // Only update if there's a meaningful change
      const scaleChanged = Math.abs(nextScale - prev.scale) >= 1e-6
      const rotationChanged = Math.abs(nextRotation - prev.rotation) >= 1e-6
      
      if (!scaleChanged && !rotationChanged) return prev
      
      return {
        ...prev,
        scale: nextScale,
        rotation: nextRotation,
      }
    })
  }, [pendingPaper, updatePointer])

  // Clear ghost paper interaction flag when gestures end or stage changes
  useEffect(() => {
    if (!attachActive || !pendingPaper || pendingPaper.stage !== 'positioning') {
      setIsGhostPaperInteracting(false)
    }
  }, [attachActive, pendingPaper?.stage])

  // Update base scale when pending paper enters positioning stage
  useEffect(() => {
    if (pendingPaper?.stage === 'positioning') {
      baseScaleRef.current = pendingPaper.scale
    }
  }, [pendingPaper?.stage, pendingPaper?.scale])

  useEffect(() => {
    if (pendingStage !== 'pinning') return undefined
    updatePointer({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    const timeout = window.setTimeout(() => {
      setCameraOverride(null)
    }, 650)
    return () => {
      window.clearTimeout(timeout)
    }
  }, [pendingStage, updatePointer])

  // Clear camera override when camera reaches target (for toast click-to-focus)
  // Only clear if not in attach mode (attach mode manages its own override)
  useEffect(() => {
    if (!cameraOverride || attachActive) return undefined

    const targetRadius = cameraOverride.radius
    const targetPhi = cameraOverride.phi
    const targetTheta = cameraOverride.theta

    // Check if camera is close enough to target
    const radiusDiff = targetRadius !== undefined ? Math.abs(cameraSpherical.radius - targetRadius) : 0
    const phiDiff = targetPhi !== undefined ? Math.abs(cameraSpherical.phi - targetPhi) : 0
    const thetaDiff = targetTheta !== undefined ? Math.abs(wrapAngle(cameraSpherical.theta - targetTheta)) : 0

    const THRESHOLD = 0.05 // Close enough threshold (adjust as needed)
    const isCloseEnough = 
      (targetRadius === undefined || radiusDiff < THRESHOLD) &&
      (targetPhi === undefined || phiDiff < THRESHOLD) &&
      (targetTheta === undefined || thetaDiff < THRESHOLD)

    if (isCloseEnough) {
      // Camera has reached target, clear override after a short delay to ensure smooth transition
      const timeout = window.setTimeout(() => {
        setCameraOverride(null)
      }, 200) // Small delay to ensure we're fully at target
      return () => {
        window.clearTimeout(timeout)
      }
    }
  }, [cameraOverride, cameraSpherical, attachActive, setCameraOverride])

  // Clear camera override when user starts interacting (dragging)
  useEffect(() => {
    if (!cameraOverride || attachActive) return undefined

    if (draggingOrb) {
      // User started dragging, clear override to allow free movement
      setCameraOverride(null)
    }
  }, [draggingOrb, cameraOverride, attachActive, setCameraOverride])

  // Clear camera override on wheel zoom (user manually zooming)
  // Use ref to avoid recreating listener on every render
  const wheelClearOverrideRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!cameraOverride || attachActive || !cameraInteractionEnabled) {
      // Clean up if listener exists but conditions no longer met
      if (wheelClearOverrideRef.current) {
        window.removeEventListener('wheel', wheelClearOverrideRef.current)
        wheelClearOverrideRef.current = null
      }
      return undefined
    }

    // Only add listener if it doesn't already exist
    if (!wheelClearOverrideRef.current) {
      const handleWheel = () => {
        // User is zooming, clear override to allow free movement
        setCameraOverride(null)
      }
      wheelClearOverrideRef.current = handleWheel
      window.addEventListener('wheel', handleWheel, { passive: true })
    }

    return () => {
      if (wheelClearOverrideRef.current) {
        window.removeEventListener('wheel', wheelClearOverrideRef.current)
        wheelClearOverrideRef.current = null
      }
    }
  }, [cameraOverride, attachActive, cameraInteractionEnabled, setCameraOverride])

  const sortedPlacedPapers = useMemo(
    () => [...placedPapers].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [placedPapers]
  )

  const confirmPaperPlacement = (event: ThreeEvent<PointerEvent>) => {
    if (!pendingPaper || pendingPaper.stage !== 'positioning') return
    event.stopPropagation()

    const camera = event.camera as THREE.PerspectiveCamera

    const cachedTransform = ghostTransformRef.current
    const cachedGeometry = ghostGeometryRef.current

    let center: THREE.Vector3 | null = null
    let quaternion: THREE.Quaternion | null = null
    let basisRight: THREE.Vector3 | null = null
    let basisUp: THREE.Vector3 | null = null
    let positionsClone: Float32Array | undefined
    let normalsClone: Float32Array | undefined
    const layerOffset = pendingPaper.layerOffset ?? nextLayerOffset

    if (cachedTransform) {
      center = cachedTransform.center.clone()
      quaternion = cachedTransform.quaternion.clone()
      basisRight = cachedTransform.right.clone()
      basisUp = cachedTransform.up.clone()
      if (cachedGeometry) {
        positionsClone = new Float32Array(cachedGeometry.positions)
        normalsClone = new Float32Array(cachedGeometry.normals)
      }
    } else {
      const point = event.point?.clone()
      if (!point) return

      const normal = point.clone().normalize()
      center = normal.clone().multiplyScalar(PAPER_SPHERE_RADIUS + PAPER_OFFSET)

      cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion)
      cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion)

      const projectedRight = cameraRight.clone().projectOnPlane(normal)
      if (projectedRight.lengthSq() < 1e-6) {
        projectedRight.copy(cameraUp.clone().projectOnPlane(normal))
        if (projectedRight.lengthSq() < 1e-6) {
          projectedRight.copy(new THREE.Vector3(0, 0, 1)).projectOnPlane(normal)
        }
      }
      projectedRight.normalize()

      const tangentUp = normal.clone().cross(projectedRight).normalize()

      const rotation = pendingPaper.rotation ?? 0
      if (rotation !== 0) {
        const rotationQuat = new THREE.Quaternion().setFromAxisAngle(normal, rotation)
        projectedRight.applyQuaternion(rotationQuat).normalize()
        tangentUp.applyQuaternion(rotationQuat).normalize()
      }

      const basisMatrix = new THREE.Matrix4()
      basisMatrix.makeBasis(projectedRight, tangentUp, normal)
      quaternion = new THREE.Quaternion().setFromRotationMatrix(basisMatrix)
      basisRight = projectedRight
      basisUp = tangentUp
    }

    if (!center || !quaternion || !basisRight || !basisUp) return

    const outwardNormal = normalizeVector(center.clone())
    const expectedRadius = PAPER_SPHERE_RADIUS + PAPER_OFFSET + layerOffset
    center = outwardNormal.multiplyScalar(expectedRadius)

    const spherical = new THREE.Spherical().setFromVector3(center)

    setLastClickVector(center.clone().normalize())

    setPendingPaper((prev) => {
      if (!prev) return prev
      const basePositions = positionsClone ?? (prev.positions ? prev.positions.slice() : undefined)
      const baseNormals = normalsClone ?? (prev.normals ? prev.normals.slice() : undefined)
      if (!positionsClone && basePositions && baseNormals) {
        applyLayerOffsetToGeometry(basePositions, baseNormals, layerOffset)
      }
      return {
        ...prev,
        stage: 'pinning',
        center,
        quaternion,
        basisRight,
        basisUp,
        positions: basePositions ?? new Float32Array(),
        normals: baseNormals ?? new Float32Array(),
        pins: [],
        layerOffset,
        rotation: wrapAngle(prev.rotation),
      }
    })

    setCameraOverride({
      radius: ATTACH_CAMERA_RADIUS,
      phi: spherical.phi,
      theta: spherical.theta,
    })

    ghostTransformRef.current = null
    ghostGeometryRef.current = null
  }

  const handleAddPin = (worldPosition: THREE.Vector3) => {
    setPendingPaper((prev) => {
      if (!prev || prev.stage !== 'pinning') return prev
      if (prev.pins.length >= PIN_LIMIT) return prev
      const color = PIN_COLORS[Math.floor(Math.random() * PIN_COLORS.length)]
      const newPin = { id: makeId('pin'), position: worldPosition.clone(), color }
      return { ...prev, pins: [...prev.pins, newPin] }
    })
  }

  const handlePinHoverChange = (hovering: boolean) => {
    pinHoverCountRef.current = Math.max(0, pinHoverCountRef.current + (hovering ? 1 : -1))
    setHoveringPin(pinHoverCountRef.current > 0)
  }


  // Camera override: use attach mode radius when in attach mode, otherwise use cameraOverride directly
  const cameraOverrideTarget = attachActive
    ? {
        radius: ATTACH_CAMERA_RADIUS,
        ...(cameraOverride ?? {}),
      }
    : cameraOverride ?? null

  const pointerForInteraction = state.pointer.hasPointer
    ? state.pointer
    : pointerOverrideRef.current
    ? { hasPointer: true as const, x: pointerOverrideRef.current.x, y: pointerOverrideRef.current.y }
    : state.pointer

  const cameraDeltaThetaDeg = formatDegrees(THREE.MathUtils.radToDeg(cameraSpherical.theta - initialSpherical.theta))
  const cameraDeltaPhiDeg = formatDegrees(THREE.MathUtils.radToDeg(cameraSpherical.phi - initialSpherical.phi))
  const viewCenterVector = new THREE.Vector3().setFromSpherical(
    new THREE.Spherical(1, cameraSpherical.phi, cameraSpherical.theta)
  )
  viewCenterVector.negate()
  const viewCenterLatLon = vectorToLatLon(viewCenterVector)
  const pointerLatLon = vectorToLatLon(ghostTransformRef.current?.center ?? null)
  const lastClickLatLon = vectorToLatLon(lastClickVector)
  const pendingCenterLatLon = vectorToLatLon(pendingPaper?.center ?? null)
  const lastImageLatLon = vectorToLatLon(lastImageVector)

  return (
    <div ref={dropZoneRef} className="orb-dropzone">
      <Canvas 
        camera={{ position: [0, 0, 3.5], fov: 50 }} 
        style={{ 
          width: '100vw', 
          height: '100vh',
          touchAction: isTouchDevice ? 'none' : 'auto' // Prevent default touch behaviors on mobile
        }}
      >
        {/* <color attach="background-image" args={['/public/textures/skybox.jpg']} /> */}
        <CanvasCapture onCaptureReady={(captureFn) => { captureOrbRef.current = captureFn }} />
        <OrbLights />
        <CorkOrb
          onPointerOver={() => {
            if (!cameraInteractionEnabled) return
            if (!draggingOrb) setHoveringOrb(true)
          }}
          onPointerOut={() => {
            if (!cameraInteractionEnabled) return
            if (!draggingOrb) setHoveringOrb(false)
          }}
          onPointerDown={(event) => {
            if (state.mode === ORB_MODE.Attach && pendingPaper?.stage === 'positioning') {
              // On mobile, prevent tap-to-commit - only allow "Place Pin" button to commit
              // Also prevent commit if a gesture is currently active
              if (isTouchDevice && event.nativeEvent.pointerType === 'touch') {
                // Don't commit on mobile touch - user must use "Place Pin" button
                event.stopPropagation()
                return
              }
              if (isGestureActiveRef.current) {
                // Don't commit if a gesture is active (drag or pinch)
                event.stopPropagation()
                return
              }
              confirmPaperPlacement(event)
              return
            }
            if (!cameraInteractionEnabled) return
            event.stopPropagation()
            setDraggingOrb(true)
            setHoveringOrb(true)
            dispatchOrbEvent(ORB_EVENT.startDrag, {
              x: event.nativeEvent.clientX,
              y: event.nativeEvent.clientY,
            })
          }}
        />
        <NailGunFollower 
          active={attachActive} 
          pointer={pointerForInteraction} 
          isPinning={pendingPaper?.stage === 'pinning'} 
        />
        {pendingPaper && pendingPaper.stage === 'positioning' ? (
          <GhostPaper
            texture={pendingPaper.texture}
            aspect={pendingPaper.aspect}
            scale={pendingPaper.scale}
            pointer={pointerForInteraction}
            rotation={pendingPaper.rotation}
            layerOffset={pendingPaper.layerOffset ?? nextLayerOffset}
            onTransformChange={(transform) => {
              if (ghostTransformRef.current) {
                ghostTransformRef.current.center.copy(transform.center)
                ghostTransformRef.current.quaternion.copy(transform.quaternion)
                ghostTransformRef.current.right.copy(transform.right)
                ghostTransformRef.current.up.copy(transform.up)
              } else {
                ghostTransformRef.current = {
                  center: transform.center.clone(),
                  quaternion: transform.quaternion.clone(),
                  right: transform.right.clone(),
                  up: transform.up.clone(),
                }
              }
            }}
            onGeometryChange={(geometry) => {
              ghostGeometryRef.current = geometry
            }}
          />
        ) : null}
        {sortedPlacedPapers.map((paper) => (
            <PinnedPaper
              key={paper.id}
              texture={paper.texture}
              aspect={paper.aspect}
              scale={paper.scale}
              center={paper.center}
              quaternion={paper.quaternion}
              right={paper.basisRight}
              up={paper.basisUp}
              positions={paper.positions}
              normals={paper.normals}
              pins={paper.pins}
              layerOffset={paper.layerOffset}
              rotation={paper.rotation}
              userId={paper.userId}
              username={paper.username}
              createdAt={paper.createdAt}
              showTooltip={showAllTooltips}
              onPinHoverChange={handlePinHoverChange}
              onRemove={() => handleRemove(paper)}
              canDelete={isSignedIn}
            />
        ))}
        {pendingPaper &&
        pendingPaper.stage === 'pinning' &&
        pendingPaper.center &&
        pendingPaper.quaternion &&
        pendingPaper.basisRight &&
        pendingPaper.basisUp ? (
          <PinnedPaper
            texture={pendingPaper.texture}
            aspect={pendingPaper.aspect}
            scale={pendingPaper.scale}
            center={pendingPaper.center}
            quaternion={pendingPaper.quaternion}
            right={pendingPaper.basisRight}
            up={pendingPaper.basisUp}
            positions={pendingPaper.positions}
            normals={pendingPaper.normals}
            pins={pendingPaper.pins}
            layerOffset={pendingPaper.layerOffset}
            rotation={pendingPaper.rotation}
            userId={pendingPaper.userId}
            username={username}
            showTooltip={showAllTooltips}
            interactive
            onAddPin={handleAddPin}
          />
        ) : null}
        <CameraController
          draggingOrb={draggingOrb}
          setDraggingOrb={setDraggingOrb}
          idleAutoRotateEnabled={autoRotateEnabled}
          autoRotateSpeed={autoRotateSpeed}
          controlsEnabled={cameraInteractionEnabled}
          overrideTarget={cameraOverrideTarget}
          onSphericalChange={handleSphericalChange}
          disableRotationWhen={isTouchDevice && attachActive && pendingPaper?.stage === 'positioning' && isGhostPaperInteracting}
        />
        {/* Desktop gesture handlers (for compatibility) */}
        {!isTouchDevice && (
          <TouchGestureHandler
            enabled={attachActive && pendingPaper?.stage === 'positioning'}
            onPinchScale={handlePinchScale}
            onTwistRotate={handleTwistRotate}
          />
        )}
        {/* Mobile gesture handlers using @use-gesture/react */}
        {isTouchDevice && (
          <MobileGhostPaperGestures
            enabled={attachActive && pendingPaper?.stage === 'positioning'}
            onDrag={handleMobileGhostPaperDrag}
            onPinchTransform={handleMobilePinchTransform}
            onInteractionStart={() => {
              setIsGhostPaperInteracting(true)
              isGestureActiveRef.current = true
            }}
            onInteractionEnd={() => {
              setIsGhostPaperInteracting(false)
              // Small delay to ensure gesture has fully ended before allowing commits
              setTimeout(() => {
                isGestureActiveRef.current = false
              }, 100)
            }}
          />
        )}
      </Canvas>
      {/* <AttachHud mode={state.mode} onEnterAttach={enterAttach} /> */}
      {/* {!pendingPaper && !attachActive && (
        <div className="drop-hint">Drag & drop an image to attach to the orb</div>
      )} */}
      <OrbDebugHud
        connectedUsersCount={connectedUsersCount}
        wsStatus={wsStatus}
        cameraDeltaThetaDeg={cameraDeltaThetaDeg}
        cameraDeltaPhiDeg={cameraDeltaPhiDeg}
        viewCenterLatLon={viewCenterLatLon}
        pointerLatLon={pointerLatLon}
        lastClickLatLon={lastClickLatLon}
        pendingCenterLatLon={pendingCenterLatLon}
        lastImageLatLon={lastImageLatLon}
        autoRotateEnabled={autoRotateEnabled}
        onAutoRotateChange={setAutoRotateEnabled}
        autoRotateSpeed={autoRotateSpeed}
        onAutoRotateSpeedChange={setAutoRotateSpeed}
        showAllTooltips={showAllTooltips}
        onShowAllTooltipsChange={setShowAllTooltips}
        onUploadPhoto={handleFileSelection}
        orbId={orbId}
        isSignedIn={isSignedIn ?? false}
        username={username || 'Unknown'}
        onSignOut={signOut}
        onNavigateToSignIn={() => navigate('/sign-in')}
        onNavigateToSignUp={() => navigate('/sign-up')}
        anonymousUsersCount={anonymousUsersCount}
        onShowAbout={() => setShowAboutModal(true)}
      />
      <AboutModal isOpen={showAboutModal} onClose={() => setShowAboutModal(false)} />
      {orbExists === false && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          padding: '20px',
          backgroundColor: 'rgba(255, 0, 0, 0.1)',
          border: '1px solid red',
          borderRadius: '8px',
          zIndex: 1000,
        }}>
          <p>Orb not found. Redirecting to home...</p>
        </div>
      )}
      {/* Place Pin button - only on mobile during positioning */}
      {isTouchDevice && attachActive && pendingPaper?.stage === 'positioning' && (
        <div
          style={{
            position: 'fixed',
            bottom: '40px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
          }}
        >
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              // Trigger paper placement using current ghost transform
              // Create a synthetic event to reuse confirmPaperPlacement logic
              if (pendingPaper && ghostTransformRef.current) {
                // We need to create a synthetic pointer event for confirmPaperPlacement
                // Since we have the transform cached, we can directly transition to pinning
                const transform = ghostTransformRef.current
                const layerOffset = pendingPaper.layerOffset ?? nextLayerOffset
                
                // Calculate final center position with layer offset
                const center = transform.center.clone()
                const outwardNormal = normalizeVector(center.clone())
                const expectedRadius = PAPER_SPHERE_RADIUS + PAPER_OFFSET + layerOffset
                const finalCenter = outwardNormal.multiplyScalar(expectedRadius)
                
                const basePositions = ghostGeometryRef.current?.positions
                  ? new Float32Array(ghostGeometryRef.current.positions)
                  : undefined
                const baseNormals = ghostGeometryRef.current?.normals
                  ? new Float32Array(ghostGeometryRef.current.normals)
                  : undefined
                if (basePositions && baseNormals) {
                  applyLayerOffsetToGeometry(basePositions, baseNormals, layerOffset)
                }
                
                setPendingPaper((prev) => {
                  if (!prev || prev.stage !== 'positioning') return prev
                  return {
                    ...prev,
                    stage: 'pinning',
                    center: finalCenter,
                    quaternion: transform.quaternion.clone(),
                    basisRight: transform.right.clone(),
                    basisUp: transform.up.clone(),
                    positions: basePositions ?? new Float32Array(),
                    normals: baseNormals ?? new Float32Array(),
                    pins: [],
                    layerOffset,
                    rotation: wrapAngle(prev.rotation),
                  }
                })
                
                // Set camera override to focus on the placed paper
                const spherical = new THREE.Spherical().setFromVector3(finalCenter)
                setLastClickVector(finalCenter.clone().normalize())
                setCameraOverride({
                  radius: ATTACH_CAMERA_RADIUS,
                  phi: spherical.phi,
                  theta: spherical.theta,
                })
                
                // Clear cached transforms
                ghostTransformRef.current = null
                ghostGeometryRef.current = null
              }
            }}
            style={{
              padding: '16px 32px',
              fontSize: '18px',
              fontWeight: '600',
              backgroundColor: '#4F46E5',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              transition: 'background-color 0.2s, transform 0.1s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#4338CA'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#4F46E5'
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              e.currentTarget.style.transform = 'scale(0.95)'
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
            }}
            onTouchStart={(e) => {
              e.preventDefault()
              e.currentTarget.style.transform = 'scale(0.95)'
            }}
            onTouchEnd={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            Place Pin
          </button>
        </div>
      )}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}

