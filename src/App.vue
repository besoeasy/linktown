<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { CoreId } from './game/config'
import { STATIC_MAP_SEED } from './game/map'
import { SceneRenderer } from './game/scene'
import { GameEngine } from './game/engine'
import type { PlayerState, KillMsg, HitConfirmMsg, TelemetryData, MatchResults } from './net/types'
import { P2PHost, P2PClient } from './net/webrtc'
import { generateRoomCode, PeerJSHost, PeerJSClient } from './net/peer'
import { encodeSignal, decodeSignal } from './net/qr'
import { RoomDirectory, type PublicRoom } from './net/directory'

import Lobby from './components/Lobby.vue'
import Hud from './components/Hud.vue'
import Scoreboard from './components/Scoreboard.vue'
import GameOverModal from './components/GameOverModal.vue'
import QrModal from './components/QrModal.vue'
import LanModal from './components/LanModal.vue'
import { LanSignaler } from './net/lan'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const inLobby = ref(true)
const callsign = ref(localStorage.getItem('ltown_callsign') || 'Pilot-' + Math.floor(100 + Math.random() * 900))
const selectedCore = ref<CoreId>('denja')

// Unified PeerJS Room State
const currentRoomCode = ref('')
const inviteRoomCode = ref('')
const isConnecting = ref(false)
let peerHost: PeerJSHost | null = null
let peerClient: PeerJSClient | null = null

// Match State
const localPlayer = ref<PlayerState>({} as any)
const matchTime = ref(600)
const leaderboard = ref<{ id: number; name: string; score: number }[]>([])
const hvtId = ref<number | null>(null)
const killFeed = ref<KillMsg[]>([])
const hitFlash = ref(false)
const hitConfirm = ref({ show: false, amount: 0, killed: false })
const cachePopup = ref({ show: false, amount: 0 })
const showScoreboard = ref(false)
const isGameOver = ref(false)
const p2pStatus = ref('')
const matchResults = ref<MatchResults | null>(null)
const telemetry = ref<TelemetryData>({
  ping: 0,
  fps: 60,
  connectedPlayers: 1,
  humanPlayers: 1,
  botPlayers: 0,
  mode: 'solo',
  tickRate: 20
})
let currentMatchMode: 'solo' | 'host' | 'client' = 'solo'

// Public room directory (presence; joins stay direct PeerJS P2P)
const publicRooms = ref<PublicRoom[]>([])
const dirOnline = ref(false)
let directory: RoomDirectory | null = null
let dirUnsub: (() => void) | null = null

const announceHostedRoom = () => {
  if (!directory || currentMatchMode !== 'host' || !currentRoomCode.value) return
  directory.publish({
    code: currentRoomCode.value,
    name: `${callsign.value}'s trial`,
    core: selectedCore.value,
    players: (peerHost?.peers.size ?? 0) + 1
  })
}

const withdrawHostedRoom = () => {
  directory?.unpublish()
}

const refreshRooms = () => {
  directory?.refresh()
}

// QR / LAN Modal State
const qrModal = ref({
  show: false,
  title: '',
  signalData: '',
  mode: 'display' as 'display' | 'input',
  pendingCallback: null as ((data: any) => void) | null
})

// Simplified LAN Modal State
const lanModal = ref({
  show: false,
  mode: 'join' as 'host' | 'join',
  connectedPeersCount: 1
})
const lanModalRef = ref<InstanceType<typeof LanModal> | null>(null)
let lanSignaler: LanSignaler | null = null

let engine: GameEngine | null = null
let sceneRenderer: SceneRenderer | null = null
let p2pHost: P2PHost | null = null
let p2pClient: P2PClient | null = null

