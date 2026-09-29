<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { CFG, CORE_DETAILS, type CoreId } from '../game/config'
import { sound } from '../game/audio'
import type { PlayerState, KillMsg, TelemetryData, ChatMsg } from '../net/types'

const props = defineProps<{
  player: PlayerState
  matchTime: number
  killFeed: KillMsg[]
  hitFlash: boolean
  hitConfirm: { show: boolean; amount: number; killed: boolean }
  cachePopup?: { show: boolean; amount: number }
  telemetry?: TelemetryData
  p2pStatus?: string
  roomCode?: string
  leaderboard?: { id: number; name: string; score: number; isBot?: boolean }[]
  localPlayerId?: number
  hitDir?: { angle: number; at: number } | null
  chatMessages?: ChatMsg[]
}>()

const emit = defineEmits<{
  (e: 'send-chat', text: string): void
}>()

const copiedToast = ref(false)
const copyInviteLink = () => {
  if (!props.roomCode) return
  const url = `${window.location.origin}${window.location.pathname}#room=${props.roomCode}`
  navigator.clipboard.writeText(url).catch(() => {})
  copiedToast.value = true
  setTimeout(() => { copiedToast.value = false }, 2000)
}

const currentTime = ref(Date.now())
let timerRaf: number | null = null

const pingColor = computed(() => {
  const p = props.telemetry?.ping ?? 0
  if (p < 50) return '#10b981'
  if (p < 100) return '#00f0ff'
  if (p < 150) return '#f59e0b'
  return '#ef4444'
})

const modeLabel = computed(() => {
  const m = props.telemetry?.mode || 'solo'
  if (m === 'host') return 'LAN HOST'
  if (m === 'client') return 'P2P PEER'
  return 'SOLO'
})

onMounted(() => {
  const loop = () => {
    currentTime.value = Date.now()
    // Critical-hull heartbeat (re-triggered at most ~1/s while critical)
    if (lowHull.value && currentTime.value - lastLowBeep > 1100) {
      lastLowBeep = currentTime.value
      sound.playLowHull()
    }
    timerRaf = requestAnimationFrame(loop)
  }
  timerRaf = requestAnimationFrame(loop)
  window.addEventListener('keydown', onGlobalKey)
})

onUnmounted(() => {
  if (timerRaf) cancelAnimationFrame(timerRaf)
  window.removeEventListener('keydown', onGlobalKey)
})

// All-chat: Enter opens (and drops pointer lock so keys type), Enter sends,
// Esc closes. Engine ignores game keys while the input owns the keyboard.
const chatting = ref(false)
const chatDraft = ref('')
const chatInput = ref<HTMLInputElement | null>(null)
function onGlobalKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT') return
  if (e.key === 'Enter' && !chatting.value) {
    e.preventDefault()
    chatting.value = true
    chatDraft.value = ''
    document.exitPointerLock?.()
    nextTick(() => chatInput.value?.focus())
  }
}
function sendChat() {
  const text = chatDraft.value.trim()
  if (text) emit('send-chat', text)
  chatDraft.value = ''
  chatting.value = false
}
function closeChat() {
  chatDraft.value = ''
  chatting.value = false
}
// Last 5 messages, each visible ~10s with a fade tail
const visibleChat = computed(() => {
  const now = currentTime.value
  return (props.chatMessages || [])
    .filter(m => now - (m.at ?? now) < 10000)
    .slice(-5)
    .map(m => {
      const age = now - (m.at ?? now)
      return { ...m, opacity: age < 6000 ? 1 : Math.max(0, 1 - (age - 6000) / 4000) }
    })
})

const core = computed(() => CORE_DETAILS[props.player.character] || CORE_DETAILS.denja)

const hullPercent = computed(() => {
  return Math.max(0, Math.min(100, (props.player.health / CFG.MAX_HEALTH) * 100))
})

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Q Ability Timer
const qTimeRemaining = computed(() => {
  if (props.player.superActive) return 0
  if (core.value.cooldown <= 0) return 0
  const elapsed = currentTime.value - (props.player.lastAbilityAt || 0)
  return Math.max(0, (core.value.cooldown - elapsed) / 1000)
})

const qPercent = computed(() => {
  if (props.player.superActive) return 0
  if (core.value.cooldown <= 0) return 100
  const elapsed = currentTime.value - (props.player.lastAbilityAt || 0)
  return Math.min(100, Math.max(0, (elapsed / core.value.cooldown) * 100))
})

const abilityReady = computed(() => !props.player.superActive && qTimeRemaining.value <= 0)

// Objective readout (leaderboard is the top-5 slice)
const myId = computed(() => props.localPlayerId ?? props.player.id)
const myRank = computed(() => {
  const i = (props.leaderboard || []).findIndex(e => e.id === myId.value)
  return i >= 0 ? i + 1 : null // null = outside the top 5
})
const leader = computed(() => (props.leaderboard || [])[0] || null)
const isLeader = computed(() => !!leader.value && leader.value.id === myId.value)
const scoreGap = computed(() => (leader.value ? Math.max(0, leader.value.score - props.player.score) : 0))

