// Synthesized Web Audio API sound engine for L-Town
class SoundEngine {
  private ctx: AudioContext | null = null
  private footstepTimer: any = null
  private isWalking = false
  private rechargeOsc: OscillatorNode | null = null
  private rechargeGain: GainNode | null = null

  private init() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
      if (AudioContextClass) {
        this.ctx = new AudioContextClass()
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume()
    }
  }

  playShoot(heavy = false) {
    this.init()
    if (!this.ctx) return
    const now = this.ctx.currentTime

    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()

    osc.type = heavy ? 'sawtooth' : 'triangle'
    osc.frequency.setValueAtTime(heavy ? 220 : 480, now)
    osc.frequency.exponentialRampToValueAtTime(heavy ? 40 : 60, now + (heavy ? 0.22 : 0.12))

    gain.gain.setValueAtTime(heavy ? 0.35 : 0.22, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + (heavy ? 0.22 : 0.12))

    osc.connect(gain)
    gain.connect(this.ctx.destination)

    osc.start(now)
    osc.stop(now + (heavy ? 0.22 : 0.12))
  }

  playHit() {
    this.init()
    if (!this.ctx) return
    const now = this.ctx.currentTime

    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(140, now)
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.18)

    gain.gain.setValueAtTime(0.3, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18)

    osc.connect(gain)
    gain.connect(this.ctx.destination)

    osc.start(now)
    osc.stop(now + 0.18)
  }

  playHitConfirm(killed = false) {    this.init()
    if (!this.ctx) return
    const now = this.ctx.currentTime

    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(killed ? 960 : 720, now)
    osc.frequency.exponentialRampToValueAtTime(killed ? 1280 : 880, now + 0.08)

    gain.gain.setValueAtTime(killed ? 0.25 : 0.15, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08)

    osc.connect(gain)
    gain.connect(this.ctx.destination)

    osc.start(now)
    osc.stop(now + 0.08)
  }

  /** Dry-fire click: tried to shoot with no spendable Hull. Kept quiet. */
  playDryFire() {
    this.init()
    if (!this.ctx) return
    const now = this.ctx.currentTime

    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()

    osc.type = 'square'
    osc.frequency.setValueAtTime(1150, now)
    osc.frequency.exponentialRampToValueAtTime(750, now + 0.04)

    gain.gain.setValueAtTime(0.08, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04)

    osc.connect(gain)
    gain.connect(this.ctx.destination)

    osc.start(now)
    osc.stop(now + 0.04)
  }

  /** Low-Hull warning thump (HUD re-triggers at most ~1/s while critical). */
  playLowHull() {
    this.init()
    if (!this.ctx) return
    const now = this.ctx.currentTime

    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()

    osc.type = 'triangle'
    osc.frequency.setValueAtTime(330, now)
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.12)

    gain.gain.setValueAtTime(0.13, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)

    osc.connect(gain)
    gain.connect(this.ctx.destination)

    osc.start(now)
    osc.stop(now + 0.12)
  }

  playKill() {
    this.init()
    if (!this.ctx) return
    const now = this.ctx.currentTime

    // Canon Kill Jingle: 440 -> 880 -> 1200
    const notes = [
      { f: 520, dur: 0.06, delay: 0 },
      { f: 780, dur: 0.08, delay: 0.06 },
      { f: 1180, dur: 0.16, delay: 0.14 },
    ]

    for (const note of notes) {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()

      osc.type = 'square'
      osc.frequency.setValueAtTime(note.f, now + note.delay)

      gain.gain.setValueAtTime(0.18, now + note.delay)
      gain.gain.exponentialRampToValueAtTime(0.001, now + note.delay + note.dur)

      osc.connect(gain)
      gain.connect(this.ctx.destination)

      osc.start(now + note.delay)
      osc.stop(now + note.delay + note.dur)
    }
  }

  playCachePickup() {
    this.init()
    if (!this.ctx) return
    const now = this.ctx.currentTime

    // Nanite Cache Salvage Chime: dual ascending harmonic burst (D5 -> A5 -> E6)
    const notes = [
      { f: 587.3, dur: 0.10, delay: 0 },
      { f: 880.0, dur: 0.12, delay: 0.05 },
      { f: 1318.5, dur: 0.22, delay: 0.10 }
    ]

    for (const note of notes) {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(note.f, now + note.delay)
      osc.frequency.exponentialRampToValueAtTime(note.f * 1.05, now + note.delay + note.dur)

      gain.gain.setValueAtTime(0.22, now + note.delay)
      gain.gain.exponentialRampToValueAtTime(0.001, now + note.delay + note.dur)

      osc.connect(gain)
      gain.connect(this.ctx.destination)

      osc.start(now + note.delay)
      osc.stop(now + note.delay + note.dur)
    }
  }

  playNaniteMorph(toBlaster: boolean) {
    this.init()
    if (!this.ctx) return
    const now = this.ctx.currentTime

    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()

    if (toBlaster) {
      // Snappy high-tech nanite reconfiguration & magnetic latch
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(320, now)
      osc.frequency.exponentialRampToValueAtTime(1120, now + 0.08)
      gain.gain.setValueAtTime(0.16, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11)
      osc.start(now)
      osc.stop(now + 0.11)
    } else {
      // Smooth nanite demorph release hum back to open hand
      osc.type = 'sine'
      osc.frequency.setValueAtTime(740, now)
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.22)
      gain.gain.setValueAtTime(0.10, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22)
      osc.start(now)
      osc.stop(now + 0.22)
    }

    osc.connect(gain)
    gain.connect(this.ctx.destination)
  }

  playSuper() {
    this.init()
    if (!this.ctx) return
    const now = this.ctx.currentTime

    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()

    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(150, now)
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.35)

    gain.gain.setValueAtTime(0.2, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35)

    osc.connect(gain)
    gain.connect(this.ctx.destination)

    osc.start(now)
    osc.stop(now + 0.35)
  }

  playShield() {
    this.init()
    if (!this.ctx) return
    const now = this.ctx.currentTime

    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(300, now)
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.4)

    gain.gain.setValueAtTime(0.25, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4)

    osc.connect(gain)
    gain.connect(this.ctx.destination)

    osc.start(now)
    osc.stop(now + 0.4)
  }

  playSuperJump() {
    this.init()
    if (!this.ctx) return
    const now = this.ctx.currentTime

    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()

    osc.type = 'triangle'
    osc.frequency.setValueAtTime(80, now)
    osc.frequency.exponentialRampToValueAtTime(540, now + 0.28)

    gain.gain.setValueAtTime(0.3, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28)

    osc.connect(gain)
    gain.connect(this.ctx.destination)

    osc.start(now)
    osc.stop(now + 0.28)
  }

  playDie() {
    this.init()
    if (!this.ctx) return
    const now = this.ctx.currentTime

    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()

    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(320, now)
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.45)

    gain.gain.setValueAtTime(0.3, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45)

    osc.connect(gain)
    gain.connect(this.ctx.destination)

    osc.start(now)
    osc.stop(now + 0.45)
  }

  playAbility() {
    this.init()
    if (!this.ctx) return
    const now = this.ctx.currentTime

    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(350, now)
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.25)

    gain.gain.setValueAtTime(0.25, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25)

    osc.connect(gain)
    gain.connect(this.ctx.destination)

    osc.start(now)
    osc.stop(now + 0.25)
  }

  playJumpPadLaunch() {
    this.init()
    if (!this.ctx) return
    const now = this.ctx.currentTime

    // 1. Heavy pneumatic punch
    const punch = this.ctx.createOscillator()
    const punchGain = this.ctx.createGain()
    punch.type = 'triangle'
    punch.frequency.setValueAtTime(170, now)
    punch.frequency.exponentialRampToValueAtTime(32, now + 0.36)
    punchGain.gain.setValueAtTime(0.42, now)
    punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.36)
    punch.connect(punchGain)
    punchGain.connect(this.ctx.destination)
    punch.start(now)
    punch.stop(now + 0.36)

    // 2. Rising kinetic ionization sweep
    const sweep = this.ctx.createOscillator()
    const sweepGain = this.ctx.createGain()
    sweep.type = 'sawtooth'
    sweep.frequency.setValueAtTime(220, now)
    sweep.frequency.exponentialRampToValueAtTime(1150, now + 0.30)
    sweepGain.gain.setValueAtTime(0.22, now)
    sweepGain.gain.exponentialRampToValueAtTime(0.001, now + 0.30)
    sweep.connect(sweepGain)
    sweepGain.connect(this.ctx.destination)
    sweep.start(now)
    sweep.stop(now + 0.30)
  }

  startFootsteps(running = false) {
    if (this.isWalking) return
    this.isWalking = true
    const interval = running ? 260 : 380

    const step = () => {
      if (!this.isWalking) return
      this.init()
      if (this.ctx) {
        const now = this.ctx.currentTime
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(80, now)
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.05)
        gain.gain.setValueAtTime(0.08, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05)
        osc.connect(gain)
        gain.connect(this.ctx.destination)
        osc.start(now)
        osc.stop(now + 0.05)
      }
      this.footstepTimer = setTimeout(step, interval)
    }
    step()
  }

  stopFootsteps() {
    this.isWalking = false
    if (this.footstepTimer) {
      clearTimeout(this.footstepTimer)
      this.footstepTimer = null
    }
  }

  startRecharge() {
    if (this.rechargeOsc) return
    this.init()
    if (!this.ctx) return
    const now = this.ctx.currentTime

    this.rechargeOsc = this.ctx.createOscillator()
    this.rechargeGain = this.ctx.createGain()

    this.rechargeOsc.type = 'sine'
    this.rechargeOsc.frequency.setValueAtTime(220, now)
    this.rechargeGain.gain.setValueAtTime(0.04, now)

    this.rechargeOsc.connect(this.rechargeGain)
    this.rechargeGain.connect(this.ctx.destination)

    this.rechargeOsc.start(now)
  }

  stopRecharge() {
    if (this.rechargeOsc) {
      try {
        this.rechargeOsc.stop()
        this.rechargeOsc.disconnect()
      } catch {}
      this.rechargeOsc = null
      this.rechargeGain = null
    }
  }
}

export const sound = new SoundEngine()
