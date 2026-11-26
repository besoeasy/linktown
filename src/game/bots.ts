import { CFG } from './config'
import type { MapData } from './map'
import { groundHeight } from './map'
import type { PlayerState, NaniteCache, JumpPad } from '../net/types'
import { resolveCollision } from './physics'

export function spawnBots(count: number, map: MapData): PlayerState[] {
  const bots: PlayerState[] = []
  for (let i = 0; i < count; i++) {
    const s = map.spawns[Math.floor(Math.random() * map.spawns.length)] || { x: (i - count / 2) * 10, y: 1.6, z: 20 }
    bots.push({
      id: 1000 + i,
      name: `RX11-BOT-${i + 1}`,
      x: s.x,
      y: s.y,
      z: s.z,
      yaw: Math.random() * Math.PI * 2,
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
      lastDamageAt: Date.now(),
      isBot: true
    })
  }
  return bots
}

export function tickBots(
  bots: PlayerState[],
  targets: { id: number; x: number; y: number; z: number; alive: boolean }[],
  map: MapData,
  nearby: (x: number, z: number) => any[],
  dt: number,
  onBotShoot?: (bot: PlayerState, target: { id: number; x: number; y: number; z: number }) => void,
  caches?: NaniteCache[],
  jumpPads?: JumpPad[],
  onBotJumpPad?: (bot: PlayerState, pad: JumpPad) => void
) {
  const now = Date.now()
  for (const bot of bots) {
    if (!bot.alive) {
      if (bot.respawnAt > 0 && now >= bot.respawnAt) {
        const enemies = targets.filter(t => t.alive && t.id !== bot.id)
        let s = map.spawns[Math.floor(Math.random() * map.spawns.length)]
        if (enemies.length > 0 && map.spawns.length > 0) {
          const scored = map.spawns.map(sp => {
            let minD = Infinity
            for (const e of enemies) minD = Math.min(minD, Math.hypot(sp.x - e.x, sp.z - e.z))
            return { sp, minD }
          })
          scored.sort((a, b) => b.minD - a.minD)
          const pool = scored.slice(0, Math.max(3, Math.ceil(scored.length / 3)))
          s = pool[Math.floor(Math.random() * pool.length)].sp
        }
        bot.x = s.x
        bot.y = s.y
        bot.z = s.z
        bot.yaw = Math.random() * Math.PI * 2
        bot.health = CFG.MAX_HEALTH
        bot.alive = true
        bot.respawnAt = 0
        bot.lastDamageAt = now
        bot.invisible = false
        bot.cloakEnd = 0
        bot.superActive = false
        bot.superEnd = 0
        bot.shieldActive = false
        bot.shieldEnd = 0
      }
      continue
    }

    // Check for nearby dropped nanite caches to scavenge if damaged
    let nearestCache: NaniteCache | null = null
    if (caches && caches.length > 0 && bot.health < CFG.MAX_HEALTH) {
      let minCacheDist = 30
      for (const c of caches) {
        const d = Math.hypot(c.x - bot.x, c.z - bot.z)
        if (d < minCacheDist) {
          minCacheDist = d
          nearestCache = c
        }
      }
    }

    // Find nearest alive enemy target
    let nearest: { id: number; x: number; y: number; z: number } | null = null
    let minDist = Infinity
    for (const t of targets) {
      if (t.id === bot.id || !t.alive) continue
      const dist = Math.hypot(t.x - bot.x, t.z - bot.z)
      if (dist < minDist) {
        minDist = dist
        nearest = t
      }
    }

    // If critically damaged and a cache is nearby, prioritize salvaging the cache
    if (nearestCache && (bot.health < 250 || !nearest || minDist > 25)) {
      const dx = nearestCache.x - bot.x
      const dz = nearestCache.z - bot.z
      const desiredYaw = Math.atan2(-dx, -dz)
      bot.yaw += (desiredYaw - bot.yaw) * 0.25
      const mx = -Math.sin(bot.yaw) * CFG.RUN_SPEED * 0.9 * dt
      const mz = -Math.cos(bot.yaw) * CFG.RUN_SPEED * 0.9 * dt
      const col = resolveCollision(bot.x + mx, bot.y, bot.z + mz, map, nearby)
      bot.x = col.x
      bot.z = col.z
    } else if (nearest && minDist < 60) {
      // Aim at target
      const dx = nearest.x - bot.x
      const dz = nearest.z - bot.z
      const desiredYaw = Math.atan2(-dx, -dz)
      bot.yaw += (desiredYaw - bot.yaw) * 0.12

      // Tactical ability use
      if (!bot.shieldActive && !bot.superActive && !bot.invisible) {
        if (bot.health < 180 && minDist < 25 && bot.health >= CFG.SHIELD_COST + 1 && Math.random() < 0.02) {
          bot.health -= CFG.SHIELD_COST
          bot.shieldActive = true
          bot.shieldEnd = now + CFG.SHIELD_DURATION
          bot.lastDamageAt = now
        } else if (bot.health > 200 && minDist < 35 && bot.health >= CFG.SUPER_COST + 40 && Math.random() < 0.015) {
          bot.health -= CFG.SUPER_COST
          bot.superActive = true
          bot.superEnd = now + CFG.SUPER_DURATION
          bot.lastDamageAt = now
        }
      }

      // Move toward or strafe
      const speedMult = bot.superActive ? 1.1 : 0.85
      if (minDist > 14) {
        const mx = -Math.sin(bot.yaw) * CFG.RUN_SPEED * speedMult * dt
        const mz = -Math.cos(bot.yaw) * CFG.RUN_SPEED * speedMult * dt
        const col = resolveCollision(bot.x + mx, bot.y, bot.z + mz, map, nearby)
        bot.x = col.x
        bot.z = col.z
      } else {
        // Strafe
        const strafe = (Math.sin(now * 0.003 + bot.id) > 0 ? 1 : -1) * CFG.RUN_SPEED * 0.7 * dt
        const mx = Math.cos(bot.yaw) * strafe
        const mz = -Math.sin(bot.yaw) * strafe
        const col = resolveCollision(bot.x + mx, bot.y, bot.z + mz, map, nearby)
        bot.x = col.x
        bot.z = col.z
      }

      // Bot shooting - more reliable when roughly aimed and in range
      const aimErr = Math.abs(Math.atan2(Math.sin(desiredYaw - bot.yaw), Math.cos(desiredYaw - bot.yaw)))
      const fireChance = minDist < 30 ? 0.07 : 0.035
      if (aimErr < 0.25 && Math.random() < fireChance && onBotShoot) {
        onBotShoot(bot, nearest)
      }
    } else if (nearestCache) {
      // No combat target, navigate to scavenge cache
      const dx = nearestCache.x - bot.x
      const dz = nearestCache.z - bot.z
      const desiredYaw = Math.atan2(-dx, -dz)
      bot.yaw += (desiredYaw - bot.yaw) * 0.15
      const mx = -Math.sin(bot.yaw) * CFG.RUN_SPEED * 0.6 * dt
      const mz = -Math.cos(bot.yaw) * CFG.RUN_SPEED * 0.6 * dt
      const col = resolveCollision(bot.x + mx, bot.y, bot.z + mz, map, nearby)
      bot.x = col.x
      bot.z = col.z
    } else {
      // Idle wander
      bot.yaw += (Math.random() - 0.5) * 0.1
      const mx = -Math.sin(bot.yaw) * CFG.PLAYER_SPEED * 0.3 * dt
      const mz = -Math.cos(bot.yaw) * CFG.PLAYER_SPEED * 0.3 * dt
      const col = resolveCollision(bot.x + mx, bot.y, bot.z + mz, map, nearby)
      bot.x = col.x
      bot.z = col.z
    }

    // Step on dynamic jump pads
    const botVy = (bot as any).vy || 0
    if (jumpPads && jumpPads.length > 0 && botVy <= 0) {
      for (const pad of jumpPads) {
        const dist = Math.hypot(pad.x - bot.x, pad.z - bot.z)
        if (dist <= CFG.JUMP_PAD_RADIUS && Math.abs(bot.y - pad.y) < 2.0) {
          ;(bot as any).vy = CFG.JUMP_PAD_LAUNCH_VY
          onBotJumpPad?.(bot, pad)
          break
        }
      }
    }

    // Follow rolling terrain or airborne kinematics
    const groundBase = groundHeight(bot.x, bot.z, map.seed) + 1.6
    if ((bot as any).vy && (bot as any).vy !== 0) {
      ;(bot as any).vy -= CFG.GRAVITY * dt
      bot.y += (bot as any).vy * dt
      if (bot.y <= groundBase) {
        bot.y = groundBase
        ;(bot as any).vy = 0
      }
    } else {
      bot.y = groundBase
    }
  }
}