// Damage direction arc (shooter bearing, visible ~0.9s per hit)
const damageDirVisible = computed(() =>
  !!props.hitDir && props.player.alive && currentTime.value - props.hitDir.at < 900
)
const damageDirStyle = computed(() => ({
  // Bearing 0 = ahead; negative bearing = screen right (yaw convention)
  transform: `rotate(${(-(props.hitDir?.angle ?? 0) * 180) / Math.PI}deg)`
}))

// Critical Hull: under 25% while alive
const lowHull = computed(() => props.player.alive && props.player.health < CFG.MAX_HEALTH * 0.25)
let lastLowBeep = 0

// Final-minute urgency + radar threat heat
const clockDanger = computed(() => props.matchTime <= 60)
const radarThreat = computed(() => {
  const d = props.telemetry?.nearestPilot?.distance
  if (d == null) return 'none'
  if (d <= 25) return 'hot'
  if (d <= 60) return 'warm'
  return 'cold'
})

// Telepotu recall state: live anchor countdown drives the Q status line
const anchorActive = computed(() =>
  props.player.character === 'telepotu' && (props.player.anchorExpires || 0) > currentTime.value
)
const anchorSecs = computed(() =>
  Math.max(0, ((props.player.anchorExpires || 0) - currentTime.value) / 1000)
)

// E Super Timer (duration = 10s)
const eTimeRemaining = computed(() => {
  if (!props.player.superActive || !props.player.superEnd) return 0
  return Math.max(0, (props.player.superEnd - currentTime.value) / 1000)
})

const ePercent = computed(() => {
  if (props.player.superActive && props.player.superEnd) {
    return Math.min(100, Math.max(0, (eTimeRemaining.value / (CFG.SUPER_DURATION / 1000)) * 100))
  }
  return props.player.health >= 51 ? 100 : Math.max(0, (props.player.health / 50) * 100)
})

// R Shield Timer (duration = 10s)
const rTimeRemaining = computed(() => {
  if (!props.player.shieldActive || !props.player.shieldEnd) return 0
  return Math.max(0, (props.player.shieldEnd - currentTime.value) / 1000)
})

const rPercent = computed(() => {
  if (props.player.superActive) return 0
  if (props.player.shieldActive && props.player.shieldEnd) {
    return Math.min(100, Math.max(0, (rTimeRemaining.value / (CFG.SHIELD_DURATION / 1000)) * 100))
  }
  return props.player.health >= 81 ? 100 : Math.max(0, (props.player.health / 80) * 100)
})

// Nanite Regeneration: 3s calm after damage/spend, then gradual rebuild
const regenCooldownRemaining = computed(() => {
  if (props.player.health >= CFG.MAX_HEALTH) return 0
  const lastDmg = props.player.lastDamageAt || 0
  const elapsed = (currentTime.value - lastDmg) / 1000
  const cooldownSec = CFG.REGEN_DELAY / 1000
  return Math.max(0, cooldownSec - elapsed)
})

const isRegenerating = computed(() => {
  return props.player.health < CFG.MAX_HEALTH && regenCooldownRemaining.value <= 0
})

const regenRate = computed(() => {
  return (props.player.crouching ? 3 : 1) * CFG.REGEN_RATE
})

const cTimeRemaining = computed(() => {
  return regenCooldownRemaining.value
})

const cPercent = computed(() => {
  if (props.player.health >= CFG.MAX_HEALTH) return 100
  const elapsed = (CFG.REGEN_DELAY / 1000) - regenCooldownRemaining.value
  return Math.min(100, Math.max(0, (elapsed / (CFG.REGEN_DELAY / 1000)) * 100))
})

// Death / chassis reprint countdown
const respawnMs = computed(() => {
  if (props.player.alive) return 0
  return Math.max(0, (props.player.respawnAt || 0) - currentTime.value)
})

const respawnSecs = computed(() => Math.ceil(respawnMs.value / 1000))

const reprintPercent = computed(() => {
  const total = CFG.RESPAWN_DELAY
  return Math.min(100, Math.max(0, ((total - respawnMs.value) / total) * 100))
})
</script>

