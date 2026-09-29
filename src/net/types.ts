import type { CoreId } from '../game/config'

export interface PlayerState {
  id: number
  name: string
  character: CoreId
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  health: number
  score: number
  alive: boolean
  respawnAt: number
  crouching: boolean
  superActive: boolean
  superEnd: number
  shieldActive: boolean
  shieldEnd: number
  invisible: boolean
  cloakEnd?: number
  lastAbilityAt: number
  lastDamageAt?: number
  /** Telepotu recall anchor: drop point + expiry. Synced via gameState. */
  anchorX?: number
  anchorY?: number
  anchorZ?: number
  anchorExpires?: number
  isBot?: boolean
  ping?: number
}

export interface NaniteCache {
  id: number
  x: number
  y: number
  z: number
  amount: number
}

export interface JumpPad {
  id: number
  x: number
  y: number
  z: number
  nodeIndex: number
  createdAt: number
  expiresAt: number
}

/** Unstable wormhole pair: stepping into either end exits the other. */
export interface Portal {
  id: number
  ax: number
  ay: number
  az: number
  bx: number
  by: number
  bz: number
  createdAt: number
  expiresAt: number
}

export interface GameStateMsg {
  type: 'gameState'
  tick: number
  matchTime: number
  playerCount: number
  aliveCount: number
  highValueTargetId: number | null
  leaderboard: { id: number; name: string; score: number; isBot?: boolean; ping?: number }[]
  players: PlayerState[]
  naniteCaches?: NaniteCache[]
  jumpPads?: JumpPad[]
  portals?: Portal[]
}

export interface InputMsg {
  type: 'input'
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  run: boolean
  yaw: number
  pitch: number
  dt: number
  /** Authoritative client coordinates */
  x?: number
  y?: number
  z?: number
}

export interface ShootMsg {
  type: 'shoot'
  ox?: number
  oy?: number
  oz?: number
  dx?: number
  dy?: number
  dz?: number
}

export interface ChargedShootMsg {
  type: 'chargedShoot'
  count: number
}

export interface AbilityMsg {
  type: 'classAbility'
}

export interface SuperMsg {
  type: 'super'
}

export interface ShieldMsg {
  type: 'shield'
}

export interface JumpMsg {
  type: 'jump'
}

export interface SuperJumpMsg {
  type: 'jump_super'
}

export interface CrouchMsg {
  type: 'crouch'
  state: boolean
}

export interface HitMsg {
  type: 'hit'
  amount: number
}

export interface HitConfirmMsg {
  type: 'hitConfirm'
  amount: number
  targetName: string
  killed: boolean
}

export interface KillMsg {
  type: 'kill'
  shooterId: number
  targetId: number
  shooterName: string
  targetName: string
}

export interface CachePickupMsg {
  type: 'cachePickup'
  cacheId: number
  pickerId: number
  amount: number
  x: number
  y: number
  z: number
}

export interface JumpPadLaunchMsg {
  type: 'jumpPadLaunch'
  padId: number
  playerId: number
  x: number
  y: number
  z: number
}

export interface PortalWarpMsg {
  type: 'portalWarp'
  x: number
  y: number
  z: number
}

export interface WelcomeMsg {
  type: 'welcome'
  playerId: number
  seed: number
  hostId: number
  x?: number
  y?: number
  z?: number
  yaw?: number
}

export interface JoinMsg {
  type: 'join'
  name: string
  character: CoreId
}

export interface PingMsg {
  type: 'ping'
  t: number
  fromId?: number
}

export interface PongMsg {
  type: 'pong'
  t: number
  fromId?: number
}

export interface ProjectileMsg {
  type: 'projectile'
  ox: number
  oy: number
  oz: number
  dx: number
  dy: number
  dz: number
  shooterId: number
  superActive: boolean
}

export interface MatchEndMsg {
  type: 'matchEnd'
  winnerId: number
  winnerName: string
  winnerScore: number
}

export type NetMessage =
  | GameStateMsg
  | InputMsg
  | ShootMsg
  | ChargedShootMsg
  | AbilityMsg
  | SuperMsg
  | ShieldMsg
  | JumpMsg
  | SuperJumpMsg
  | CrouchMsg
  | HitMsg
  | HitConfirmMsg
  | KillMsg
  | CachePickupMsg
  | JumpPadLaunchMsg
  | PortalWarpMsg
  | WelcomeMsg
  | JoinMsg
  | PingMsg
  | PongMsg
  | ProjectileMsg
  | MatchEndMsg

export interface TelemetryData {
  ping: number
  fps: number
  connectedPlayers: number
  humanPlayers: number
  botPlayers: number
  mode: 'solo' | 'host' | 'client'
  tickRate: number
  nearestPilot?: {
    name: string
    distance: number
    character: CoreId
  }
}

export interface MatchResults {
  rank: number
  totalPlayers: number
  winnerName: string
  winnerScore: number
  playerScore: number
  isWinner: boolean
  leaderboard: { id: number; name: string; score: number; isBot?: boolean; ping?: number }[]
}
