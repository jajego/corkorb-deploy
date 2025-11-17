/**
 * TypeScript type definitions for WebSocket messages and related types.
 */

export interface WebSocketMessageBase {
  request_id?: string | null
}

export interface SuccessMessage extends WebSocketMessageBase {
  type: 'success'
  data: WrappedEventData
}

export interface ErrorMessage extends WebSocketMessageBase {
  type: 'error'
  error: string
  error_code?: string
}

export interface StateMessage extends WebSocketMessageBase {
  type: 'state'
  orb_id: string
  papers: ServerPaper[]
  connected_users_count?: number
  anonymous_users_count?: number
}

export interface PaperCreatedMessage extends WebSocketMessageBase {
  type: 'paper_created'
  orb_id: string
  paper: ServerPaper
}

export interface PaperDeletedMessage extends WebSocketMessageBase {
  type: 'paper_deleted'
  orb_id: string
  paper_id: string
  reason?: string // 'nsfw_violation' | 'user_deleted' | undefined
}

export interface OrbCreatedMessage extends WebSocketMessageBase {
  type: 'orb_created'
  orb: ServerOrb
}

export interface OrbDeletedMessage extends WebSocketMessageBase {
  type: 'orb_deleted'
  orb_id: string
}

export interface UserJoinedMessage extends WebSocketMessageBase {
  type: 'user_joined'
  orb_id: string
  user_id: string
  username?: string | null
}

export interface UserLeftMessage extends WebSocketMessageBase {
  type: 'user_left'
  orb_id: string
  user_id: string
  username?: string | null
}

export interface ViewCenter {
  radius: number
  phi: number
  theta: number
}

export interface ViewCenterUpdateMessage extends WebSocketMessageBase {
  type: 'view_center_update'
  orb_id: string
  user_id: string
  view_center: ViewCenter
}

export interface ConnectedUsersCountMessage extends WebSocketMessageBase {
  type: 'connected_users_count'
  orb_id: string
  connected_users_count: number
  anonymous_users_count: number
}

export interface PingMessage {
  type: 'ping'
}

export type WebSocketMessage =
  | SuccessMessage
  | ErrorMessage
  | StateMessage
  | PaperCreatedMessage
  | PaperDeletedMessage
  | OrbCreatedMessage
  | OrbDeletedMessage
  | UserJoinedMessage
  | UserLeftMessage
  | ViewCenterUpdateMessage
  | ConnectedUsersCountMessage
  | PingMessage

export type WrappedEventData =
  | { type: 'paper_created'; paper: ServerPaper }
  | { type: 'paper_deleted'; paper_id: string; reason?: string }
  | { type: 'orb_created'; orb: ServerOrb }
  | { type: 'orb_deleted'; orb_id: string }
  | { type: 'user_joined'; user_id: string; username?: string | null }
  | { type: 'user_left'; user_id: string; username?: string | null }
  | { type: 'view_center_update'; user_id: string; view_center: ViewCenter }

export interface ServerOrb {
  id: string
  created_at: string
  updated_at: string
  last_accessed: string | null
  max_papers: number
}

export interface ServerPaperData {
  center?: { x: number; y: number; z: number }
  quaternion?: { x: number; y: number; z: number; w: number }
  basisRight?: { x: number; y: number; z: number }
  basisUp?: { x: number; y: number; z: number }
  positions?: number[]
  normals?: number[]
  scale?: number
  aspect?: number
  rotation?: number
  layerOffset?: number
}

export interface ServerPaper {
  id: string
  user_id: string
  username?: string | null
  source_url: string
  created_at: string
  data?: ServerPaperData
  pin: {
    position: { x: number; y: number; z: number }
    color: string
  }
}

