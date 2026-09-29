import { CFG, type CoreId, CORE_DETAILS } from './config'
import { generateMap, groundHeight, type MapData } from './map'
import { createBoxGrid, resolveCollision, raycastPlayers } from './physics'
import { spawnBots, tickBots } from './bots'
import { sound } from './audio'
import type { SceneRenderer } from './scene'
import type { PlayerState, NetMessage, KillMsg, HitConfirmMsg, TelemetryData, MatchResults, NaniteCache, CachePickupMsg, JumpPad, JumpPadLaunchMsg, Portal } from '../net/types'
import { P2PHost, P2PClient } from '../net/webrtc'

export type GameMode = 'solo' | 'host' | 'client'

export interface GameCallbacks {
  onHudUpdate: (
    player: PlayerState,
    matchTime: number,
    hvtId: number | null,
    telemetry: TelemetryData
  ) => void
  onHit: (amount: number, bearing?: number) => void
  onHitConfirm: (msg: HitConfirmMsg) => void
  onKill: (msg: KillMsg) => void
  onCachePickup?: (amount: number) => void
  onLeaderboardUpdate: (leaderboard: { id: number; name: string; score: number; isBot?: boolean; ping?: number }[]) => void
  onMatchEnd: (results: MatchResults) => void
}

/** Balanced, unobstructed spawn locations (fallback) */
export const ARENA_SPAWNS: Array<{ x: number; y: number; z: number; yaw: number }> = [
  { x: 0, y: 1.6, z: 35, yaw: Math.PI },
  { x: 0, y: 1.6, z: 55, yaw: 0 },
  { x: 2.5, y: 1.6, z: 65, yaw: 0 },
  { x: -2.5, y: 1.6, z: 65, yaw: 0 },
  { x: 2.5, y: 1.6, z: 45, yaw: 0 },
  { x: -2.5, y: 1.6, z: 45, yaw: Math.PI },
  { x: 0, y: 1.6, z: -35, yaw: 0 },
  { x: 0, y: 1.6, z: -55, yaw: Math.PI },
  { x: 2.5, y: 1.6, z: -65, yaw: Math.PI },
  { x: -2.5, y: 1.6, z: -65, yaw: Math.PI },
  { x: 2.5, y: 1.6, z: -45, yaw: Math.PI },
  { x: -2.5, y: 1.6, z: -45, yaw: 0 }
]

export function getRandomSpawn(map: MapData): { x: number; y: number; z: number; yaw: number } {
  if (!map || !map.spawns || map.spawns.length === 0) {
    return { x: 0, y: 1.6, z: 0, yaw: Math.random() * Math.PI * 2 }
  }
  const s = map.spawns[Math.floor(Math.random() * map.spawns.length)]
  return {
    x: s.x,
    y: s.y,
    z: s.z,
    yaw: Math.random() * Math.PI * 2
  }
}

export function getArenaSpawn(playerId: number): { x: number; y: number; z: number; yaw: number } {
  const idx = Math.max(0, playerId - 1) % ARENA_SPAWNS.length
  return ARENA_SPAWNS[idx]
}

/** 20 Curated high-value strategic tactical jump pad nodes */
export const JUMP_PAD_CANDIDATE_NODES: Array<{ x: number; z: number; name: string }> = [
  { x: 0, z: 11.5, name: 'Meridian Plaza Steps' },
  { x: 0, z: -11.5, name: 'Meridian South Terrace' },
  { x: -12.5, z: 0, name: 'Meridian West Alley' },
  { x: 12.5, z: 0, name: 'Meridian East Alley' },
  { x: 0, z: 26, name: 'North Courtyard Gate' },
  { x: 0, z: -26, name: 'South Courtyard Gate' },
  { x: 26, z: 0, name: 'East Courtyard Rampart' },
  { x: -26, z: 0, name: 'West Courtyard Rampart' },
  { x: -15, z: 17, name: 'Plaza Fountain West' },
  { x: 15, z: 17, name: 'Plaza Fountain East' },
  { x: -15, z: -17, name: 'South Plaza West' },
  { x: 15, z: -17, name: 'South Plaza East' },
  { x: 0, z: 52, name: 'North Avenue Midway' },
  { x: 0, z: -52, name: 'South Avenue Midway' },
  { x: 42, z: 35, name: 'Northeast Outpost' },
  { x: -42, z: 35, name: 'Northwest Outpost' },
  { x: 42, z: -35, name: 'Southeast Outpost' },
  { x: -42, z: -35, name: 'Southwest Outpost' },
  { x: 68, z: 0, name: 'East Canal Ridge' },
  { x: -68, z: 0, name: 'West Quarry Ridge' },
]

export class GameEngine {
  public localPlayer: PlayerState
  public players = new Map<number, PlayerState>()
  public map: MapData
  public nearbyBoxes: (x: number, z: number) => any[]
  public mode: GameMode = 'solo'
  public matchTime = CFG.MATCH_DURATION
  public isRunning = false
  public isPointerLocked = false
  public isGameOver = false
  public ping = 0
  public fps = 60
  public naniteCaches = new Map<number, NaniteCache>()
  private nextCacheId = 1
  public jumpPads = new Map<number, JumpPad>()
  private nextJumpPadId = 1
  private lastJumpPadTriggerTime = 0
  /** Unstable wormhole pairs (max 1 active): 10s roll, 50% chance, 10s life. */
  public portals = new Map<number, Portal>()
  private nextPortalId = 1
  private lastPortalRoll = 0
  private portalCooldownUntil = 0
  private remotePortalCooldown = new Map<number, number>()

  private pendingSpawns = new Map<number, { x: number; y: number; z: number; yaw: number }>()
  private keys: Record<string, boolean> = {}
  private scene: SceneRenderer
  private callbacks: GameCallbacks
  private tickInterval: any = null
  private pingInterval: any = null
  private frameCount = 0
  private lastFpsUpdate = performance.now()
  private lastFrameTime = performance.now()
  private vy = 0
  private padBoostUntil = 0
  private lastShotTime = 0
  private lastDryFire = 0
  private lastHitTime = Date.now()
  private inputDisposers: Array<() => void> = []
  /** Pending setTimeout/setInterval handles for timed abilities so
   *  destroy()/respawn can cancel them instead of leaking callbacks. */
  private abilityTimers = new Set<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>>()
  /** Last accepted shot timestamp per remote peer (host-side fire-rate limit). */
  private remoteShotAt = new Map<number, number>()
  private trackTimer(t: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>) {
    this.abilityTimers.add(t)
    return t
  }

  private clearAbilityTimers() {
    for (const t of this.abilityTimers) {
      clearTimeout(t as ReturnType<typeof setTimeout>)
      clearInterval(t as ReturnType<typeof setInterval>)
    }
    this.abilityTimers.clear()
  }
  private lastMoveTime = Date.now()
  private lastAbilityUsedAt = 0
  private isMouseHeld = false

  public host: any = null
  public client: any = null

  constructor(
    canvas: HTMLCanvasElement,
    scene: SceneRenderer,
    seed: number,
    callsign: string,
    character: CoreId,
    mode: GameMode,
    callbacks: GameCallbacks
  ) {
    this.scene = scene
    this.mode = mode
    this.callbacks = callbacks
    this.map = generateMap(seed)
    const { nearby } = createBoxGrid(this.map)
    this.nearbyBoxes = nearby
    this.scene.buildMapGeometry(this.map)

    const spawn = this.getRandomSpawn()

    this.localPlayer = {
      id: 1,
      name: callsign || 'Anonymous',
      character,
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      yaw: spawn.yaw,
      pitch: 0,
      health: CFG.MAX_HEALTH,
      score: 0,
      alive: true,
      respawnAt: 0,
      crouching: false,
      superActive: false,
      superEnd: 0,
      shieldActive: false,
      shieldEnd: 0,
      invisible: false,
      cloakEnd: 0,
      lastAbilityAt: 0,
      lastDamageAt: Date.now()
    }
    this.players.set(1, this.localPlayer)

    this.scene.camera.position.set(spawn.x, spawn.y + CFG.EYE_HEIGHT, spawn.z)
    this.scene.camera.rotation.order = 'YXZ'
    this.scene.camera.rotation.y = spawn.yaw

    this.setupInput(canvas)

    if (this.mode === 'solo' || this.mode === 'host') {
      this.initJumpPads()
    }
  }