onMounted(() => {
  // Listen for Tab or F to toggle scoreboard
  window.addEventListener('keydown', handleGlobalKey)
  window.addEventListener('keyup', handleGlobalKeyUp)

  // Detect room invite in URL hash (#room=XYZ) or search query (?room=XYZ)
  if (typeof window !== 'undefined') {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const searchParams = new URLSearchParams(window.location.search)
    const code = hashParams.get('room') || searchParams.get('room')
    if (code) {
      inviteRoomCode.value = code.trim().toUpperCase()
    }
  }

  // Connect to the public room directory in the background. If the
  // broker is unreachable the lobby just shows manual code join.
  directory = new RoomDirectory()
  dirUnsub = directory.onRooms((rooms) => {
    publicRooms.value = rooms
  })
  directory.connect().then((ok) => {
    dirOnline.value = ok
  })

  // Expose test and telemetry hooks on window for multi-container verification
  if (typeof window !== 'undefined') {
    ;(window as any).__getGameState = () => {
      return {
        mode: currentMatchMode,
        inLobby: inLobby.value,
        p2pStatus: p2pStatus.value,
        roomCode: currentRoomCode.value,
        callsign: callsign.value,
        selectedCore: selectedCore.value,
        seed: engine?.map?.seed,
        matchTime: matchTime.value,
        playersCount: engine?.players?.size || 0,
        players: engine ? [...engine.players.values()].map(p => ({
          id: p.id,
          name: p.name,
          character: p.character,
          x: Math.round(p.x * 100) / 100,
          y: Math.round(p.y * 100) / 100,
          z: Math.round(p.z * 100) / 100,
          yaw: Math.round(p.yaw * 100) / 100,
          pitch: Math.round(p.pitch * 100) / 100,
          health: p.health,
          score: p.score,
          alive: p.alive,
          isBot: p.isBot
        })) : [],
        localPlayerId: engine?.localPlayer?.id,
        localPlayer: engine ? {
          id: engine.localPlayer.id,
          name: engine.localPlayer.name,
          character: engine.localPlayer.character,
          x: Math.round(engine.localPlayer.x * 100) / 100,
          y: Math.round(engine.localPlayer.y * 100) / 100,
          z: Math.round(engine.localPlayer.z * 100) / 100,
          health: engine.localPlayer.health,
          alive: engine.localPlayer.alive
        } : null,
        remotePlayers: engine ? [...engine.players.values()].filter(p => p.id !== engine?.localPlayer?.id).map(p => ({
          id: p.id,
          name: p.name,
          character: p.character,
          x: Math.round(p.x * 100) / 100,
          y: Math.round(p.y * 100) / 100,
          z: Math.round(p.z * 100) / 100,
          health: p.health,
          alive: p.alive,
          isBot: p.isBot
        })) : [],
        remoteMeshesCount: (sceneRenderer as any)?.playerMeshes?.size || 0
      }
    }
    ;(window as any).__createPeerRoom = createPeerRoom
    ;(window as any).__joinPeerRoom = joinPeerRoom
    ;(window as any).__startSolo = startSolo
    ;(window as any).__setCallsign = (name: string) => { callsign.value = name }
    ;(window as any).__engine = () => engine
    ;(window as any).__sceneRenderer = () => sceneRenderer
    ;(window as any).__p2pHost = () => peerHost || p2pHost
    ;(window as any).__p2pClient = () => peerClient || p2pClient
    ;(window as any).__peerHost = () => peerHost
    ;(window as any).__peerClient = () => peerClient
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKey)
  window.removeEventListener('keyup', handleGlobalKeyUp)
  dirUnsub?.()
  directory?.destroy()
  directory = null
  engine?.destroy()
})

const handleGlobalKey = (e: KeyboardEvent) => {
  if (e.key === 'Tab' || e.key.toLowerCase() === 'f') {
    e.preventDefault()
    showScoreboard.value = true
  }
}

const handleGlobalKeyUp = (e: KeyboardEvent) => {
  if (e.key === 'Tab' || e.key.toLowerCase() === 'f') {
    showScoreboard.value = false
  }
}