<template>
  <div class="hud-overlay" :class="{ 'hit-vignette': hitFlash, 'low-hull': lowHull }">
    <!-- Critical Hull banner pulse -->
    <!-- Blueish Kinetic Shield Overlay (when Shield is active) -->
    <div
      v-if="player.shieldActive && rTimeRemaining > 0"
      class="shield-active-overlay"
    >
      <div class="shield-hex-grid"></div>
      <div class="shield-corner-bracket bracket-tl"></div>
      <div class="shield-corner-bracket bracket-tr"></div>
      <div class="shield-corner-bracket bracket-bl"></div>
      <div class="shield-corner-bracket bracket-br"></div>
      <div class="shield-status-banner" :class="{ expiring: rTimeRemaining < 2.5 }">
        <span class="shield-icon">🛡️</span>
        <span class="shield-title">DEFLECTOR BARRIER ACTIVE</span>
        <span class="shield-time-left">{{ rTimeRemaining.toFixed(1) }}s IMMUNITY</span>
      </div>
    </div>

    <!-- Chassis destroyed / reprint overlay -->
    <div v-if="!player.alive" class="death-overlay">
      <div class="death-scanlines"></div>
      <div class="death-panel">
        <div class="death-title">RX-11 CHASSIS DESTROYED</div>
        <div class="death-sub">REPRINTING NANITE SHELL…</div>
        <div class="death-count">{{ respawnSecs }}</div>
        <div class="death-track">
          <div class="death-fill" :style="{ width: `${reprintPercent}%` }"></div>
        </div>
      </div>
    </div>

    <!-- Top Match Header -->
    <div class="hud-top">
      <div class="top-left-cluster">
        <!-- Objective: frags, rank, gap to leader -->
        <div class="score-module" :class="{ leader: isLeader }" title="Your frags, rank and gap to the leader">
          <div class="score-main">
            <span class="score-frags">{{ player.score }}</span>
            <span class="score-label">FRAGS</span>
          </div>
          <div class="score-sub">
            <span class="score-rank">{{ myRank ? `#${myRank}` : '#6+' }}</span>
            <span class="score-gap">{{ isLeader ? '👑 LEADER' : leader ? `−${scoreGap} · ${leader.name}` : '—' }}</span>
          </div>
        </div>
        <div class="match-timer" :class="{ danger: clockDanger }">
          <span class="timer-label">{{ clockDanger ? 'FINAL MINUTE' : 'TRIAL CLOCK' }}</span>
          <span class="timer-val">{{ formatTime(matchTime) }}</span>
        </div>
      </div>

      <!-- Live Networking & Performance Telemetry -->
      <div class="telemetry-bar">
        <div class="telem-chip">
          <span class="telem-label">PING</span>
          <span class="telem-val" :style="{ color: pingColor }">
            {{ telemetry?.mode === 'solo' ? '<1ms' : `${telemetry?.ping ?? 0}ms` }}
          </span>
        </div>
        <div class="telem-chip">
          <span class="telem-label">PILOTS</span>
          <span class="telem-val text-cyan">
            {{ telemetry?.mode === 'solo' ? `${telemetry.humanPlayers || 1}P + ${telemetry.botPlayers || 7}B` : `${telemetry?.connectedPlayers || 1} / 16` }}
          </span>
        </div>
        <div class="telem-chip">
          <span class="telem-label">FPS</span>
          <span class="telem-val text-emerald">{{ telemetry?.fps ?? 60 }}</span>
        </div>
        <div class="telem-chip">
          <span class="telem-label">NET</span>
          <span class="telem-val text-white">{{ modeLabel }}</span>
        </div>
        <div class="telem-chip">
          <span class="telem-label">SIM</span>
          <span class="telem-val text-muted">{{ telemetry?.tickRate ?? 20 }}Hz</span>
        </div>
        <div v-if="p2pStatus" class="telem-chip">
          <span class="telem-label">LINK</span>
          <span class="telem-val text-white">{{ p2pStatus }}</span>
        </div>
        <div v-if="roomCode" class="telem-chip room-chip" @click="copyInviteLink" :title="'Click to copy invite link for Room ' + roomCode">
          <span class="telem-label">ROOM</span>
          <span class="telem-val text-cyan">{{ roomCode }} {{ copiedToast ? '✓ COPIED' : '📋' }}</span>
        </div>
        <div class="telem-chip contact-chip" :class="`threat-${radarThreat}`" title="Nearest moving pilot within 100m (crouched shells stay hidden)">
          <span class="contact-beacon"></span>
          <span class="telem-label">RADAR</span>
          <span class="telem-val">{{ telemetry?.nearestPilot ? `${telemetry.nearestPilot.name} (${telemetry.nearestPilot.distance}m)` : '—' }}</span>
        </div>
      </div>

      <div class="pilot-badge">
        <span class="core-icon">{{ core.badge }}</span>
        <span class="core-name">{{ core.name }}</span>
        <span class="core-maker">{{ core.maker }}</span>
      </div>
    </div>

    <!-- Kill Feed -->
    <div class="kill-feed">
      <div v-for="(k, i) in killFeed" :key="i" class="kill-item">
        <span class="killer">{{ k.shooterName }}</span>
        <span class="skull">☠️</span>
        <span class="victim">{{ k.targetName }}</span>
      </div>
    </div>

    <!-- Center Crosshair & Hit Markers -->
    <div v-if="player.alive" class="crosshair-container">
      <div class="crosshair" :class="{ 'hit-confirm': hitConfirm.show }">
        <div class="ch-line ch-top"></div>
        <div class="ch-line ch-bottom"></div>
        <div class="ch-line ch-left"></div>
        <div class="ch-line ch-right"></div>
        <div class="ch-dot"></div>
      </div>
      <!-- Damage direction: red arc toward the shooter, ~0.9s per hit -->
      <div v-if="damageDirVisible" class="damage-dir" :style="damageDirStyle">
        <div class="damage-arc"></div>
      </div>
      <div v-if="hitConfirm.show" class="damage-popup" :class="{ 'kill-popup': hitConfirm.killed }">
        {{ hitConfirm.killed ? 'FRAG!' : `-${hitConfirm.amount}` }}
      </div>
      <div v-if="cachePopup?.show" class="cache-popup">
        +{{ cachePopup.amount }} NANITES RECLAIMED
      </div>
    </div>

    <!-- Bottom Status Panel -->
    <div class="hud-bottom">
      <!-- All-chat feed + input (bottom-left, above the status bar) -->
      <div class="chat-panel">
        <div class="chat-feed">
          <div v-for="(m, i) in visibleChat" :key="`${m.at}-${i}`" class="chat-line" :style="{ opacity: m.opacity }">
            <span class="chat-name">{{ m.name || '???' }}</span>
            <span class="chat-text">{{ m.text }}</span>
          </div>
        </div>
        <div v-if="chatting" class="chat-input-row">
          <span class="chat-prompt">ALL ›</span>
          <input
            ref="chatInput"
            v-model="chatDraft"
            class="chat-input"
            maxlength="120"
            placeholder="type, ENTER to send…"
            @keydown.enter.prevent="sendChat"
            @keydown.esc="closeChat"
          />
        </div>
        <div v-else-if="visibleChat.length === 0" class="chat-hint">ENTER — chat</div>
      </div>      <!-- Nanite Census / Hull Bar -->
      <div class="hull-container">
        <div class="hull-header">
          <span class="hull-title">RX-11 NANITE CENSUS</span>
          <span v-if="regenCooldownRemaining > 0" class="hull-regen-badge">
            REGEN IN {{ regenCooldownRemaining.toFixed(1) }}s
          </span>
          <span v-else-if="isRegenerating" class="hull-regen-badge active">
            +{{ regenRate }}/S REBUILDING
          </span>
          <span class="hull-val">{{ Math.ceil(player.health) }} / {{ CFG.MAX_HEALTH }}</span>
        </div>
        <div class="hull-track">
          <div
            class="hull-fill"
            :style="{
              width: `${hullPercent}%`,
              background: hullPercent < 25 ? '#ef4444' : hullPercent < 50 ? '#f59e0b' : '#00f0ff'
            }"
          ></div>
        </div>
      </div>

      <!-- Action & Ability Indicators with Border Timer Lines -->
      <div class="actions-panel">
        <!-- Q Ability -->
        <div
          class="action-card"
          :class="{
            ready: abilityReady,
            cooldown: !abilityReady && !player.superActive,
            disabled: player.superActive
          }"
        >
          <svg class="card-border-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            <rect x="1" y="1" width="98" height="98" rx="5" class="svg-border-track" />
            <rect
              x="1" y="1" width="98" height="98" rx="5"
              class="svg-border-line"
              pathLength="100"
              :style="{
                strokeDasharray: '100',
                strokeDashoffset: `${100 - qPercent}`,
                stroke: player.superActive ? 'rgba(255, 255, 255, 0.15)' : abilityReady ? '#00f0ff' : '#0ea5e9'
              }"
            />
          </svg>
          <div class="card-inner">
            <div class="key-bind" :class="{ 'key-disabled': player.superActive }">Q</div>
            <div class="action-info">
              <span class="action-name">{{ core.ability }}</span>
              <span class="action-status">
                {{ player.superActive ? 'DISABLED (SUPER)' : anchorActive ? `ANCHOR ${anchorSecs.toFixed(0)}s · Q = RECALL` : abilityReady ? 'READY' : `${qTimeRemaining.toFixed(1)}s` }}
              </span>
            </div>
          </div>
          <div
            class="bottom-border-line"
            :style="{
              width: `${qPercent}%`,
              backgroundColor: player.superActive ? 'transparent' : abilityReady ? '#00f0ff' : '#0ea5e9'
            }"
          ></div>
        </div>

        <!-- E Super -->
        <div class="action-card" :class="{ active: player.superActive }">
          <svg class="card-border-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            <rect x="1" y="1" width="98" height="98" rx="5" class="svg-border-track" />
            <rect
              x="1" y="1" width="98" height="98" rx="5"
              class="svg-border-line"
              pathLength="100"
              :style="{
                strokeDasharray: '100',
                strokeDashoffset: `${100 - ePercent}`,
                stroke: player.superActive ? '#f59e0b' : '#78716c'
              }"
            />
          </svg>
          <div class="card-inner">
            <div class="key-bind">E</div>
            <div class="action-info">
              <span class="action-name">SUPER (2× SPD, 3× DMG)</span>
              <span class="action-status">
                {{ player.superActive ? `${eTimeRemaining.toFixed(1)}s LEFT` : '50 HULL' }}
              </span>
            </div>
          </div>
          <div
            class="bottom-border-line"
            :style="{
              width: `${ePercent}%`,
              backgroundColor: player.superActive ? '#f59e0b' : 'rgba(245, 158, 11, 0.4)'
            }"
          ></div>
        </div>

        <!-- R Shield -->
        <div
          class="action-card"
          :class="{
            active: player.shieldActive,
            disabled: player.superActive
          }"
        >
          <svg class="card-border-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            <rect x="1" y="1" width="98" height="98" rx="5" class="svg-border-track" />
            <rect
              x="1" y="1" width="98" height="98" rx="5"
              class="svg-border-line"
              pathLength="100"
              :style="{
                strokeDasharray: '100',
                strokeDashoffset: `${100 - rPercent}`,
                stroke: player.superActive ? 'rgba(255, 255, 255, 0.15)' : player.shieldActive ? '#00f0ff' : '#64748b'
              }"
            />
          </svg>
          <div class="card-inner">
            <div class="key-bind" :class="{ 'key-disabled': player.superActive }">R</div>
            <div class="action-info">
              <span class="action-name">SHIELD</span>
              <span class="action-status">
                {{ player.superActive ? 'DISABLED (SUPER)' : player.shieldActive ? `${rTimeRemaining.toFixed(1)}s IMMUNE` : '80 HULL' }}
              </span>
            </div>
          </div>
          <div
            class="bottom-border-line"
            :style="{
              width: `${rPercent}%`,
              backgroundColor: player.superActive ? 'transparent' : player.shieldActive ? '#00f0ff' : 'rgba(0, 240, 255, 0.4)'
            }"
          ></div>
        </div>

        <!-- C Crouch / Space Jump -->
        <div class="action-card" :class="{ active: player.crouching }">
          <svg class="card-border-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            <rect x="1" y="1" width="98" height="98" rx="5" class="svg-border-track" />
            <rect
              x="1" y="1" width="98" height="98" rx="5"
              class="svg-border-line"
              pathLength="100"
              :style="{
                strokeDasharray: '100',
                strokeDashoffset: `${100 - cPercent}`,
                stroke: player.crouching ? '#10b981' : '#475569'
              }"
            />
          </svg>
          <div class="card-inner">
            <div class="key-bind">C</div>
            <div class="action-info">
              <span class="action-name">CROUCH</span>
              <span class="action-status">
                {{ cTimeRemaining > 0 ? `${cTimeRemaining.toFixed(1)}s (3s CALM)` : 'FULL HULL' }}
              </span>
            </div>
          </div>
          <div
            class="bottom-border-line"
            :style="{
              width: `${cPercent}%`,
              backgroundColor: player.crouching ? '#10b981' : 'rgba(16, 185, 129, 0.4)'
            }"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hud-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: 'Rajdhani', sans-serif;
  color: #fff;
  transition: box-shadow 0.15s ease;
  user-select: none;
}