  public getRandomSpawn(): { x: number; y: number; z: number; yaw: number } {
    return getRandomSpawn(this.map)
  }

  public allocateSpawnForPeer(peerId: number): { x: number; y: number; z: number; yaw: number } {
    const spawn = this.getRandomSpawn()
    this.pendingSpawns.set(peerId, spawn)
    return spawn
  }

  setHostNetwork(host: any) {
    this.host = host
    host.setSpawnProvider?.((id: number) => this.allocateSpawnForPeer(id))
    for (const [id] of host.peers) {
      if (!this.players.has(id)) {
        this.addRemotePlayer(id, `Pilot-${id}`, 'denja')
      }
    }
  }

  setClientNetwork(client: any) {
    this.client = client
    this.client.send({
      type: 'join',
      name: this.localPlayer.name,
      character: this.localPlayer.character
    })
  }

  onPeerConnected(peerId: number, name?: string, character?: CoreId) {
    if (!this.players.has(peerId)) {
      this.addRemotePlayer(peerId, name || `Pilot-${peerId}`, character || 'denja')
    }
  }

  onPeerDisconnected(peerId: number) {
    this.players.delete(peerId)
    this.remoteShotAt.delete(peerId)
    this.remotePortalCooldown.delete(peerId)
    this.scene.updatePlayers([...this.players.values()], this.localPlayer.id)
  }

  addRemotePlayer(id: number, name: string, character: CoreId, spawnOverride?: { x: number; y: number; z: number; yaw?: number }) {
    const spawn = spawnOverride || this.pendingSpawns.get(id) || this.getRandomSpawn()
    this.pendingSpawns.delete(id)
    const safeCharacter: CoreId = CORE_DETAILS[character as CoreId] ? character : 'denja'
    const player: PlayerState = {
      id,
      name: name || `Pilot-${id}`,
      character: safeCharacter,
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      yaw: spawn.yaw ?? Math.random() * Math.PI * 2,
      pitch: 0,
      health: CFG.MAX_HEALTH,
      score: 0,
      alive: true,
      respawnAt: 0,
      crouching: false,
      superActive: false,
      superEnd: 0,
      shieldActive: false,
      shieldEnd: 0,
      invisible: false,
      cloakEnd: 0,
      lastAbilityAt: 0,
      lastDamageAt: Date.now()
    }
    this.players.set(id, player)
    this.scene.updatePlayers([...this.players.values()], this.localPlayer.id)
    console.log(`[Host Engine] Registered remote player ${id} (${player.name})`)
  }

  start() {
    this.isRunning = true
    this.isGameOver = false
    this.lastFrameTime = performance.now()
    this.lastFpsUpdate = performance.now()
    this.frameCount = 0

    if (this.mode === 'solo') {
      const bots = spawnBots(7, this.map)
      for (const b of bots) {
        this.players.set(b.id, b)
      }
    }

    if (this.mode === 'solo' || this.mode === 'host') {
      this.tickInterval = setInterval(() => this.authoritativeTick(), CFG.TICK_MS)
    }

    // Ping interval for WebRTC RTT tracking
    if (this.mode === 'client') {
      this.pingInterval = setInterval(() => {
        if (this.client?.isConnected) {
          this.client.send({ type: 'ping', t: performance.now() })
        }
      }, 1000)
    } else if (this.mode === 'host') {
      this.pingInterval = setInterval(() => {
        if (this.host && this.host.peers.size > 0) {
          this.host.broadcast({ type: 'ping', t: performance.now() })
        }
      }, 1000)
    }

    requestAnimationFrame(this.renderLoop)
  }

  private setupInput(canvas: HTMLCanvasElement) {
    // All listeners are tracked so destroy() can remove them — otherwise
    // every rematch (Play Again / lobby) stacks ghost engines that keep
    // firing into the destroyed scene.
    const on = <K extends keyof WindowEventMap>(
      target: Window | Document,
      type: string,
      handler: (e: any) => void
    ) => {
      target.addEventListener(type, handler as EventListener)
      this.inputDisposers.push(() => target.removeEventListener(type, handler as EventListener))
    }

    on(window, 'keydown', (e: KeyboardEvent) => {
      this.keys[e.key.toLowerCase()] = true
      if (e.key.toLowerCase() === 'c') {
        this.toggleCrouch()
      } else if (e.key.toLowerCase() === 'q') {
        this.triggerClassAbility()
      } else if (e.key.toLowerCase() === 'e') {
        this.triggerSuper()
      } else if (e.key.toLowerCase() === 'r') {
        this.triggerShield()
      } else if (e.key === ' ') {
        this.triggerJump()
      }
    })

    on(window, 'keyup', (e: KeyboardEvent) => {
      this.keys[e.key.toLowerCase()] = false
    })

    on(window, 'mousemove', (e: MouseEvent) => {
      if (document.pointerLockElement) {
        this.localPlayer.yaw -= e.movementX * 0.0018
        this.localPlayer.pitch = Math.max(-1.45, Math.min(1.45, this.localPlayer.pitch - e.movementY * 0.0018))
      }
    })

    on(window, 'mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return
      this.isMouseHeld = true
      if (!document.pointerLockElement) {
        canvas.requestPointerLock?.()
        return
      }
      this.shoot()
    })

    on(window, 'mouseup', (e: MouseEvent) => {
      if (e.button === 0) {
        this.isMouseHeld = false
      }
    })

    on(window, 'blur', () => {
      this.isMouseHeld = false
      this.keys = {}
    })