const initEngine = (seed: number, mode: 'solo' | 'host' | 'client') => {
  if (!canvasRef.value) return
  currentMatchMode = mode
  p2pStatus.value = ''
  localStorage.setItem('ltown_callsign', callsign.value)
  isGameOver.value = false
  matchResults.value = null

  sceneRenderer = new SceneRenderer(canvasRef.value)
  engine = new GameEngine(
    canvasRef.value,
    sceneRenderer,
    seed,
    callsign.value,
    selectedCore.value,
    mode,
    {
      onHudUpdate: (p, time, hvt, telem) => {
        localPlayer.value = { ...p }
        matchTime.value = time
        hvtId.value = hvt
        if (telem) telemetry.value = telem
      },
      onHit: () => {
        hitFlash.value = true
        setTimeout(() => { hitFlash.value = false }, 150)
      },
      onHitConfirm: (msg: HitConfirmMsg) => {
        hitConfirm.value = { show: true, amount: msg.amount, killed: msg.killed }
        setTimeout(() => { hitConfirm.value.show = false }, 400)
      },
      onKill: (msg: KillMsg) => {
        killFeed.value.unshift(msg)
        if (killFeed.value.length > 5) killFeed.value.pop()
      },
      onCachePickup: (amount: number) => {
        cachePopup.value = { show: true, amount }
        setTimeout(() => { cachePopup.value.show = false }, 1200)
      },
      onLeaderboardUpdate: (lb) => {
        leaderboard.value = lb
      },
      onMatchEnd: (results) => {
        matchResults.value = results
        isGameOver.value = true
      }
    }
  )

  inLobby.value = false
  engine.start()
}

const handlePlayAgain = () => {
  isGameOver.value = false
  matchResults.value = null
  withdrawHostedRoom()
  const seed = engine?.map?.seed ?? STATIC_MAP_SEED
  engine?.destroy()
  if (currentMatchMode === 'solo') {
    startSolo()
  } else if (currentMatchMode === 'host') {
    if (peerHost) {
      // PeerJS room stays open: re-init the engine on the same broker room.
      initEngine(seed, 'host')
      engine?.setHostNetwork(peerHost)
      announceHostedRoom()
    } else {
      startHostMatch()
    }
  } else {
    inLobby.value = true
  }
}

const handleReturnToLobby = () => {
  isGameOver.value = false
  matchResults.value = null
  withdrawHostedRoom()
  engine?.destroy()
  peerHost?.destroy()
  peerClient?.destroy()
  p2pHost?.destroy()
  p2pClient?.destroy()
  peerHost = null
  peerClient = null
  p2pHost = null
  p2pClient = null
  currentRoomCode.value = ''
  if (typeof window !== 'undefined') {
    window.location.hash = ''
  }
  inLobby.value = true
}

// Unified P2P Match (PeerJS Cloud WebRTC)
const createPeerRoom = () => {
  if (engine?.isRunning) return
  const code = generateRoomCode()
  currentRoomCode.value = code
  if (typeof window !== 'undefined') {
    window.location.hash = `room=${code}`
  }
  const seed = STATIC_MAP_SEED
  p2pStatus.value = `HOSTING (ROOM: ${code})`

  peerHost = new PeerJSHost(
    code,
    (msg, fromId) => engine?.handleNetworkMessage(msg, fromId),
    (peerId) => {
      console.log(`[App] Peer ${peerId} joined match!`)
      p2pStatus.value = `P2P LINKED (${peerHost?.peers.size || 0} PEERS)`
      engine?.onPeerConnected(peerId)
      announceHostedRoom()
    },
    (peerId) => {
      console.log(`[App] Peer ${peerId} disconnected`)
      p2pStatus.value = `P2P LINKED (${peerHost?.peers.size || 0} PEERS)`
      engine?.onPeerDisconnected(peerId)
      announceHostedRoom()
    },
    (roomCode) => {
      console.log(`[App] Host room ${roomCode} ready on PeerJS Cloud`)
    },
    (err) => {
      console.error('[App] PeerJS Host error:', err)
      p2pStatus.value = 'HOST ERROR'
    }
  )

  peerHost.setSeed(seed)
  initEngine(seed, 'host')
  engine?.setHostNetwork(peerHost)
  announceHostedRoom()
}