.hit-vignette {
  box-shadow: inset 0 0 100px rgba(239, 68, 68, 0.7);
}

/* Critical Hull: slow red heartbeat while under 25% */
.hud-overlay.low-hull {
  animation: lowHullPulse 1.1s ease-in-out infinite;
}
@keyframes lowHullPulse {
  0%, 100% { box-shadow: inset 0 0 60px rgba(239, 68, 68, 0.25); }
  50% { box-shadow: inset 0 0 135px rgba(239, 68, 68, 0.6); }
}

/* Damage direction arc: rotates around the crosshair toward the shooter */
.damage-dir {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  pointer-events: none;
}
.damage-arc {
  position: absolute;
  left: -45px;
  top: -108px;
  width: 90px;
  height: 26px;
  border-top: 5px solid rgba(239, 68, 68, 0.95);
  border-radius: 50%;
  filter: drop-shadow(0 0 6px rgba(239, 68, 68, 0.8));
  animation: dirFade 0.9s ease forwards;
}
@keyframes dirFade {
  0% { opacity: 1; }
  60% { opacity: 1; }
  100% { opacity: 0; }
}

.hud-top {
  position: absolute;
  top: 24px;
  left: 28px;
  right: 28px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.match-timer {
  display: flex;
  flex-direction: column;
  background: rgba(11, 14, 22, 0.85);
  border: 1px solid rgba(0, 240, 255, 0.3);
  padding: 6px 18px;
  border-radius: 6px;
  backdrop-filter: blur(8px);
}

.timer-label {
  font-size: 11px;
  letter-spacing: 2px;
  color: #00f0ff;
  font-weight: 700;
}

.timer-val {
  font-size: 28px;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  color: #ffffff;
}

/* Final-minute urgency */
.match-timer.danger {
  border-color: rgba(239, 68, 68, 0.7);
  animation: dangerPulse 1s infinite;
}
.match-timer.danger .timer-label {
  color: #ef4444;
}
.match-timer.danger .timer-val {
  color: #ef4444;
}
@keyframes dangerPulse {
  0%, 100% { box-shadow: 0 0 6px rgba(239, 68, 68, 0.3); }
  50% { box-shadow: 0 0 18px rgba(239, 68, 68, 0.65); }
}

/* Objective cluster: score module + clock */
.top-left-cluster {
  display: flex;
  align-items: stretch;
  gap: 10px;
}
.score-module {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(11, 14, 22, 0.85);
  border: 1px solid rgba(245, 158, 11, 0.4);
  padding: 6px 18px;
  border-radius: 6px;
  backdrop-filter: blur(8px);
}
.score-module.leader {
  border-color: rgba(245, 158, 11, 0.9);
  box-shadow: 0 0 14px rgba(245, 158, 11, 0.35);
}
.score-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1;
}
.score-frags {
  font-size: 28px;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  color: #f59e0b;
}
.score-module.leader .score-frags {
  color: #fbbf24;
}
.score-label {
  font-size: 10px;
  letter-spacing: 2px;
  color: rgba(255, 255, 255, 0.5);
  font-weight: 700;
}
.score-sub {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-left: 1px solid rgba(255, 255, 255, 0.15);
  padding-left: 12px;
}
.score-rank {
  font-size: 16px;
  font-weight: 700;
  color: #ffffff;
}
.score-gap {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  max-width: 150px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pilot-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(11, 14, 22, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 8px 18px;
  border-radius: 6px;
  backdrop-filter: blur(8px);
}

.core-icon {
  font-size: 22px;
}

.core-name {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 1px;
}

.core-maker {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  border-left: 1px solid rgba(255, 255, 255, 0.2);
  padding-left: 10px;
}

.kill-feed {
  position: absolute;
  top: 85px;
  right: 28px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.kill-item {
  background: rgba(16, 20, 30, 0.8);
  border-left: 3px solid #ff0055;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
  animation: fadeIn 0.2s ease;
}

.killer {
  color: #00f0ff;
}

.skull {
  margin: 0 6px;
}

.victim {
  color: #ff6688;
}

.crosshair-container {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.crosshair {
  width: 28px;
  height: 28px;
  position: relative;
  transition: transform 0.08s ease;
}

.crosshair.hit-confirm {
  transform: scale(1.4);
}

.ch-line {
  position: absolute;
  background: rgba(0, 240, 255, 0.8);
}

.crosshair.hit-confirm .ch-line {
  background: #ff0055;
}

.ch-top {
  top: 0;
  left: 13px;
  width: 2px;
  height: 8px;
}

.ch-bottom {
  bottom: 0;
  left: 13px;
  width: 2px;
  height: 8px;
}

.ch-left {
  top: 13px;
  left: 0;
  width: 8px;
  height: 2px;
}

.ch-right {
  top: 13px;
  right: 0;
  width: 8px;
  height: 2px;
}

.ch-dot {
  position: absolute;
  top: 12px;
  left: 12px;
  width: 4px;
  height: 4px;
  background: #ffffff;
  border-radius: 50%;
}

.damage-popup {
  margin-top: 18px;
  font-size: 18px;
  font-weight: 700;
  color: #ff0055;
  animation: floatUp 0.3s ease;
}

.damage-popup.kill-popup {
  color: #ffcc00;
  font-size: 22px;
}

.cache-popup {
  position: absolute;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  font-family: 'Space Grotesk', monospace;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #fbbf24;
  text-shadow: 0 0 12px rgba(245, 158, 11, 0.9);
  background: rgba(15, 23, 42, 0.92);
  border: 1.5px solid #f59e0b;
  border-radius: 8px;
  padding: 5px 16px;
  box-shadow: 0 0 20px rgba(245, 158, 11, 0.45);
  animation: cacheFloat 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  pointer-events: none;
  white-space: nowrap;
}

@keyframes cacheFloat {
  0% {
    opacity: 0;
    transform: translate(-50%, 15px) scale(0.9);
  }
  20% {
    opacity: 1;
    transform: translate(-50%, 0) scale(1.05);
  }
  80% {
    opacity: 1;
    transform: translate(-50%, -4px) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -18px) scale(0.95);
  }
}

.hud-bottom {
  position: absolute;
  bottom: 24px;
  left: 28px;
  right: 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* All-chat: feed above the status bar, input when typing */
.chat-panel {
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
}
.chat-feed {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.chat-line {
  background: rgba(11, 14, 22, 0.72);
  border-left: 3px solid #00f0ff;
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 13px;
  width: fit-content;
  max-width: 100%;
}
.chat-name {
  font-weight: 800;
  color: #f59e0b;
  margin-right: 6px;
}
.chat-text {
  color: #e2e8f0;
  word-break: break-word;
}
.chat-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(11, 14, 22, 0.92);
  border: 1px solid rgba(0, 240, 255, 0.5);
  border-radius: 6px;
  padding: 6px 10px;
  pointer-events: auto;
}
.chat-prompt {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 1px;
  color: #00f0ff;
}
.chat-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #fff;
  font-size: 14px;
  font-family: inherit;
  user-select: text;
  pointer-events: auto;
}
.chat-hint {
  font-size: 11px;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.35);
}

.hull-container {
  max-width: 420px;
  background: rgba(11, 14, 22, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 10px 16px;
  border-radius: 6px;
  backdrop-filter: blur(8px);
}

.hull-header {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 6px;
}

.hull-title {
  color: rgba(255, 255, 255, 0.7);
  letter-spacing: 1px;
}

.hull-regen-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 700;
  color: #f59e0b;
  letter-spacing: 0.05em;
  background: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.4);
  padding: 1px 7px;
  border-radius: 4px;
}

