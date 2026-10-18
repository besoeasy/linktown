import type { Gfx } from './gfx'

/**
 * Debug performance overlay, enabled with `?debug=1`.
 *
 * Shows per-frame totals across *all* passes (shadow, main, post):
 * backend in use, draw calls, triangles, live geometries/textures, CPU time
 * spent in SceneRenderer.render(), frame interval, and GPU frame time
 * (WebGPU timestamp queries or EXT_disjoint_timer_query_webgl2 on the WebGL 2
 * backend — measured in gfx.ts, which also uses it for the adaptive render
 * scale). GPU time is the honest number: FPS is capped by vsync and hides how
 * much headroom is left.
 */
export function isPerfOverlayEnabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1'
  } catch {
    return false
  }
}

const SAMPLE_WINDOW_MS = 250

export class PerfOverlay {
  private el: HTMLDivElement

  private frameStartMs = 0
  private lastFrameStartMs = 0
  // Accumulators for the current sample window
  private frames = 0
  private cpuMsSum = 0
  private intervalMsSum = 0
  private gpuMsSum = 0
  private gpuSamples = 0
  private callsMax = 0
  private trisMax = 0
  private windowStart = performance.now()

  constructor(private gfx: Gfx) {
    // Count every render the post stack issues per frame, reset manually.
    gfx.renderer.info.autoReset = false

    this.el = document.createElement('div')
    this.el.id = 'perf-overlay'
    Object.assign(this.el.style, {
      position: 'fixed',
      // Left edge under the frags/clock panels, clear of the bottom HUD
      left: '28px',
      top: '110px',
      zIndex: '9999',
      padding: '6px 8px',
      font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
      color: '#d1fae5',
      background: 'rgba(0, 0, 0, 0.72)',
      borderRadius: '4px',
      whiteSpace: 'pre',
      pointerEvents: 'none'
    } satisfies Partial<CSSStyleDeclaration>)
    document.body.appendChild(this.el)
  }

  /** Call at the very start of SceneRenderer.render(). */
  frameStart() {
    const now = performance.now()
    if (this.lastFrameStartMs > 0) this.intervalMsSum += now - this.lastFrameStartMs
    this.lastFrameStartMs = now
    this.frameStartMs = now
  }

  /** Call right before the frame is submitted. */
  gpuBegin() {
    this.gfx.renderer.info.reset()
    // gfx resolves GPU frame times a few frames late; sample the latest.
    const gpu = this.gfx.gpuTimeMs
    if (gpu !== null) {
      this.gpuMsSum += gpu
      this.gpuSamples++
    }
  }

  /** Call right after the frame is submitted. */
  frameEnd() {
    const info = this.gfx.renderer.info
    // WebGPU counts render passes in `render.calls` (a lifetime counter) and
    // per-frame draws in `render.drawCalls`; WebGL only has `render.calls`
    // (per-frame draws). Prefer the per-frame number.
    const render = info.render as { calls: number; drawCalls?: number }
    const calls = typeof render.drawCalls === 'number' ? render.drawCalls : render.calls
    this.callsMax = Math.max(this.callsMax, calls)
    this.trisMax = Math.max(this.trisMax, info.render.triangles)
    this.cpuMsSum += performance.now() - this.frameStartMs
    this.frames++

    const now = performance.now()
    if (now - this.windowStart >= SAMPLE_WINDOW_MS) this.flush(now)
  }

  private flush(now: number) {
    const n = Math.max(1, this.frames)
    const interval = this.intervalMsSum / n
    const info = this.gfx.renderer.info
    const gpu = this.gpuSamples > 0
      ? `${(this.gpuMsSum / this.gpuSamples).toFixed(2)} ms`
      : 'n/a (no timestamp support)'

    const lines = [
      `gfx       ${this.gfx.kind}  ${this.gfx.quality}  ${this.gfx.drawWidth}x${this.gfx.drawHeight} @${this.gfx.pixelRatio.toFixed(2)}x`,
      `fps       ${interval > 0 ? (1000 / interval).toFixed(0) : '—'}  (${interval.toFixed(2)} ms/frame)`,
      `gpu       ${gpu}`,
      `cpu       ${(this.cpuMsSum / n).toFixed(2)} ms  (scene.render)`,
      `calls     ${this.callsMax}`,
      `tris      ${(this.trisMax / 1000).toFixed(1)}k`,
      `geo/tex   ${info.memory.geometries} / ${info.memory.textures}`
    ]
    if (this.gfx.renderScale < 1) lines.push(`scale     ${this.gfx.renderScale.toFixed(2)}x  (adaptive)`)
    // `programs` only exists on the WebGL 2 backend's info object.
    const programs = (info as { programs?: unknown[] }).programs
    if (programs) lines.push(`programs  ${programs.length}`)

    this.el.textContent = lines.join('\n')

    this.frames = 0
    this.cpuMsSum = 0
    this.intervalMsSum = 0
    this.gpuMsSum = 0
    this.gpuSamples = 0
    this.callsMax = 0
    this.trisMax = 0
    this.windowStart = now
  }

  dispose() {
    this.gfx.renderer.info.autoReset = true
    this.el.remove()
  }
}