const joinPeerRoom = (code: string) => {
  if (engine?.isRunning) return
  const roomCode = code.trim().toUpperCase()
  currentRoomCode.value = roomCode
  p2pStatus.value = `CONNECTING TO ${roomCode}...`
  isConnecting.value = true

  peerClient = new PeerJSClient(
    roomCode,
    (msg) => {
      if (msg.type === 'welcome') {
        p2pStatus.value = `P2P LINKED (ROOM: ${roomCode})`
        initEngine(msg.seed, 'client')
        engine?.setClientNetwork(peerClient!)
        engine?.handleNetworkMessage(msg)
        isConnecting.value = false
        return
      }
      engine?.handleNetworkMessage(msg)
    },
    () => {
      console.log(`[App] PeerJS connected to room ${roomCode}`)
    },
    () => {
      console.log(`[App] PeerJS disconnected from room ${roomCode}`)
      p2pStatus.value = 'DISCONNECTED'
    },
    (err) => {
      console.error(`[App] PeerJS connection error:`, err)
      p2pStatus.value = 'CONNECTION ERROR'
      isConnecting.value = false
      alert(`Could not connect to room "${roomCode}". Make sure the host has started the match!`)
    }
  )
}

// 1. Launch Solo Mode with Bots
const startSolo = () => {
  const seed = STATIC_MAP_SEED
  initEngine(seed, 'solo')
}

// 2. Host LAN via simple Host Address
const hostLan = async () => {
  const seed = STATIC_MAP_SEED
  p2pHost = new P2PHost(
    (msg, fromId) => engine?.handleNetworkMessage(msg, fromId),
    (peer) => {
      lanModal.value.connectedPeersCount = (p2pHost?.peers.size || 0) + 1
      engine?.onPeerConnected(peer.id)
    },
    (id) => {
      lanModal.value.connectedPeersCount = (p2pHost?.peers.size || 0) + 1
      engine?.onPeerDisconnected(id)
    }
  )

  lanSignaler = new LanSignaler()
  try {
    const ws = await lanSignaler.connect(window.location.host || 'localhost:30300')
    p2pHost!.setSeed(seed)
    ws.send(JSON.stringify({
      type: 'register_host',
      seed,
      name: callsign.value,
      core: selectedCore.value
    }))

    ws.onmessage = async (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'peer_offer') {
          await p2pHost!.handleIncomingOffer(msg.offer, (answer) => {
            ws.send(JSON.stringify({
              type: 'host_answer',
              peerId: msg.peerId,
              answer
            }))
          }, (candidate) => {
            ws.send(JSON.stringify({
              type: 'ice_candidate',
              peerId: msg.peerId,
              candidate
            }))
          }, msg.peerId)
        } else if (msg.type === 'ice_candidate' && msg.candidate) {
          p2pHost!.addIceCandidate(msg.peerId, msg.candidate)
        } else if (msg.type === 'peer_disconnected') {
          lanModal.value.connectedPeersCount = (p2pHost?.peers.size || 0) + 1
          engine?.onPeerDisconnected(msg.peerId)
          const peer = p2pHost?.peers.get(msg.peerId)
          if (peer) {
            try { peer.dc?.close() } catch {}
            try { peer.pc.close() } catch {}
            p2pHost?.peers.delete(msg.peerId)
          }
        }
      } catch (err) {
        console.warn('LAN signaling error:', err)
      }
    }
  } catch (err) {
    console.warn('Local LAN websocket signaling broker unavailable:', err)
  }

  lanModal.value = {
    show: true,
    mode: 'host',
    connectedPeersCount: 1
  }
}

const startHostMatch = () => {
  const seed = STATIC_MAP_SEED
  lanModal.value.show = false
  initEngine(seed, 'host')
  engine?.setHostNetwork(p2pHost!)
}

// 3. Join LAN via Host Address
const joinLan = () => {
  lanModal.value = {
    show: true,
    mode: 'join',
    connectedPeersCount: 1
  }
}