.hull-regen-badge.active {
  color: #10b981;
  background: rgba(16, 185, 129, 0.15);
  border-color: rgba(16, 185, 129, 0.4);
}

.hull-val {
  color: #00f0ff;
  font-family: 'JetBrains Mono', monospace;
}

.hull-track {
  height: 10px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
}

.hull-fill {
  height: 100%;
  transition: width 0.1s ease, background 0.2s ease;
}

.actions-panel {
  display: flex;
  gap: 12px;
}

.action-card {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  background: rgba(11, 14, 22, 0.88);
  border-radius: 6px;
  backdrop-filter: blur(8px);
  min-width: 140px;
}

.card-inner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  position: relative;
  z-index: 2;
  width: 100%;
}

.card-border-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}

.svg-border-track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.1);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

.svg-border-line {
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
  transition: stroke-dashoffset 0.08s linear;
  filter: drop-shadow(0 0 4px currentColor);
}

.bottom-border-line {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 3px;
  z-index: 3;
  transition: width 0.08s linear;
  box-shadow: 0 0 6px currentColor;
}

.action-card.ready {
  box-shadow: 0 0 12px rgba(0, 240, 255, 0.2);
}

.action-card.active {
  background: rgba(245, 158, 11, 0.18);
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.25);
}

.action-card.cooldown {
  opacity: 0.75;
}

