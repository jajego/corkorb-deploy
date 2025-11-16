import { ORB_MODE, type OrbMode } from '../state'
import './AttachHud.css'

type AttachHudProps = {
  mode: OrbMode
  onEnterAttach: () => void
}

export function AttachHud({ mode, onEnterAttach }: AttachHudProps) {
  if (mode !== ORB_MODE.Explore) return null

  return (
    <div className="attachHud">
      <button type="button" onClick={onEnterAttach}>
        Attach an Image
      </button>
    </div>
  )
}

