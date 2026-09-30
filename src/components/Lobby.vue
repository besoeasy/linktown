<script setup lang="ts">
import { ref, computed } from 'vue'
import { CORE_DETAILS, CORE_IDS } from '../game/config'
import type { PublicRoom } from '../net/directory'

const props = defineProps<{
  callsign: string
  selectedCore: CoreId
  rooms: PublicRoom[]
  dirOnline: boolean
  inviteRoomCode?: string
  isConnecting?: boolean
}>()

type CoreId = (typeof CORE_IDS)[number]

const emit = defineEmits<{
  (e: 'update:callsign', val: string): void
  (e: 'update:selectedCore', val: CoreId): void
  (e: 'startSolo'): void
  (e: 'createPeerRoom'): void
  (e: 'joinPeerRoom', code: string): void
  (e: 'refreshRooms'): void
}>()

const roomCodeInput = ref('')
const copied = ref(false)
let copyTimer: any = null

const core = computed(() => CORE_DETAILS[props.selectedCore])
const callsignValid = computed(() => props.callsign.trim().length >= 2)
const joinCode = computed(() =>
  roomCodeInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
)

const randomizeCallsign = () => {
  const a = ['Vex', 'Kuro', 'Rook', 'Nyx', 'Flux', 'Sable'][Math.floor(Math.random() * 6)]
  const b = ['Runner', 'Warden', 'Drift', 'Hound', 'Saint'][Math.floor(Math.random() * 5)]
  emit('update:callsign', `${a}-${b}`)
}

const handleJoin = () => {
  if (joinCode.value) emit('joinPeerRoom', joinCode.value)
}

const inviteLink = computed(() =>
  props.inviteRoomCode
    ? `${window.location.origin}${window.location.pathname}#room=${props.inviteRoomCode}`
    : ''
)
const copyInvite = async () => {
  try {
    await navigator.clipboard.writeText(inviteLink.value)
    copied.value = true
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => (copied.value = false), 1500)
  } catch { /* noop */ }
}
</script>

