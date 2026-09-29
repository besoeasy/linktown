import mqtt, { type MqttClient } from 'mqtt'
import type { CoreId } from '../game/config'

// Public-room presence over a public MQTT broker (PeerJS itself has no
// rooms/presence/listing — it only brokers signaling). Hosts heartbeat a
// retained listing; the lobby subscribes and shows all live public games.
// Joins stay direct peer-to-peer by room code. If the broker is unreachable
// the game still works — manual code join is unaffected.
export interface PublicRoom {
  code: string
  name: string
  core: CoreId
  players: number
  maxPlayers: number
  updatedAt: number
}

const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt'
const TOPIC_PREFIX = 'ltown/rooms/'
const HEARTBEAT_MS = 15000
const EXPIRE_MS = 5 * 60 * 1000 // purge listings older than 5 minutes
const CONNECT_TIMEOUT_MS = 8000

function topicFor(code: string): string {
  return `${TOPIC_PREFIX}${code.trim().toUpperCase()}`
}

function sanitize(raw: any): PublicRoom | null {
  if (!raw || typeof raw !== 'object') return null
  const code = typeof raw.code === 'string' ? raw.code.trim().toUpperCase() : ''
  if (!/^[0-9A-Z]{4}$/.test(code)) return null
  const players = Math.max(1, Math.min(16, Math.floor(Number(raw.players) || 1)))
  const allowedCores = ['denja', 'mednix', 'tank', 'anchor'] as const
  const core = allowedCores.includes(raw.core as any) ? (raw.core as PublicRoom['core']) : 'denja'
  return {
    code,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 40) : `${code} trial`,
    core,
    players,
    maxPlayers: 16,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
  }
}

export class RoomDirectory {
  private client: MqttClient | null = null
  private connecting: Promise<boolean> | null = null
  private rooms = new Map<string, PublicRoom>()
  private listeners = new Set<(rooms: PublicRoom[]) => void>()
  private heartbeatTimer: any = null
  private expiryTimer: any = null
  private hosted: PublicRoom | null = null
  readonly connected = { value: false }

  connect(): Promise<boolean> {
    if (this.client?.connected) return Promise.resolve(true)
    if (this.connecting) return this.connecting
    this.connecting = new Promise((resolve) => {
      let done = false
      const finish = (ok: boolean) => {
        if (done) return
        done = true
        this.connecting = null
        resolve(ok)
      }
      const timer = setTimeout(() => {
        try { this.client?.end(true) } catch {}
        this.client = null
        finish(false)
      }, CONNECT_TIMEOUT_MS)
      try {
        const client = mqtt.connect(BROKER_URL, {
          connectTimeout: CONNECT_TIMEOUT_MS,
          reconnectPeriod: 5000,
          clientId: `ltown-${Math.random().toString(36).slice(2, 10)}`
        })
        this.client = client
        client.on('connect', () => {
          clearTimeout(timer)
          this.connected.value = true
          client.subscribe(`${TOPIC_PREFIX}+`, { qos: 0 }, () => {})
          // Re-announce our hosting after reconnects so the listing heals.
          if (this.hosted) this.sendListing(this.hosted)
          this.startExpiry()
          finish(true)
        })
        client.on('message', (topic, payload) => {
          if (!topic.startsWith(TOPIC_PREFIX)) return
          const code = topic.slice(TOPIC_PREFIX.length).toUpperCase()
          try {
            if (payload.length === 0) {
              if (this.rooms.delete(code)) this.emit()
              return
            }
            const room = sanitize(JSON.parse(payload.toString()))
            if (room && room.code === code) {
              this.rooms.set(code, room)
              this.emit()
            }
          } catch {}
        })
        client.on('close', () => {
          this.connected.value = false
        })
        client.on('error', () => {
          // finish(false) only before first connect; reconnects retry quietly
          if (!client.connected) {
            clearTimeout(timer)
            finish(false)
          }
        })
      } catch {
        clearTimeout(timer)
        finish(false)
      }
    })
    return this.connecting
  }

  onRooms(cb: (rooms: PublicRoom[]) => void): () => void {
    this.listeners.add(cb)
    cb(this.snapshot())
    return () => {
      this.listeners.delete(cb)
    }
  }

  /** (Re)announce a hosted room; heartbeats keep it alive. */
  publish(room: Omit<PublicRoom, 'updatedAt' | 'maxPlayers'> & { players: number }) {
    const listing: PublicRoom = {
      code: room.code.trim().toUpperCase(),
      name: room.name,
      core: room.core,
      players: Math.max(1, Math.min(16, Math.floor(room.players))),
      maxPlayers: 16,
      updatedAt: Date.now()
    }
    this.hosted = listing
    this.sendListing(listing)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(() => {
      if (this.hosted) this.sendListing({ ...this.hosted, updatedAt: Date.now() })
    }, HEARTBEAT_MS)
  }

  /** Withdraw the hosted listing (retained-empty clears it for subscribers). */
  unpublish() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.hosted && this.client?.connected) {
      try {
        this.client.publish(topicFor(this.hosted.code), '', { retain: true, qos: 0 })
      } catch {}
    }
    this.hosted = null
  }

  /** Drop expired entries and re-emit (manual refresh button). */
  refresh() {
    this.prune()
    this.emit()
  }

  destroy() {
    this.unpublish()
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer)
      this.expiryTimer = null
    }
    this.listeners.clear()
    this.rooms.clear()
    try { this.client?.end(true) } catch {}
    this.client = null
    this.connected.value = false
  }

  private sendListing(room: PublicRoom) {
    if (!this.client?.connected) return
    try {
      this.client.publish(topicFor(room.code), JSON.stringify(room), { retain: true, qos: 0 })
    } catch {}
  }

  private startExpiry() {
    if (this.expiryTimer) return
    this.expiryTimer = setInterval(() => this.prune(), 10000)
  }

  private prune() {
    const cutoff = Date.now() - EXPIRE_MS
    let changed = false
    for (const [code, room] of this.rooms) {
      // Never expire our own hosting while we publish it.
      if (this.hosted && code === this.hosted.code) continue
      if (room.updatedAt < cutoff) {
        this.rooms.delete(code)
        changed = true
      }
    }
    if (changed) this.emit()
  }

  private snapshot(): PublicRoom[] {
    return [...this.rooms.values()].sort((a, b) => b.players - a.players || b.updatedAt - a.updatedAt)
  }

  private emit() {
    const snap = this.snapshot()
    for (const cb of this.listeners) {
      try { cb(snap) } catch {}
    }
  }
}