.action-card.disabled {
  opacity: 0.42;
  filter: grayscale(0.85);
  box-shadow: none !important;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.key-bind {
  font-family: 'JetBrains Mono', monospace;
  background: rgba(255, 255, 255, 0.15);
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 700;
  color: #00f0ff;
}

.key-bind.key-disabled {
  color: rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.08);
}

.action-info {
  display: flex;
  flex-direction: column;
}

.action-name {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
}

.action-status {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes floatUp {
  0% { opacity: 0; transform: translateY(10px); }
  50% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-10px); }
}

/* Live Telemetry Header Bar */
.telemetry-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(11, 14, 22, 0.85);
  border: 1px solid rgba(0, 240, 255, 0.25);
  border-radius: 6px;
  padding: 6px 14px;
  backdrop-filter: blur(8px);
}

.telem-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 52px;
}

.telem-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: rgba(255, 255, 255, 0.45);
}

.telem-val {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 700;
}

.text-cyan { color: #00f0ff; }
.text-emerald { color: #10b981; }
.text-white { color: #ffffff; }
.text-muted { color: rgba(255, 255, 255, 0.65); }

/* Fullscreen Blueish Kinetic Shield Overlay */
.shield-active-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
  box-shadow: inset 0 0 110px rgba(0, 240, 255, 0.42), inset 0 0 45px rgba(0, 180, 255, 0.25);
  animation: shieldPulse 1.8s infinite ease-in-out;
}

.shield-hex-grid {
  position: absolute;
  inset: 0;
  background-image: 
    radial-gradient(rgba(0, 240, 255, 0.12) 18%, transparent 19%),
    radial-gradient(rgba(0, 240, 255, 0.08) 18%, transparent 19%);
  background-size: 40px 40px;
  background-position: 0 0, 20px 20px;
  opacity: 0.65;
}

.shield-corner-bracket {
  position: absolute;
  width: 48px;
  height: 48px;
  border-color: #00f0ff;
  border-style: solid;
  opacity: 0.8;
  filter: drop-shadow(0 0 8px #00f0ff);
}

.bracket-tl {
  top: 14px;
  left: 14px;
  border-width: 3px 0 0 3px;
  border-top-left-radius: 6px;
}

.bracket-tr {
  top: 14px;
  right: 14px;
  border-width: 3px 3px 0 0;
  border-top-right-radius: 6px;
}

.bracket-bl {
  bottom: 14px;
  left: 14px;
  border-width: 0 0 3px 3px;
  border-bottom-left-radius: 6px;
}

.bracket-br {
  bottom: 14px;
  right: 14px;
  border-width: 0 3px 3px 0;
  border-bottom-right-radius: 6px;
}

.shield-status-banner {
  position: absolute;
  top: 86px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(11, 17, 28, 0.92);
  border: 1px solid #00f0ff;
  box-shadow: 0 0 25px rgba(0, 240, 255, 0.5), inset 0 0 10px rgba(0, 240, 255, 0.2);
  border-radius: 6px;
  padding: 8px 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  animation: bannerGlow 1.2s infinite alternate ease-in-out;
}

.shield-icon {
  font-size: 18px;
}

.shield-title {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 2px;
  color: #00f0ff;
  text-shadow: 0 0 10px rgba(0, 240, 255, 0.6);
}

.shield-time-left {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  font-weight: 700;
  color: #e0f2fe;
  background: rgba(0, 240, 255, 0.2);
  padding: 2px 8px;
  border-radius: 4px;
}

/* Barrier about to drop: banner flips amber to match the 3D domes */
.shield-status-banner.expiring {
  border-color: #f59e0b;
  box-shadow: 0 0 25px rgba(245, 158, 11, 0.55), inset 0 0 10px rgba(245, 158, 11, 0.25);
  animation-duration: 0.4s;
}
.shield-status-banner.expiring .shield-title {
  color: #f59e0b;
  text-shadow: 0 0 10px rgba(245, 158, 11, 0.6);
}
.shield-status-banner.expiring .shield-time-left {
  color: #fef3c7;
  background: rgba(245, 158, 11, 0.25);
}

@keyframes shieldPulse {
  0% { opacity: 0.85; }
  50% { opacity: 1; box-shadow: inset 0 0 140px rgba(0, 240, 255, 0.55), inset 0 0 60px rgba(0, 240, 255, 0.35); }
  100% { opacity: 0.85; }
}

.room-chip {
  cursor: pointer;
  background: rgba(0, 240, 255, 0.15) !important;
  border-color: rgba(0, 240, 255, 0.5) !important;
  transition: all 0.2s ease;
  user-select: none;
}

.room-chip:hover {
  background: rgba(0, 240, 255, 0.3) !important;
  box-shadow: 0 0 12px rgba(0, 240, 255, 0.5);
  transform: translateY(-1px);
}

.contact-chip {
  background: rgba(16, 185, 129, 0.15) !important;
  border-color: rgba(16, 185, 129, 0.5) !important;
}

/* Radar threat heat: color follows nearest-pilot distance */
.contact-chip.threat-none .telem-val {
  color: rgba(255, 255, 255, 0.45);
}
.contact-chip.threat-none .contact-beacon {
  background-color: #475569;
  box-shadow: none;
  animation: none;
}
.contact-chip.threat-cold .telem-val {
  color: #00f0ff;
}
.contact-chip.threat-warm {
  background: rgba(245, 158, 11, 0.15) !important;
  border-color: rgba(245, 158, 11, 0.5) !important;
}
.contact-chip.threat-warm .telem-val {
  color: #f59e0b;
}
.contact-chip.threat-warm .contact-beacon {
  background-color: #f59e0b;
  box-shadow: 0 0 8px #f59e0b;
}
.contact-chip.threat-hot {
  background: rgba(239, 68, 68, 0.18) !important;
  border-color: rgba(239, 68, 68, 0.65) !important;
}
.contact-chip.threat-hot .telem-val {
  color: #ef4444;
}
.contact-chip.threat-hot .contact-beacon {
  background-color: #ef4444;
  box-shadow: 0 0 10px #ef4444;
  animation-duration: 0.4s;
}

.contact-beacon {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: #10b981;
  box-shadow: 0 0 8px #10b981;
  animation: beaconPulse 1.2s infinite;
  margin-right: 2px;
}

@keyframes beaconPulse {
  0% { transform: scale(0.9); opacity: 0.6; }
  50% { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(0.9); opacity: 0.6; }
}

@keyframes bannerGlow {
  0% { box-shadow: 0 0 15px rgba(0, 240, 255, 0.4); }
  100% { box-shadow: 0 0 30px rgba(0, 240, 255, 0.7); }
}

/* Chassis destroyed / reprint overlay */
.death-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(ellipse at center, rgba(20, 0, 0, 0.45) 0%, rgba(10, 0, 0, 0.78) 100%);
  box-shadow: inset 0 0 140px rgba(239, 68, 68, 0.55);
  animation: deathPulse 1.6s infinite ease-in-out;
}

.death-scanlines {
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    0deg,
    rgba(239, 68, 68, 0.06) 0px,
    rgba(239, 68, 68, 0.06) 1px,
    transparent 1px,
    transparent 5px
  );
}

.death-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: rgba(11, 8, 10, 0.9);
  border: 1px solid rgba(239, 68, 68, 0.7);
  box-shadow: 0 0 35px rgba(239, 68, 68, 0.35);
  border-radius: 8px;
  padding: 26px 54px;
}

.death-title {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 3px;
  color: #ef4444;
  text-shadow: 0 0 14px rgba(239, 68, 68, 0.7);
}

.death-sub {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 2.5px;
  color: rgba(255, 255, 255, 0.65);
}

.death-count {
  font-family: 'JetBrains Mono', monospace;
  font-size: 64px;
  font-weight: 700;
  line-height: 1;
  color: #ffffff;
  text-shadow: 0 0 20px rgba(239, 68, 68, 0.8);
}

.death-track {
  width: 240px;
  height: 8px;
  margin-top: 6px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  overflow: hidden;
}

.death-fill {
  height: 100%;
  background: #ef4444;
  box-shadow: 0 0 10px rgba(239, 68, 68, 0.9);
  transition: width 0.1s linear;
}

@keyframes deathPulse {
  0% { opacity: 0.92; }
  50% { opacity: 1; }
  100% { opacity: 0.92; }
}
</style>