<template>
  <div class="lobby" :style="{ '--core': core.color }">
    <div class="wrap">
      <header class="top">
        <div class="brand">
          <span class="mark">LT</span>
          <span class="brand-t">LINKTOWN <small>3049 · ATMA TRIALS</small></span>
        </div>
        <span class="status" :class="{ on: dirOnline }">
          {{ dirOnline ? `${rooms.length} live` : 'offline' }}
        </span>
      </header>

      <div v-if="inviteRoomCode" class="invite" role="alert">
        <span>Room <strong>{{ inviteRoomCode }}</strong> is waiting for you.</span>
        <span class="invite-actions">
          <button class="quiet" @click="copyInvite">{{ copied ? 'Copied' : 'Copy link' }}</button>
          <button class="primary sm" :disabled="isConnecting" @click="emit('joinPeerRoom', inviteRoomCode)">
            {{ isConnecting ? 'Joining…' : 'Join room' }}
          </button>
        </span>
      </div>

      <section class="hero">
        <h2>Drop into Linktown.</h2>
        <p>10-minute trials. Hull is ammo. Only your Atma Core sets you apart.</p>
      </section>

      <section class="block">
        <label class="label" for="callsign">Callsign</label>
        <div class="row">
          <input
            id="callsign"
            type="text"
            maxlength="18"
            autocomplete="off"
            spellcheck="false"
            placeholder="e.g. Vex-Runner"
            :value="callsign"
            @input="emit('update:callsign', ($event.target as HTMLInputElement).value)"
          />
          <button class="quiet" @click="randomizeCallsign">Random</button>
        </div>

        <span class="label" style="margin-top: 20px">Atma Core</span>
        <div class="cores" role="listbox" aria-label="Atma cores">
          <button
            v-for="cid in CORE_IDS"
            :key="cid"
            role="option"
            :aria-selected="cid === selectedCore"
            class="core"
            :class="{ sel: cid === selectedCore }"
            @click="emit('update:selectedCore', cid)"
          >
            <span class="core-b">{{ CORE_DETAILS[cid].badge }}</span>
            <span class="core-n">{{ CORE_DETAILS[cid].name }}</span>
            <span class="core-a">{{ CORE_DETAILS[cid].ability }}</span>
          </button>
        </div>
        <p class="core-detail">
          <strong>{{ core.name }}</strong> — {{ core.desc }}
          <span class="muted">{{ core.maker }} · Q every {{ core.cooldown / 1000 }}s</span>
        </p>
      </section>

      <section class="block play">
        <button class="primary big" :disabled="!callsignValid" @click="emit('startSolo')">
          {{ isConnecting ? 'Working…' : 'Play solo' }}
        </button>
        <p v-if="!callsignValid" class="hint">Enter a callsign (min 2 characters) to play.</p>
        <p v-else class="hint">Instant match against bots. <kbd>Enter</kbd> to start.</p>

        <div class="row split">
          <button class="secondary" :disabled="!callsignValid || isConnecting" @click="emit('createPeerRoom')">
            Host match
          </button>
          <div class="join">
            <input
              v-model="roomCodeInput"
              maxlength="8"
              autocomplete="off"
              spellcheck="false"
              placeholder="Room code"
              aria-label="Room code"
              @keyup.enter="handleJoin"
            />
            <button class="secondary" :disabled="!joinCode || isConnecting" @click="handleJoin">Join</button>
          </div>
        </div>
      </section>

      <section class="block">
        <div class="rooms-head">
          <span class="label">Live rooms</span>
          <button class="quiet sm" @click="emit('refreshRooms')">Refresh</button>
        </div>
        <p v-if="!dirOnline" class="muted">Directory offline — you can still join by code.</p>
        <p v-else-if="rooms.length === 0" class="muted">No public rooms right now. Host one and it appears here.</p>
        <ul v-else class="rooms">
          <li v-for="r in rooms" :key="r.code">
            <span class="r-name">{{ r.name }}</span>
            <span class="muted">{{ r.code }} · {{ r.players }}/{{ r.maxPlayers || 16 }}</span>
            <button class="quiet sm" :disabled="isConnecting" @click="emit('joinPeerRoom', r.code)">Join</button>
          </li>
        </ul>
      </section>

      <details class="manual">
        <summary>Controls &amp; rules</summary>
        <p><kbd>WASD</kbd> move · <kbd>Mouse</kbd> aim · <kbd>Click</kbd> fire · <kbd>Q</kbd> core · <kbd>E</kbd> super · <kbd>R</kbd> shield · <kbd>Space</kbd> jump · <kbd>C</kbd> crouch · <kbd>Tab</kbd> scoreboard</p>
        <p class="muted">Shots, jumps and abilities spend hull. After 3s of calm, hull rebuilds — 3× faster while crouched.</p>
      </details>

      <footer class="foot">
        <a href="https://github.com/besoeasy/LINKTOWN" target="_blank" rel="noopener">Open source on GitHub</a>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.lobby {
  --core: #f97316;
  position: absolute; inset: 0; z-index: 20; overflow-y: auto;
  background: #0b0d12; color: #e8ebf1;
  font-family: 'Chakra Petch', 'Rajdhani', sans-serif;
}
.wrap { max-width: 720px; margin: 0 auto; padding: 36px 24px 32px; display: flex; flex-direction: column; gap: 28px; }

