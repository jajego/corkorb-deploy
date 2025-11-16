export const ORB_EVENT = {
  startDrag: 'corkorb/orb-drag-start',
} as const

export type OrbEventName = (typeof ORB_EVENT)[keyof typeof ORB_EVENT]

type OrbEventDetailMap = {
  [ORB_EVENT.startDrag]: { x: number; y: number }
}

export function dispatchOrbEvent<T extends OrbEventName>(
  type: T,
  detail: OrbEventDetailMap[T]
) {
  window.dispatchEvent(new CustomEvent(type, { detail }))
}

