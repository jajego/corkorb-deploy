import { useCallback, useReducer } from 'react'

export const ORB_MODE = {
  Explore: 'EXPLORE',
  Attach: 'ATTACH',
  Posted: 'POSTED',
} as const

export type OrbMode = (typeof ORB_MODE)[keyof typeof ORB_MODE]

export type OrbPointer =
  | {
      hasPointer: false
    }
  | {
      hasPointer: true
      x: number
      y: number
    }

export type OrbState = {
  mode: OrbMode
  pointer: OrbPointer
}

export const initialOrbState: OrbState = {
  mode: ORB_MODE.Explore,
  pointer: { hasPointer: false },
}

export const ORB_ACTION = {
  enterExplore: 'ENTER_EXPLORE',
  enterAttach: 'ENTER_ATTACH',
  commitPaper: 'COMMIT_PAPER',
  cancelAttach: 'CANCEL_ATTACH',
  debugExitAttach: 'DEBUG_EXIT_ATTACH',
  updatePointer: 'UPDATE_POINTER',
} as const

export type OrbActionType = (typeof ORB_ACTION)[keyof typeof ORB_ACTION]

type OrbAction =
  | { type: typeof ORB_ACTION.enterExplore }
  | { type: typeof ORB_ACTION.enterAttach }
  | { type: typeof ORB_ACTION.commitPaper }
  | { type: typeof ORB_ACTION.cancelAttach }
  | { type: typeof ORB_ACTION.debugExitAttach }
  | { type: typeof ORB_ACTION.updatePointer; payload: { x: number; y: number } }

const allowedTransitions: Record<OrbMode, ReadonlySet<OrbActionType>> = {
  [ORB_MODE.Explore]: new Set([ORB_ACTION.enterExplore, ORB_ACTION.enterAttach]),
  [ORB_MODE.Attach]: new Set([
    ORB_ACTION.commitPaper,
    ORB_ACTION.cancelAttach,
    ORB_ACTION.enterExplore,
    ORB_ACTION.debugExitAttach,
    ORB_ACTION.updatePointer,
  ]),
  [ORB_MODE.Posted]: new Set([ORB_ACTION.enterExplore, ORB_ACTION.enterAttach]),
}

function getNextMode(current: OrbMode, action: OrbAction): OrbMode {
  switch (action.type) {
    case ORB_ACTION.enterExplore:
      return ORB_MODE.Explore
    case ORB_ACTION.enterAttach:
      return ORB_MODE.Attach
    case ORB_ACTION.commitPaper:
      return ORB_MODE.Posted
    case ORB_ACTION.cancelAttach:
    case ORB_ACTION.debugExitAttach:
      return ORB_MODE.Explore
    case ORB_ACTION.updatePointer:
      return current
    default:
      return current
  }
}

function orbStateReducer(state: OrbState, action: OrbAction): OrbState {
  const nextAllowed = allowedTransitions[state.mode]
  if (!nextAllowed.has(action.type)) {
    // Invalid transition - silently ignore in production, log in development
    if (import.meta.env.DEV) {
      // Use console.warn here as this is a development-only warning
      // and importing logger would require restructuring this file
      console.warn(
        `[corkorb] Ignoring invalid transition "${action.type}" from mode "${state.mode}"`
      )
    }
    return state
  }

  if (action.type === ORB_ACTION.updatePointer) {
    return {
      ...state,
      pointer: {
        hasPointer: true,
        x: action.payload.x,
        y: action.payload.y,
      },
    }
  }

  const nextMode = getNextMode(state.mode, action)

  const shouldResetPointer =
    action.type === ORB_ACTION.enterExplore ||
    action.type === ORB_ACTION.cancelAttach ||
    action.type === ORB_ACTION.commitPaper ||
    action.type === ORB_ACTION.debugExitAttach

  return {
    ...state,
    mode: nextMode,
    pointer: shouldResetPointer ? { hasPointer: false } : state.pointer,
  }
}

export function useOrbStateMachine(initialState: OrbState = initialOrbState) {
  const [state, dispatch] = useReducer(orbStateReducer, initialState)

  const enterExplore = useCallback(() => {
    dispatch({ type: ORB_ACTION.enterExplore })
  }, [])

  const enterAttach = useCallback(() => {
    dispatch({ type: ORB_ACTION.enterAttach })
  }, [])

  const commitPaper = useCallback(() => {
    dispatch({ type: ORB_ACTION.commitPaper })
  }, [])

  const cancelAttach = useCallback(() => {
    dispatch({ type: ORB_ACTION.cancelAttach })
  }, [])

  const debugExitAttach = useCallback(() => {
    dispatch({ type: ORB_ACTION.debugExitAttach })
  }, [])

  const updatePointer = useCallback((payload: { x: number; y: number }) => {
    dispatch({ type: ORB_ACTION.updatePointer, payload })
  }, [])

  return {
    state,
    actions: {
      enterExplore,
      enterAttach,
      commitPaper,
      cancelAttach,
      debugExitAttach,
      updatePointer,
    },
  }
}