.top { display: flex; justify-content: space-between; align-items: center; }
.brand { display: flex; align-items: center; gap: 10px; }
.mark { width: 32px; height: 32px; display: grid; place-items: center; font-size: 13px; font-weight: 700; color: #0b0d12; background: #e8ebf1; border-radius: 6px; }
.brand-t { font-weight: 700; letter-spacing: 3px; font-size: 15px; }
.brand-t small { display: block; font-size: 10px; letter-spacing: 2px; color: #8a90a0; font-weight: 600; }
.status { font-size: 12px; color: #8a90a0; font-family: 'JetBrains Mono', monospace; }
.status.on { color: #7ee2a8; }

.invite { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; border: 1px solid #2a3040; border-radius: 8px; padding: 12px 14px; background: #11151d; }
.invite-actions { display: flex; gap: 8px; align-items: center; }

.hero h2 { margin: 0; font-size: 32px; letter-spacing: 1px; }
.hero p { margin: 6px 0 0; color: #aab0c0; }

.block { display: flex; flex-direction: column; gap: 10px; }
.label { font-size: 11px; letter-spacing: 2px; color: #8a90a0; font-weight: 700; }
.row { display: flex; gap: 8px; }
.row.split { margin-top: 4px; }
.row.split .secondary { flex-shrink: 0; }
.join { display: flex; gap: 8px; flex: 1; }

input {
  flex: 1; background: #11151d; border: 1px solid #2a3040; border-radius: 6px;
  color: #fff; font-family: inherit; font-size: 15px; padding: 10px 12px; outline: none; min-width: 0;
}
input:focus { border-color: var(--core); }
.join input { text-transform: uppercase; letter-spacing: 2px; text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 14px; }

.cores { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.core { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; background: #11151d; border: 1px solid #232835; border-radius: 8px; padding: 10px; cursor: pointer; color: #e8ebf1; font-family: inherit; text-align: left; }
.core:hover { border-color: #4a5266; }
.core.sel { border-color: var(--core); }
.core-b { font-size: 20px; }
.core-n { font-weight: 700; font-size: 13px; }
.core-a { font-size: 11px; color: #8a90a0; }
.core-detail { margin: 2px 0 0; font-size: 13px; color: #c6ccd8; }
.muted { color: #8a90a0; font-size: 13px; }
.core-detail .muted { display: block; margin-top: 2px; font-size: 12px; }

.play .hint { margin: 0; font-size: 12px; color: #8a90a0; }

.primary { background: var(--core); border: 1px solid var(--core); color: #0b0d12; font-weight: 800; border-radius: 8px; padding: 10px 18px; cursor: pointer; font-family: inherit; font-size: 14px; }
.primary:hover:not(:disabled) { filter: brightness(1.08); }
.primary:disabled { opacity: .35; cursor: not-allowed; }
.primary.big { width: 100%; font-size: 17px; padding: 14px; }
.primary.sm { padding: 8px 14px; font-size: 13px; }
.secondary { background: transparent; border: 1px solid #2a3040; color: #e8ebf1; border-radius: 8px; padding: 10px 16px; font-weight: 700; cursor: pointer; font-family: inherit; font-size: 14px; white-space: nowrap; }
.secondary:hover:not(:disabled) { border-color: #6b7488; }
.secondary:disabled { opacity: .35; cursor: not-allowed; }
.quiet { background: none; border: none; color: #aab0c0; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 600; white-space: nowrap; padding: 10px 8px; }
.quiet:hover { color: #fff; }
.quiet.sm { padding: 4px 8px; font-size: 12px; }

.rooms-head { display: flex; justify-content: space-between; align-items: center; }
.rooms { list-style: none; margin: 0; padding: 0; border-top: 1px solid #1c212c; }
.rooms li { display: flex; align-items: center; gap: 12px; padding: 10px 2px; border-bottom: 1px solid #1c212c; font-size: 14px; }
.r-name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rooms li .muted { font-family: 'JetBrains Mono', monospace; font-size: 12px; }
.rooms li button { margin-left: auto; }

.manual { border-top: 1px solid #1c212c; padding-top: 12px; font-size: 13px; color: #aab0c0; }
.manual summary { cursor: pointer; color: #8a90a0; font-size: 12px; letter-spacing: 1px; }
.manual p { line-height: 1.6; }
kbd { background: #1c212c; border: 1px solid #2a3040; border-radius: 4px; padding: 0 6px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #fff; }

.foot { border-top: 1px solid #1c212c; padding-top: 12px; }
.foot a { color: #8a90a0; font-size: 12px; text-decoration: none; }
.foot a:hover { color: #fff; }

button:focus-visible, input:focus-visible, summary:focus-visible, a:focus-visible { outline: 2px solid var(--core); outline-offset: 2px; }

@media (max-width: 560px) {
  .cores { grid-template-columns: repeat(2, 1fr); }
  .row.split { flex-direction: column; }
  .hero h2 { font-size: 26px; }
}
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
</style>