    on(document, 'pointerlockchange', () => {
      this.isPointerLocked = !!document.pointerLockElement
      if (!document.pointerLockElement) {
        this.isMouseHeld = false
      }
    })
  }

  private teardownInput() {
    for (const dispose of this.inputDisposers) {
      try { dispose() } catch {}
    }
    this.inputDisposers = []
  }

  private setCrouching(state: boolean) {
    if (!this.localPlayer.alive) return
    if (this.localPlayer.crouching === state) return
    this.localPlayer.crouching = state
    if (!state) {
      this.lastMoveTime = Date.now()
      sound.stopRecharge()
    } else {
      sound.startRecharge()
    }
    if (this.mode === 'client') {
      this.client?.send({ type: 'crouch', state })
    }
  }

  private toggleCrouch() {
    this.setCrouching(!this.localPlayer.crouching)
  }

  /** Any hull expenditure (shots, super, shield, jumps) must pause the
   *  calm-window hull reconstruction, otherwise firing would refill
   *  instantly on the next tick. Keeps lastDamageAt (authoritative regen
   *  clock) and lastHitTime (legacy local fallback) in sync. */
  private markHullSpent(player: PlayerState, now: number = Date.now()) {
    player.lastDamageAt = now
    if (player.id === this.localPlayer.id) {
      this.lastHitTime = now
    }
  }

  private triggerJump() {
    if (!this.localPlayer.alive || this.localPlayer.crouching) return
    const onGround = this.isOnGround(this.localPlayer)
    if (!onGround) return

    // Single jump — no modifiers. Verticality comes from jump pads.
    this.vy = CFG.JUMP_SPEED
    if (this.mode === 'client') {
      this.client?.send({ type: 'jump' })
    }
  }

  private triggerSuper() {
    if (!this.localPlayer.alive || this.localPlayer.superActive || this.localPlayer.invisible) return
    if (this.localPlayer.shieldActive) return
    if (this.localPlayer.health >= CFG.SUPER_COST + 1) {
      this.localPlayer.health -= CFG.SUPER_COST
      this.localPlayer.superActive = true
      this.localPlayer.superEnd = Date.now() + CFG.SUPER_DURATION
      this.markHullSpent(this.localPlayer)
      sound.playSuper()
      if (this.mode === 'client') {
        this.client?.send({ type: 'super' })
      }
    }
  }

  private triggerShield() {
    if (!this.localPlayer.alive || this.localPlayer.shieldActive || this.localPlayer.superActive || this.localPlayer.invisible) return
    if (this.localPlayer.health >= CFG.SHIELD_COST + 1) {
      this.localPlayer.health -= CFG.SHIELD_COST
      this.localPlayer.shieldActive = true
      this.localPlayer.shieldEnd = Date.now() + CFG.SHIELD_DURATION
      this.markHullSpent(this.localPlayer)
      sound.playShield()
      if (this.mode === 'client') {
        this.client?.send({ type: 'shield' })
      }
    }
  }

  private triggerClassAbility() {
    if (!this.localPlayer.alive || this.localPlayer.superActive || this.localPlayer.invisible) return
    const now = Date.now()
    // Recall Relay manages its own gate: drops are free, only recalls
    // consume the 30s cooldown (see triggerTelepotu).
    if (this.localPlayer.character === 'telepotu') {
      this.triggerTelepotu(now)
      return
    }
    const core = CORE_DETAILS[this.localPlayer.character]
    if (core.cooldown > 0 && now - this.lastAbilityUsedAt < core.cooldown) return

    this.lastAbilityUsedAt = now
    this.localPlayer.lastAbilityAt = now
    sound.playAbility()

    if (this.mode === 'client') {
      this.client?.send({ type: 'classAbility' })
      return
    }

    // Host or Solo execution of class ability
    this.applyAbility(this.localPlayer)
  }

  /**
   * Telepotu Q routing. Drop (no live anchor) is free and instant so the
   * escape tool is always at hand; recall (live anchor) pays 15 Hull and
   * the 30s cooldown. Client predicts both locally because live-player
   * positions never sync down; the host re-applies authoritatively.
   */
  private triggerTelepotu(now: number) {
    if (!this.hasLiveAnchor(this.localPlayer, now)) {
      sound.playAbility()
      if (this.mode === 'client') {
        this.applyTelepotu(this.localPlayer, now)
        this.client?.send({ type: 'classAbility' })
        return
      }
      this.applyAbility(this.localPlayer)
      return
    }
    if (now - this.lastAbilityUsedAt < CORE_DETAILS.telepotu.cooldown) return
    this.lastAbilityUsedAt = now
    this.localPlayer.lastAbilityAt = now
    sound.playAbility()
    if (this.mode === 'client') {
      this.applyTelepotu(this.localPlayer, now)
      this.client?.send({ type: 'classAbility' })
      return
    }
    this.applyAbility(this.localPlayer)
  }

  private hasLiveAnchor(p: PlayerState, now: number): boolean {
    return (
      p.anchorExpires != null && now < p.anchorExpires &&
      p.anchorX != null && p.anchorY != null && p.anchorZ != null
    )
  }

  private applyAbility(player: PlayerState) {
    const now = Date.now()
    switch (player.character) {
      case 'telepotu':
        this.applyTelepotu(player, now)
        break
      case 'denja':
        // Overdrive: handled via speed multiplier in tick
        break
      case 'mednix':
        player.health = Math.min(CFG.MAX_HEALTH, player.health + Math.floor(Math.random() * 50) + 1)
        break
      case 'tank':
        // Bulwark: half damage for 8s
        break
      case 'anchor':
        player.shieldActive = true
        player.shieldEnd = now + 3000
        break
    }
  }

  private clearAnchor(player: PlayerState) {
    player.anchorX = undefined
    player.anchorY = undefined
    player.anchorZ = undefined
    player.anchorExpires = undefined
  }

  /**
   * Telepotu Recall Relay (two-tap, self-only, deterministic).
   * First press drops a visible anchor at the shell's feet (free).
   * Second press warps back for RECALL_COST hull. Broke recalls fizzle
   * and keep the anchor; attempted recalls consume the 30s cooldown.
   */
  private applyTelepotu(player: PlayerState, now: number): boolean {
    if (!this.hasLiveAnchor(player, now)) {
      player.anchorX = player.x
      player.anchorY = player.y
      player.anchorZ = player.z
      player.anchorExpires = now + CFG.ANCHOR_LIFETIME
      this.scene.portalWarpEffect(player.x, player.y, player.z)
      return true
    }
    if (player.health >= CFG.RECALL_COST + 1) {
      player.health -= CFG.RECALL_COST
      this.markHullSpent(player, now)
      player.x = player.anchorX!
      player.y = player.anchorY!
      player.z = player.anchorZ!
      this.clearAnchor(player)
      this.scene.portalWarpEffect(player.x, player.y, player.z)
      return true
    }
    return false
  }

  private shoot() {
    if (!this.localPlayer.alive || this.localPlayer.invisible) return
    const now = Date.now()
    if (now - this.lastShotTime < CFG.FIRE_INTERVAL_MS) return
    if (this.localPlayer.health <= CFG.SHOT_COST_SINGLE) {
      // Dry-fire feedback (throttled): the trigger does nothing silently otherwise.
      if (now - this.lastDryFire > 250) {
        this.lastDryFire = now
        sound.playDryFire()
      }
      return
    }

    this.lastShotTime = now
    this.localPlayer.health -= CFG.SHOT_COST_SINGLE
    this.markHullSpent(this.localPlayer, now)
    sound.playShoot(this.localPlayer.superActive)

    const yaw = this.localPlayer.yaw, pitch = this.localPlayer.pitch
    const dx = -Math.cos(pitch) * Math.sin(yaw)
    const dy = Math.sin(pitch)
    const dz = -Math.cos(pitch) * Math.cos(yaw)
    const ox = this.localPlayer.x
    const oy = this.localPlayer.y + CFG.EYE_HEIGHT - 0.1
    const oz = this.localPlayer.z

    // 1. Robot hand recoil & muzzle flash
    this.scene.triggerShoot(this.localPlayer.superActive)

    // 2. Visible traveling energy packet
    this.scene.spawnProjectile(ox, oy, oz, dx, dy, dz, this.localPlayer.superActive)

    if (this.mode === 'client') {
      this.client?.send({ type: 'shoot', ox, oy, oz, dx, dy, dz })
      return
    }

    // Host or Solo hitscan
    this.processShot(this.localPlayer)

    if (this.host) {
      this.host.broadcast({
        type: 'projectile',
        ox, oy, oz,
        dx, dy, dz,
        shooterId: this.localPlayer.id,
        superActive: this.localPlayer.superActive
      })
    }
  }

  private processShot(shooter: PlayerState, ox?: number, oy?: number, oz?: number, dx?: number, dy?: number, dz?: number) {
    const yaw = shooter.yaw, pitch = shooter.pitch
    // Explicit origin/dir (sent by remote clients from their true eye) wins;
    // otherwise derive from shooter state (local/solo/host play).
    const _dx = dx ?? -Math.cos(pitch) * Math.sin(yaw)
    const _dy = dy ?? Math.sin(pitch)
    const _dz = dz ?? -Math.cos(pitch) * Math.cos(yaw)
    const _ox = ox ?? shooter.x
    const _oy = oy ?? shooter.y + CFG.EYE_HEIGHT
    const _oz = oz ?? shooter.z

    const targets = [...this.players.values()].filter(p => p.id !== shooter.id && p.alive && !p.invisible)
    const hit = raycastPlayers(shooter.id, _ox, _oy, _oz, _dx, _dy, _dz, targets, this.map, this.nearbyBoxes)

    if (hit) {
      const distMult = Math.max(0.25, 1 - hit.t / 160)
      const superMult = shooter.superActive ? CFG.SUPER_MULT : 1
      const dmg = CFG.DMG_SINGLE * superMult * distMult
      this.applyDamage(hit.id, dmg, shooter.id)
    }
  }

  applyDamage(targetId: number, dmg: number, shooterId: number) {
    const target = this.players.get(targetId)
    if (!target || !target.alive) return

    if (target.shieldActive && Date.now() < target.shieldEnd) {
      // Kinetic block: flash the dome so the save reads visually (no damage, no sound)
      if (target.id === this.localPlayer.id) this.scene.flashFirstPersonShield()
      else this.scene.flashThirdPersonShield(target.id)
      return
    }
    if (target.character === 'tank' && Date.now() - target.lastAbilityAt < 8000) {
      dmg *= 0.5
    }

    const now = Date.now()
    target.health -= dmg
    target.respawnAt = 0
    target.lastDamageAt = now
    if (target.id === this.localPlayer.id) {
      this.lastHitTime = now
    }

    const shooter = this.players.get(shooterId)
    // Shooter bearing relative to the victim's view (0 = dead ahead).
    // Suicides and unknown shooters carry no direction.
    let bearing: number | undefined
    if (shooter && shooter.id !== target.id) {
      bearing = Math.atan2(-(shooter.x - target.x), -(shooter.z - target.z)) - target.yaw
      bearing = Math.atan2(Math.sin(bearing), Math.cos(bearing))
    }
    const hitConfirm = {
      type: 'hitConfirm' as const,
      amount: Math.round(dmg),
      targetName: target.name,
      killed: target.health <= 0
    }
    if (target.id === this.localPlayer.id) {
      sound.playHit()
      this.callbacks.onHit(Math.round(dmg), bearing)
    } else if (this.host) {
      // Remote victim gets their red flash + damage number + direction arc
      this.host.sendTo(target.id, { type: 'hit', amount: Math.round(dmg), bearing })
    }
    if (shooter && shooter.id === this.localPlayer.id) {
      sound.playHitConfirm(target.health <= 0)
      this.callbacks.onHitConfirm(hitConfirm)
    } else if (shooter && this.host) {
      // Remote shooter gets their hit marker
      this.host.sendTo(shooter.id, hitConfirm)
    }

    if (target.health <= 0) {
      target.health = 0
      target.alive = false
      target.respawnAt = Date.now() + CFG.RESPAWN_DELAY

      // Suicides award no frag.
      if (shooter && shooter.id !== target.id) {
        shooter.score++
      }

      // Drop loose nanite cache (100 mass) at death coordinates for salvage
      const cacheY = Math.max(groundHeight(target.x, target.z, this.map.seed), target.y) + 0.8
      this.spawnNaniteCache(target.x, cacheY, target.z, CFG.NANITE_CACHE_AMOUNT)

      // Kill spectacle: chassis burst + scorch mark where the shell fell
      this.scene.killEffect(target.x, target.y + 1.2, target.z)
      this.scene.addScorch(target.x, target.z)

      const killMsg: KillMsg = {
        type: 'kill',
        shooterId,
        targetId,
        shooterName: shooter?.name || '?',
        targetName: target.name
      }
      this.callbacks.onKill(killMsg)

      if (target.id === 1) {
        sound.playDie()
        sound.stopRecharge()
      } else if (shooter?.id === 1) {
        sound.playKill()
      }

      if (this.host) {
        this.host.broadcast(killMsg)
      }
    }
  }

  public spawnNaniteCache(x: number, y: number, z: number, amount: number): NaniteCache {
    const id = this.nextCacheId++
    const cache: NaniteCache = { id, x, y, z, amount }
    this.naniteCaches.set(id, cache)
    this.scene.addNaniteCache(cache)
    return cache
  }

  public syncNaniteCaches(remoteCaches: NaniteCache[]) {
    const currentIds = new Set(this.naniteCaches.keys())
    const remoteIds = new Set(remoteCaches.map(c => c.id))

    for (const rc of remoteCaches) {
      if (!this.naniteCaches.has(rc.id)) {
        this.naniteCaches.set(rc.id, rc)
        this.scene.addNaniteCache(rc)
      }
    }

    for (const id of currentIds) {
      if (!remoteIds.has(id)) {
        this.naniteCaches.delete(id)
        this.scene.removeNaniteCache(id, false)
      }
    }
  }

  public initJumpPads() {
    const available = JUMP_PAD_CANDIDATE_NODES.map((_, i) => i)
    while (this.jumpPads.size < CFG.JUMP_PAD_COUNT && available.length > 0) {
      const pickIdx = Math.floor(Math.random() * available.length)
      const nodeIdx = available.splice(pickIdx, 1)[0]
      this.spawnJumpPad(nodeIdx)
    }
  }

  public spawnJumpPad(nodeIndex: number): JumpPad {
    const node = JUMP_PAD_CANDIDATE_NODES[nodeIndex]
    const id = this.nextJumpPadId++
    const y = groundHeight(node.x, node.z, this.map.seed) + 0.05
    const now = Date.now()
    const pad: JumpPad = {
      id,
      x: node.x,
      y,
      z: node.z,
      nodeIndex,
      createdAt: now,
      expiresAt: now + CFG.JUMP_PAD_LIFETIME * 1000
    }
    this.jumpPads.set(id, pad)
    this.scene.addJumpPad(pad)
    return pad
  }

  public syncJumpPads(remotePads: JumpPad[]) {
    const currentIds = new Set(this.jumpPads.keys())
    const remoteIds = new Set(remotePads.map(p => p.id))

    for (const rp of remotePads) {
      if (!this.jumpPads.has(rp.id)) {
        this.jumpPads.set(rp.id, rp)
        this.scene.addJumpPad(rp)
      } else {
        const local = this.jumpPads.get(rp.id)!
        local.expiresAt = rp.expiresAt
      }
    }

    for (const id of currentIds) {
      if (!remoteIds.has(id)) {
        this.jumpPads.delete(id)
        this.scene.removeJumpPad(id, false)
      }
    }
  }

  public spawnPortal(): Portal {
    const spawns = this.map.spawns
    const a = spawns[Math.floor(Math.random() * spawns.length)]
    let b = spawns[Math.floor(Math.random() * spawns.length)]
    let guard = 0
    while (b === a && guard++ < 8) {
      b = spawns[Math.floor(Math.random() * spawns.length)]
    }
    const id = this.nextPortalId++
    const now = Date.now()
    const portal: Portal = {
      id,
      ax: a.x, ay: a.y, az: a.z,
      bx: b.x, by: b.y, bz: b.z,
      createdAt: now,
      expiresAt: now + CFG.PORTAL_LIFETIME * 1000
    }
    this.portals.set(id, portal)
    this.scene.addPortal(portal)
    sound.playAbility()
    return portal
  }

  public syncPortals(remotePortals: Portal[]) {
    const currentIds = new Set(this.portals.keys())
    const remoteIds = new Set(remotePortals.map(p => p.id))

    for (const rp of remotePortals) {
      if (!this.portals.has(rp.id)) {
        this.portals.set(rp.id, rp)
        this.scene.addPortal(rp)
      }
    }

    for (const id of currentIds) {
      if (!remoteIds.has(id)) {
        this.portals.delete(id)
        this.scene.removePortal(id, false)
      }
    }
  }

  /** Step into one mouth, exit the other. Cooldown stops mouth ping-pong. */
  private tryPortalWarp() {
    if (this.portals.size === 0) return
    const now = Date.now()
    if (now < this.portalCooldownUntil) return
    for (const portal of this.portals.values()) {
      const nearA = Math.hypot(this.localPlayer.x - portal.ax, this.localPlayer.z - portal.az) <= CFG.PORTAL_RADIUS
        && Math.abs(this.localPlayer.y - portal.ay) <= 2.5
      const nearB = Math.hypot(this.localPlayer.x - portal.bx, this.localPlayer.z - portal.bz) <= CFG.PORTAL_RADIUS
        && Math.abs(this.localPlayer.y - portal.by) <= 2.5
      if (!nearA && !nearB) continue
      const dst = nearA
        ? { x: portal.bx, y: portal.by, z: portal.bz }
        : { x: portal.ax, y: portal.ay, z: portal.az }
      this.localPlayer.x = dst.x
      this.localPlayer.y = dst.y
      this.localPlayer.z = dst.z
      this.portalCooldownUntil = now + 1500
      sound.playAbility()
      this.scene.portalWarpEffect(dst.x, dst.y, dst.z)
      if (this.mode === 'client') {
        this.client?.send({ type: 'portalWarp', x: dst.x, y: dst.y, z: dst.z })
      }
      break
    }
  }

  private authoritativeTick() {
    const now = Date.now()
    const dt = CFG.TICK_MS / 1000

    this.matchTime = Math.max(0, this.matchTime - dt)

    // Tick bots if in solo mode
    if (this.mode === 'solo') {
      const bots = [...this.players.values()].filter(p => p.isBot)
      const targets = [...this.players.values()]
        .filter(p => p.alive && !p.invisible)
        .map(p => ({
          id: p.id, x: p.x, y: p.y, z: p.z, alive: p.alive
        }))
      tickBots(
        bots,
        targets,
        this.map,
        this.nearbyBoxes,
        dt,
        (bot, target) => {
          // Bots run the same hull economy as humans: no nanites, no shot.
          if (bot.health <= CFG.SHOT_COST_SINGLE) return
          bot.health -= CFG.SHOT_COST_SINGLE
          bot.lastDamageAt = now
          const dx = target.x - bot.x
          const dy = target.y + 1.2 - (bot.y + 1.2)
          const dz = target.z - bot.z
          const len = Math.hypot(dx, dy, dz)
          if (len > 0) {
            // Visible projectile for bot shot
            this.scene.spawnProjectile(bot.x, bot.y + 1.2, bot.z, dx / len, dy / len, dz / len, false)
            const hit = raycastPlayers(bot.id, bot.x, bot.y + 1.2, bot.z, dx / len, dy / len, dz / len, targets, this.map, this.nearbyBoxes)
            if (hit) {
              this.applyDamage(hit.id, CFG.DMG_SINGLE * 0.5, bot.id)
            }
          }
        },
        [...this.naniteCaches.values()],
        [...this.jumpPads.values()],
        (bot, pad) => {
          sound.playJumpPadLaunch()
          this.scene.triggerJumpPadEffect(pad.x, pad.y, pad.z)
          if (this.host) {
            this.host.broadcast({
              type: 'jumpPadLaunch',
              padId: pad.id,
              playerId: bot.id,
              x: pad.x,
              y: pad.y,
              z: pad.z
            })
          }
        }
      )
    }

    // Unstable wormhole roll: every 10s, 50% chance while none active.
    if (now - this.lastPortalRoll >= CFG.PORTAL_ROLL_MS) {
      this.lastPortalRoll = now
      if (this.portals.size === 0 && Math.random() < CFG.PORTAL_CHANCE) {
        this.spawnPortal()
      }
    }
    for (const [id, portal] of [...this.portals.entries()]) {
      if (now >= portal.expiresAt) {
        this.portals.delete(id)
        this.scene.removePortal(id, true)
      }
    }

    // Maintain active dynamic jump pads (up to CFG.JUMP_PAD_COUNT)
    for (const [id, pad] of [...this.jumpPads.entries()]) {
      if (now >= pad.expiresAt) {
        this.jumpPads.delete(id)
        this.scene.removeJumpPad(id, true)
      }
    }

    if (this.jumpPads.size < CFG.JUMP_PAD_COUNT) {
      const activeNodeIndices = new Set([...this.jumpPads.values()].map(p => p.nodeIndex))
      const availableIndices = JUMP_PAD_CANDIDATE_NODES.map((_, i) => i).filter(i => !activeNodeIndices.has(i))
      while (this.jumpPads.size < CFG.JUMP_PAD_COUNT && availableIndices.length > 0) {
        const pickIdx = Math.floor(Math.random() * availableIndices.length)
        const nodeIdx = availableIndices.splice(pickIdx, 1)[0]
        this.spawnJumpPad(nodeIdx)
      }
    }

    // Health regen for players
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (p.respawnAt > 0 && now >= p.respawnAt) {
          const s = this.getRandomSpawn()
          p.x = s.x
          p.y = s.y
          p.z = s.z
          p.yaw = s.yaw
          p.health = CFG.MAX_HEALTH
          p.alive = true
          p.respawnAt = 0
          p.crouching = false
          p.lastDamageAt = now
          // Fresh chassis: no cloak, overclock or barrier survives death.
          p.invisible = false
          p.cloakEnd = 0
          p.superActive = false
          p.superEnd = 0
          p.shieldActive = false
          p.shieldEnd = 0
          this.clearAnchor(p)
          this.scene.respawnBeam(s.x, s.y, s.z)
          if (p.id === this.localPlayer.id) {
            this.localPlayer.x = s.x
            this.localPlayer.y = s.y
            this.localPlayer.z = s.z
            this.localPlayer.yaw = s.yaw
            this.scene.camera.position.set(s.x, s.y + CFG.EYE_HEIGHT, s.z)
            this.scene.camera.rotation.order = 'YXZ'
            this.scene.camera.rotation.y = s.yaw
            this.lastMoveTime = Date.now()
            sound.stopRecharge()
          }
        }
        continue
      }

      // Nanite Regeneration: after 3 seconds of calm (no damage taken,
      // no hull spent), hull rebuilds gradually at REGEN_RATE per second.
      // Hull spends (shots/super/shield/jumps) also pause regen via markHullSpent,
      // so take the most recent of either clock (lastHitTime is the legacy local fallback).
      const lastDmg = Math.max(p.lastDamageAt ?? 0, p.id === this.localPlayer.id ? this.lastHitTime : 0)
      if (p.health < CFG.MAX_HEALTH && now - lastDmg >= CFG.REGEN_DELAY) {
        // Crouched shells rebuild 3x faster — cover is recovery.
        const rate = (p.crouching ? 3 : 1) * CFG.REGEN_RATE
        p.health = Math.min(CFG.MAX_HEALTH, p.health + rate * dt)
        if (p.health >= CFG.MAX_HEALTH && p.id === this.localPlayer.id) {
          sound.playCachePickup()
        }
      }

      if (p.superActive && now > p.superEnd) p.superActive = false
      if (p.shieldActive && now > p.shieldEnd) p.shieldActive = false
      if (p.anchorExpires && now >= p.anchorExpires) this.clearAnchor(p)
      if (p.invisible && p.cloakEnd && now >= p.cloakEnd) {
        p.invisible = false
        p.cloakEnd = 0
      }
    }

    // Nanite cache pickup checks: closest alive shell within 5u radius siphons mass
    if (this.naniteCaches.size > 0) {
      const alivePlayers = [...this.players.values()].filter(p => p.alive)
      for (const [id, cache] of [...this.naniteCaches.entries()]) {
        let closestPlayer: PlayerState | null = null
        let closestDist = Infinity

        for (const p of alivePlayers) {
          const py = p.y + CFG.PLAYER_HEIGHT * 0.5
          const dist = Math.hypot(p.x - cache.x, py - cache.y, p.z - cache.z)
          if (dist <= CFG.NANITE_CACHE_RADIUS && dist < closestDist) {
            closestDist = dist
            closestPlayer = p
          }
        }

        if (closestPlayer) {
          closestPlayer.health = Math.min(CFG.MAX_HEALTH, closestPlayer.health + cache.amount)
          this.naniteCaches.delete(id)
          this.scene.removeNaniteCache(id, true)

          if (closestPlayer.id === this.localPlayer.id) {
            sound.playCachePickup()
            this.callbacks.onCachePickup?.(cache.amount)
          }

          if (this.host) {
            const pickupMsg: CachePickupMsg = {
              type: 'cachePickup',
              cacheId: id,
              pickerId: closestPlayer.id,
              amount: cache.amount,
              x: cache.x,
              y: cache.y,
              z: cache.z
            }
            this.host.broadcast(pickupMsg)
          }
        }
      }
    }

    // Update leaderboard & HVT
    const ranked = [...this.players.values()].sort((a, b) => b.score - a.score)
    const leaderboard = ranked.slice(0, 5).map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      isBot: p.isBot,
      ping: p.ping || (p.id === this.localPlayer.id ? (this.mode === 'solo' ? 0 : this.ping) : 0)
    }))
    const hvt = ranked.find(p => p.alive && p.score > 0) || null
    this.callbacks.onLeaderboardUpdate(leaderboard)

    if (this.matchTime <= 0 && !this.isGameOver) {
      this.finishMatch()
    }

    // Broadcast state if hosting
    if (this.host) {
      const stateMsg: NetMessage = {
        type: 'gameState',
        tick: Math.floor(now / CFG.TICK_MS),
        matchTime: this.matchTime,
        playerCount: this.players.size,
        aliveCount: [...this.players.values()].filter(p => p.alive).length,
        highValueTargetId: hvt?.id || null,
        leaderboard,
        players: [...this.players.values()],
        naniteCaches: [...this.naniteCaches.values()],
        jumpPads: [...this.jumpPads.values()],
        portals: [...this.portals.values()]
      }
      this.host.broadcast(stateMsg)
    }
  }

  public finishMatch() {
    if (this.isGameOver) return
    this.isGameOver = true
    document.exitPointerLock?.()

    const ranked = [...this.players.values()].sort((a, b) => b.score - a.score)
    const winner = ranked[0]
    const localRank = ranked.findIndex(p => p.id === this.localPlayer.id) + 1

    const results: MatchResults = {
      rank: localRank > 0 ? localRank : 1,
      totalPlayers: this.players.size,
      winnerName: winner ? winner.name : this.localPlayer.name,
      winnerScore: winner ? winner.score : this.localPlayer.score,
      playerScore: this.localPlayer.score,
      isWinner: winner ? winner.id === this.localPlayer.id : true,
      leaderboard: ranked.map(p => ({
        id: p.id,
        name: p.name,
        score: p.score,
        isBot: p.isBot,
        ping: p.ping || (p.id === this.localPlayer.id ? (this.mode === 'solo' ? 0 : this.ping) : 0)
      }))
    }

    if (this.host) {
      this.host.broadcast({
        type: 'matchEnd',
        winnerId: winner?.id || 1,
        winnerName: winner?.name || 'Pilot',
        winnerScore: winner?.score || 0
      })
    }

    this.callbacks.onMatchEnd(results)
  }

  private isOnGround(p: PlayerState): boolean {
    if (p.y <= groundHeight(p.x, p.z, this.map.seed) + 1.65) return true
    for (const box of this.nearbyBoxes(p.x, p.z)) {
      const bTop = box.y + box.h / 2
      const hw = box.w / 2 + CFG.PLAYER_RADIUS
      const hd = box.d / 2 + CFG.PLAYER_RADIUS
      if (Math.abs(p.y - bTop) < 0.15 && Math.abs(p.x - box.x) < hw && Math.abs(p.z - box.z) < hd) {
        return true
      }
    }
    return false
  }

  private renderLoop = (time: number) => {
    if (!this.isRunning) return
    const dt = Math.min(0.1, (time - this.lastFrameTime) / 1000)
    this.lastFrameTime = time

    if (this.localPlayer.alive) {
      // Crouched players are stationary: any WASD input stands back up first
      const wantsMove = !!this.keys['w'] || !!this.keys['s'] || !!this.keys['a'] || !!this.keys['d']
      if (this.localPlayer.crouching && wantsMove) {
        this.setCrouching(false)
      }

      // WASD movement calculation (skipped entirely while crouched)
      let mx = 0, mz = 0
      const yaw = this.localPlayer.yaw
      if (!this.localPlayer.crouching) {
        if (this.keys['w']) { mx -= Math.sin(yaw); mz -= Math.cos(yaw) }
        if (this.keys['s']) { mx += Math.sin(yaw); mz += Math.cos(yaw) }
        if (this.keys['a']) { mx += Math.sin(yaw - Math.PI / 2); mz += Math.cos(yaw - Math.PI / 2) }
        if (this.keys['d']) { mx += Math.sin(yaw + Math.PI / 2); mz += Math.cos(yaw + Math.PI / 2) }
      }

      const len = Math.hypot(mx, mz)
      // RX-11 always runs — no sprint key, no modifiers.
      const isRunning = true
      let speed = CFG.RUN_SPEED

      if (this.localPlayer.superActive) {
        speed *= 2.0
      }
      const rageNow = Date.now()
      if (this.localPlayer.character === 'denja' && rageNow - this.localPlayer.lastAbilityAt < 8000) {
        speed *= 2.0
      }
      // Jump-pad air boost: extra steering speed while airborne after a launch
      if (rageNow < this.padBoostUntil && !this.isOnGround(this.localPlayer)) {
        speed *= CFG.JUMP_PAD_MOMENTUM_BOOST
      }

      if (len > 0) {
        mx = (mx / len) * speed * dt
        mz = (mz / len) * speed * dt
        const col = resolveCollision(this.localPlayer.x + mx, this.localPlayer.y, this.localPlayer.z + mz, this.map, this.nearbyBoxes)
        this.localPlayer.x = col.x
        this.localPlayer.z = col.z
        this.lastMoveTime = Date.now()
        sound.startFootsteps(isRunning)
      } else {
        sound.stopFootsteps()
        // Auto-crouch after 5s of no WASD movement
        if (!this.localPlayer.crouching && Date.now() - this.lastMoveTime > CFG.AUTO_CROUCH_MS) {
          this.setCrouching(true)
        }
      }

      // Vertical gravity & ground detection
      this.vy -= CFG.GRAVITY * dt
      this.localPlayer.y += this.vy * dt

      if (this.vy <= 0) {
        for (const box of this.nearbyBoxes(this.localPlayer.x, this.localPlayer.z)) {
          const bTop = box.y + box.h / 2
          const hw = box.w / 2 + CFG.PLAYER_RADIUS
          const hd = box.d / 2 + CFG.PLAYER_RADIUS
          if (this.localPlayer.y <= bTop && this.localPlayer.y >= bTop - 0.2 &&
              Math.abs(this.localPlayer.x - box.x) < hw && Math.abs(this.localPlayer.z - box.z) < hd) {
            this.localPlayer.y = bTop
            this.vy = 0
            break
          }
        }
      }

      const groundBase = groundHeight(this.localPlayer.x, this.localPlayer.z, this.map.seed) + 1.6
      if (this.localPlayer.y <= groundBase) {
        this.localPlayer.y = groundBase
        this.vy = 0
      }

      // Dynamic Jump Pad Trigger Check
      const now = Date.now()
      if (now - this.lastJumpPadTriggerTime >= CFG.JUMP_PAD_COOLDOWN_MS) {
        for (const pad of this.jumpPads.values()) {
          const dist = Math.hypot(this.localPlayer.x - pad.x, this.localPlayer.z - pad.z)
          if (dist <= CFG.JUMP_PAD_RADIUS && Math.abs(this.localPlayer.y - pad.y) <= 2.2) {
            this.lastJumpPadTriggerTime = now
            if (this.localPlayer.crouching) {
              this.setCrouching(false)
            }
            this.vy = CFG.JUMP_PAD_LAUNCH_VY
            // Air-boost window covers the whole flight (up + down ≈ 2.7s)
            this.padBoostUntil = now + 3000
            sound.playJumpPadLaunch()
            this.scene.triggerJumpPadEffect(pad.x, pad.y, pad.z)

            const launchMsg: JumpPadLaunchMsg = {
              type: 'jumpPadLaunch',
              padId: pad.id,
              playerId: this.localPlayer.id,
              x: pad.x,
              y: pad.y,
              z: pad.z
            }
            if (this.mode === 'client') {
              this.client?.send(launchMsg)
            } else if (this.host) {
              this.host.broadcast(launchMsg)
            }
            break
          }
        }
      }

      // Wormhole transit check (before the camera snaps to the new spot)
      this.tryPortalWarp()

      // Camera position
      const eyeH = this.localPlayer.crouching ? CFG.CROUCH_EYE_HEIGHT : CFG.EYE_HEIGHT
      this.scene.camera.position.set(this.localPlayer.x, this.localPlayer.y + eyeH, this.localPlayer.z)
      this.scene.camera.rotation.order = 'YXZ'
      this.scene.camera.rotation.y = this.localPlayer.yaw
      this.scene.camera.rotation.x = this.localPlayer.pitch

      // Hold-to-fire: works while stationary or moving (shoot() rate-limits via lastShotTime)
      if (this.isMouseHeld && document.pointerLockElement) {
        this.shoot()
      }

      // Send client input packet if connected as client
      if (this.mode === 'client') {
        this.client?.send({
          type: 'input',
          forward: !!this.keys['w'],
          back: !!this.keys['s'],
          left: !!this.keys['a'],
          right: !!this.keys['d'],
          run: isRunning,
          yaw: this.localPlayer.yaw,
          pitch: this.localPlayer.pitch,
          x: this.localPlayer.x,
          y: this.localPlayer.y,
          z: this.localPlayer.z,
          dt
        })
      }
    }

    // Update 3D scene players
    this.scene.updatePlayers([...this.players.values()], this.localPlayer.id)
    const isMoving = this.localPlayer.alive && (!!this.keys['w'] || !!this.keys['s'] || !!this.keys['a'] || !!this.keys['d'])
    // Dead shells drop the first-person arm — the chassis is gone.
    this.scene.setViewmodelVisible(this.localPlayer.alive)
    const shieldFrac = this.localPlayer.shieldActive
      ? Math.max(0, Math.min(1, (this.localPlayer.shieldEnd - Date.now()) / CFG.SHIELD_DURATION))
      : 1
    this.scene.render(dt, isMoving, this.localPlayer.superActive, this.localPlayer.shieldActive, this.localPlayer.crouching, shieldFrac)

    // Calculate rolling FPS
    this.frameCount++
    if (time - this.lastFpsUpdate >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / (time - this.lastFpsUpdate))
      this.frameCount = 0
      this.lastFpsUpdate = time
    }

    const humanCount = [...this.players.values()].filter(p => !p.isBot).length
    const botCount = [...this.players.values()].filter(p => p.isBot).length

    // Proximity tactical tracker: nearest active pilot within 100m only —
    // anything further stays hidden so the radar never gives away positions.
    // Crouched shells are off the radar: holding still behind cover to
    // rebuild Hull must not broadcast your presence.
    let nearestPilot: { name: string; distance: number; character: CoreId } | undefined = undefined
    let minD = 100
    for (const p of this.players.values()) {
      if (p.id !== this.localPlayer.id && p.alive && !p.invisible && !p.crouching) {
        const d = Math.hypot(p.x - this.localPlayer.x, p.z - this.localPlayer.z)
        if (d <= minD) {
          minD = d
          nearestPilot = {
            name: p.name,
            distance: Math.round(d),
            character: p.character
          }
        }
      }
    }

    const telemetry: TelemetryData = {
      ping: this.mode === 'solo' ? 0 : this.ping,
      fps: this.fps,
      connectedPlayers: this.players.size,
      humanPlayers: humanCount,
      botPlayers: botCount,
      mode: this.mode,
      tickRate: 20,
      nearestPilot
    }

    // Check match completion in render loop
    if (this.matchTime <= 0 && !this.isGameOver) {
      this.finishMatch()
    }

    // Notify UI
    this.callbacks.onHudUpdate(this.localPlayer, this.matchTime, null, telemetry)

    requestAnimationFrame(this.renderLoop)
  }

  handleNetworkMessage(msg: NetMessage, fromId?: number) {
    if (msg.type === 'gameState') {
      this.matchTime = msg.matchTime
      if (this.matchTime <= 0 && !this.isGameOver) {
        this.finishMatch()
      }
      for (const p of msg.players) {
        if (p.id === this.localPlayer.id) {
          const wasDead = !this.localPlayer.alive && p.alive
          // Sync server-authoritative health, score, status. lastDamageAt
          // takes the newest of either clock so the HUD regen countdown
          // tracks damage the host observed; cloak/invisibility also come
          // from the host because clients never apply Q locally.
          this.localPlayer.health = p.health
          this.localPlayer.score = p.score
          this.localPlayer.alive = p.alive
          this.localPlayer.respawnAt = p.respawnAt ?? 0
          this.localPlayer.superActive = p.superActive
          this.localPlayer.shieldActive = p.shieldActive
          this.localPlayer.invisible = p.invisible
          this.localPlayer.cloakEnd = p.cloakEnd ?? 0
          this.localPlayer.lastDamageAt = Math.max(
            this.localPlayer.lastDamageAt ?? 0,
            p.lastDamageAt ?? 0
          )
          if (wasDead) {
            this.localPlayer.x = p.x
            this.localPlayer.y = p.y
            this.localPlayer.z = p.z
            this.localPlayer.yaw = p.yaw
            this.scene.camera.position.set(p.x, p.y + CFG.EYE_HEIGHT, p.z)
            this.scene.camera.rotation.order = 'YXZ'
            this.scene.camera.rotation.y = p.yaw
            this.lastMoveTime = Date.now()
            sound.stopRecharge()
          }
        } else {
          this.players.set(p.id, p)
        }
      }
      if (msg.naniteCaches) {
        this.syncNaniteCaches(msg.naniteCaches)
      }
      if (msg.jumpPads) {
        this.syncJumpPads(msg.jumpPads)
      }
      if (msg.portals) {
        this.syncPortals(msg.portals)
      }
      this.callbacks.onLeaderboardUpdate(msg.leaderboard)
    } else if (msg.type === 'jumpPadLaunch') {
      this.scene.triggerJumpPadEffect(msg.x, msg.y, msg.z)
      if (msg.playerId !== this.localPlayer.id) {
        sound.playJumpPadLaunch()
      }
      if (this.host) {
        this.host.broadcast(msg)
      }
    } else if (msg.type === 'portalWarp' && fromId && this.players.has(fromId)) {
      const p = this.players.get(fromId)!
      if (!p.alive) return
      const warpNow = Date.now()
      if (warpNow < (this.remotePortalCooldown.get(fromId) ?? 0)) return
      // Exit must be at a real portal mouth — no teleport hacks.
      let ok = false
      for (const portal of this.portals.values()) {
        const dA = Math.hypot(msg.x - portal.ax, msg.z - portal.az)
        const dB = Math.hypot(msg.x - portal.bx, msg.z - portal.bz)
        if ((dA <= 6 || dB <= 6) && Math.abs(msg.y - portal.ay) <= 4) {
          ok = true
          break
        }
      }
      if (!ok) return
      p.x = msg.x
      p.y = msg.y
      p.z = msg.z
      this.remotePortalCooldown.set(fromId, warpNow + 1500)
      this.scene.portalWarpEffect(msg.x, msg.y, msg.z)
    } else if (msg.type === 'cachePickup') {
      this.naniteCaches.delete(msg.cacheId)
      this.scene.removeNaniteCache(msg.cacheId, true)
      if (msg.pickerId === this.localPlayer.id) {
        sound.playCachePickup()
        this.callbacks.onCachePickup?.(msg.amount)
      }
    } else if (msg.type === 'hit') {
      sound.playHit()
      const now = Date.now()
      this.lastHitTime = now
      this.localPlayer.lastDamageAt = now
      this.callbacks.onHit(msg.amount, msg.bearing)
    } else if (msg.type === 'hitConfirm') {
      sound.playHitConfirm(msg.killed)
      this.callbacks.onHitConfirm(msg)
    } else if (msg.type === 'kill') {
      this.callbacks.onKill(msg)
    } else if (msg.type === 'input' && fromId && this.players.has(fromId)) {
      const p = this.players.get(fromId)!
      p.yaw = msg.yaw
      p.pitch = msg.pitch
      // Remote coordinates: client-authoritative but speed-clamped so a
      // tampered client cannot teleport across the map. Budget covers the
      // fastest legit combo (sprint × super × denja) plus lag slack.
      const dtBudget = Math.min(Math.max(typeof msg.dt === 'number' ? msg.dt : 0.05, 0), 1)
      const maxStep = CFG.RUN_SPEED * 2 * 2 * dtBudget + 2.5
      const maxDy = CFG.JUMP_PAD_LAUNCH_VY * dtBudget + 2.5
      if (typeof msg.x === 'number' && isFinite(msg.x) && typeof msg.z === 'number' && isFinite(msg.z)) {
        let dx = msg.x - p.x
        let dz = msg.z - p.z
        const dist = Math.hypot(dx, dz)
        if (dist > maxStep) {
          const k = maxStep / dist
          dx *= k
          dz *= k
        }
        const col = resolveCollision(p.x + dx, p.y, p.z + dz, this.map, this.nearbyBoxes)
        p.x = col.x
        p.z = col.z
      }
      if (typeof msg.y === 'number' && isFinite(msg.y)) {
        const dy = msg.y - p.y
        p.y = p.y + Math.max(-maxDy, Math.min(maxDy, dy))
      }
      // Crouched remotes are stationary until they send uncrouch
      if (p.crouching) return
      // Fallback dead-reckoning if client did not send x or z
      if (typeof msg.x !== 'number' || typeof msg.z !== 'number') {
        let mx = 0, mz = 0
        if (msg.forward) { mx -= Math.sin(p.yaw); mz -= Math.cos(p.yaw) }
        if (msg.back) { mx += Math.sin(p.yaw); mz += Math.cos(p.yaw) }
        if (msg.left) { mx += Math.sin(p.yaw - Math.PI / 2); mz += Math.cos(p.yaw - Math.PI / 2) }
        if (msg.right) { mx += Math.sin(p.yaw + Math.PI / 2); mz += Math.cos(p.yaw + Math.PI / 2) }
        const len = Math.hypot(mx, mz)
        if (len > 0) {
          let speed = CFG.RUN_SPEED
          if (p.superActive) {
            speed *= 2.0
          }
          const rn = Date.now()
          if (p.character === 'denja' && rn - p.lastAbilityAt < 8000) {
            speed *= 2.0
          }
          mx = (mx / len) * speed * Math.min(Math.max(msg.dt || 0, 0), 0.25)
          mz = (mz / len) * speed * Math.min(Math.max(msg.dt || 0, 0), 0.25)
          const col = resolveCollision(p.x + mx, p.y, p.z + mz, this.map, this.nearbyBoxes)
          p.x = col.x
          p.z = col.z
        }
      }
    } else if (msg.type === 'shoot' && fromId && this.players.has(fromId)) {
      const shooter = this.players.get(fromId)!
      if (!shooter.alive || shooter.invisible) return
      // Host-side fire-rate limit mirrors the local gate so packet
      // spam cannot buy unlimited DPS.
      const now = Date.now()
      if (now - (this.remoteShotAt.get(fromId) ?? 0) < CFG.FIRE_INTERVAL_MS) return
      this.remoteShotAt.set(fromId, now)
      if (shooter.health <= CFG.SHOT_COST_SINGLE) return
      shooter.health -= CFG.SHOT_COST_SINGLE
      shooter.lastDamageAt = Date.now()
      // Hitscan from the shooter's true eye, not our (possibly stale) copy
      const yaw = shooter.yaw, pitch = shooter.pitch
      const dx = msg.dx ?? (-Math.cos(pitch) * Math.sin(yaw))
      const dy = msg.dy ?? Math.sin(pitch)
      const dz = msg.dz ?? (-Math.cos(pitch) * Math.cos(yaw))
      const ox = msg.ox ?? shooter.x
      const oy = msg.oy ?? (shooter.y + CFG.EYE_HEIGHT - 0.1)
      const oz = msg.oz ?? shooter.z
      this.processShot(shooter, ox, oy, oz, dx, dy, dz)

      // Host spawns projectile so host can see remote shot
      this.scene.spawnProjectile(ox, oy, oz, dx, dy, dz, shooter.superActive)

      // Host broadcasts to all other clients
      if (this.host) {
        this.host.broadcast({
          type: 'projectile',
          ox, oy, oz,
          dx, dy, dz,
          shooterId: shooter.id,
          superActive: shooter.superActive
        }, fromId)
      }
    } else if (msg.type === 'projectile') {
      this.scene.spawnProjectile(msg.ox, msg.oy, msg.oz, msg.dx, msg.dy, msg.dz, msg.superActive)
    } else if (msg.type === 'ping') {
      if (this.mode === 'client') {
        this.client?.send({ type: 'pong', t: msg.t })
      } else if (this.mode === 'host' && fromId) {
        this.host?.sendTo(fromId, { type: 'pong', t: msg.t, fromId })
      }
    } else if (msg.type === 'pong') {
      const rtt = Math.max(1, Math.round(performance.now() - msg.t))
      this.ping = this.ping ? Math.round(this.ping * 0.7 + rtt * 0.3) : rtt
      if (fromId && this.players.has(fromId)) {
        this.players.get(fromId)!.ping = rtt
      }
    } else if (msg.type === 'matchEnd') {
      this.finishMatch()
    } else if (msg.type === 'welcome') {
      const oldId = this.localPlayer.id
      this.localPlayer.id = msg.playerId
      this.players.delete(oldId)
      this.players.set(msg.playerId, this.localPlayer)
      console.log(`[Client] Received welcome packet. Assigned player ID: ${msg.playerId}`)
      if (typeof msg.x === 'number' && typeof msg.y === 'number' && typeof msg.z === 'number') {
        this.localPlayer.x = msg.x
        this.localPlayer.y = msg.y
        this.localPlayer.z = msg.z
        this.localPlayer.yaw = typeof msg.yaw === 'number' ? msg.yaw : Math.random() * Math.PI * 2
        this.scene.camera.position.set(msg.x, msg.y + CFG.EYE_HEIGHT, msg.z)
        this.scene.camera.rotation.order = 'YXZ'
        this.scene.camera.rotation.y = this.localPlayer.yaw
      }
      this.client?.send({
        type: 'join',
        name: this.localPlayer.name,
        character: this.localPlayer.character
      })
      this.scene.updatePlayers([...this.players.values()], this.localPlayer.id)
    } else if (msg.type === 'join' && fromId) {
      const safeCharacter: CoreId = CORE_DETAILS[msg.character as CoreId] ? msg.character : 'denja'
      const p = this.players.get(fromId)
      if (p) {
        p.name = msg.name
        p.character = safeCharacter
      } else {
        this.addRemotePlayer(fromId, msg.name, safeCharacter)
      }
    } else if (msg.type === 'super' && fromId && this.players.has(fromId)) {
      const p = this.players.get(fromId)!
      if (p.alive && !p.superActive && !p.shieldActive && !p.invisible && p.health >= CFG.SUPER_COST + 1) {
        p.health -= CFG.SUPER_COST
        p.lastDamageAt = Date.now()
        p.superActive = true
        p.superEnd = Date.now() + CFG.SUPER_DURATION
      }
    } else if (msg.type === 'shield' && fromId && this.players.has(fromId)) {
      const p = this.players.get(fromId)!
      if (p.alive && !p.shieldActive && !p.superActive && !p.invisible && p.health >= CFG.SHIELD_COST + 1) {
        p.health -= CFG.SHIELD_COST
        p.lastDamageAt = Date.now()
        p.shieldActive = true
        p.shieldEnd = Date.now() + CFG.SHIELD_DURATION
      }
    } else if (msg.type === 'jump_super' && fromId && this.players.has(fromId)) {
      const p = this.players.get(fromId)!
      if (p.alive && !p.crouching && p.health > CFG.SUPER_JUMP_COST) {
        p.health -= CFG.SUPER_JUMP_COST
        p.lastDamageAt = Date.now()
      }
    } else if (msg.type === 'classAbility' && fromId && this.players.has(fromId)) {
      const p = this.players.get(fromId)!
      if (p.alive && !p.superActive && !p.invisible) {
        // Host-side cooldown mirrors the local gate so Q-packet spam
        // cannot buy infinite heals/drains/immunities.
        const now = Date.now()
        // Relay drops are free (no anchor yet); only recalls are gated.
        if (p.character === 'telepotu' && !this.hasLiveAnchor(p, now)) {
          this.applyTelepotu(p, now)
        } else {
          const cooldown = CORE_DETAILS[p.character]?.cooldown ?? 0
          if (cooldown > 0 && now - (p.lastAbilityAt || 0) < cooldown) return
          p.lastAbilityAt = now
          this.applyAbility(p)
        }
      }
    } else if (msg.type === 'crouch' && fromId && this.players.has(fromId)) {
      this.players.get(fromId)!.crouching = msg.state
    }
  }

  destroy() {
    this.isRunning = false
    this.teardownInput()
    this.clearAbilityTimers()
    if (this.tickInterval) clearInterval(this.tickInterval)
    if (this.pingInterval) clearInterval(this.pingInterval)
    sound.stopFootsteps()
    sound.stopRecharge()
    this.naniteCaches.clear()
    this.jumpPads.clear()
    this.scene.destroy()
    this.host?.destroy()
    this.client?.destroy()
  }
}