const handleJoinLan = async (hostAddress: string) => {
  lanSignaler = new LanSignaler()
  try {
    const ws = await lanSignaler.connect(hostAddress)
    p2pClient = new P2PClient(
      (msg) => engine?.handleNetworkMessage(msg),
      () => console.log('Connected to LAN host DataChannel!')
    )

    ws.onmessage = async (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'host_answer') {
          try {
            await p2pClient!.handleAnswer(msg.answer)
          } catch (err) {
            lanModalRef.value?.setConnecting(false, 'Failed to process host answer')
            return
          }
          lanModal.value.show = false
          initEngine(msg.seed ?? STATIC_MAP_SEED, 'client')
          engine?.setClientNetwork(p2pClient!)
        } else if (msg.type === 'ice_candidate' && msg.candidate) {
          p2pClient!.addIceCandidate(msg.candidate)
        } else if (msg.type === 'error') {
          lanModalRef.value?.setConnecting(false, msg.message)
        }
      } catch (err) {
        lanModalRef.value?.setConnecting(false, 'Failed to process host answer')
      }
    }

    await p2pClient.createOffer((offer) => {
      ws.send(JSON.stringify({
        type: 'peer_offer',
        offer,
        callsign: callsign.value
      }))
    }, (candidate) => {
      ws.send(JSON.stringify({
        type: 'ice_candidate',
        candidate
      }))
    })
  } catch (err: any) {
    lanModalRef.value?.setConnecting(false, err.message || 'Could not connect to host address')
  }
}

const switchToAirgap = () => {
  lanModal.value.show = false
  qrModal.value = {
    show: true,
    title: 'AIR-GAP SIGNALING',
    signalData: '',
    mode: 'input',
    pendingCallback: null
  }
}

const handleSignalSubmit = (val: string) => {
  if (qrModal.value.pendingCallback) {
    qrModal.value.pendingCallback(val)
  } else if (p2pClient) {
    try {
      const answer = decodeSignal(val)
      p2pClient.handleAnswer(answer)
      qrModal.value.show = false
    } catch {
      alert('Failed to parse answer token')
    }
  }
}
</script>

<template>
  <div class="app-root">
    <!-- 3D WebGL Canvas -->
    <canvas ref="canvasRef" class="render-canvas"></canvas>

    <!-- Lobby Menu Overlay -->
    <Lobby
      v-if="inLobby"
      v-model:callsign="callsign"
      v-model:selectedCore="selectedCore"
      :rooms="publicRooms"
      :dir-online="dirOnline"
      :invite-room-code="inviteRoomCode"
      :is-connecting="isConnecting"
      @start-solo="startSolo"
      @create-peer-room="createPeerRoom"
      @join-peer-room="joinPeerRoom"
      @refresh-rooms="refreshRooms"
    />

    <!-- In-Game HUD -->
    <Hud
      v-else
      :player="localPlayer"
      :match-time="matchTime"
      :kill-feed="killFeed"
      :hit-flash="hitFlash"
      :hit-confirm="hitConfirm"
      :cache-popup="cachePopup"
      :telemetry="telemetry"
      :p2p-status="p2pStatus"
      :room-code="currentRoomCode"
    />

    <!-- Tab / F Scoreboard -->
    <Scoreboard
      :show="showScoreboard"
      :leaderboard="leaderboard"
      :hvt-id="hvtId"
      :local-player-id="localPlayer.id || 1"
    />

    <!-- Game Over / Match End Screen -->
    <GameOverModal
      :show="isGameOver"
      :results="matchResults"
      :local-player-id="localPlayer.id || 1"
      @play-again="handlePlayAgain"
      @return-to-lobby="handleReturnToLobby"
    />

    <!-- Simplified LAN Modal (Host Address) -->
    <LanModal
      ref="lanModalRef"
      :show="lanModal.show"
      :mode="lanModal.mode"
      :connected-peers-count="lanModal.connectedPeersCount"
      @close="lanModal.show = false"
      @join="handleJoinLan"
      @start-match="startHostMatch"
      @switch-airgap="switchToAirgap"
    />

    <!-- Air-gapped QR / Token Modal -->
    <QrModal
      :show="qrModal.show"
      :title="qrModal.title"
      :signal-data="qrModal.signalData"
      :mode="qrModal.mode"
      @close="qrModal.show = false"
      @submit-signal="handleSignalSubmit"
    />
  </div>
</template>

<style>
* {
  box-sizing: border-box;
}

body, html {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #080a10;
}

.app-root {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.render-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: block;
}
</style>
