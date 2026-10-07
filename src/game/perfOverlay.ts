import type * as THREE from 'three'

/**
 * Debug performance overlay, enabled with `?debug=1`.
 *
 * Shows per-frame totals across *all* passes (shadow, main, post):
 * draw calls, triangles, live geometries/textures/programs, CPU time spent
 * in SceneRenderer.render(), frame interval, and GPU time measured with
 * EXT_disjoint_timer_query_webgl2 when the browser exposes it. GPU time is
 * the honest number: FPS is capped by vsync and hides how much headroom
 * is left.
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
  private gl: WebGL2RenderingContext | null
  private timerExt: any = null
  private pendingQueries: WebGLQuery[] = []
  private activeQuery: WebGLQuery | null = null

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

  constructor(private renderer: THREE.WebGLRenderer, private quality: string) {
    // Count every render() the composer issues per frame, reset manually.
    renderer.info.autoReset = false

    const ctx = renderer.getContext()
    this.gl = typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext ? ctx : null
    if (this.gl) this.timerExt = this.gl.getExtension('EXT_disjoint_timer_query_webgl2')

    this.el = document.createElement('div')
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

  /** Call right before the composer renders. */
  gpuBegin() {
    this.renderer.info.reset()
    this.pollQueries()
    const gl = this.gl
    if (gl && this.timerExt && !this.activeQuery) {
      const q = gl.createQuery()
      if (q) {
        gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, q)
        this.activeQuery = q
      }
    }
  }

  /** Call right after the composer renders. */
  frameEnd() {
    const gl = this.gl
    if (gl && this.timerExt && this.activeQuery) {
      gl.endQuery(this.timerExt.TIME_ELAPSED_EXT)
      this.pendingQueries.push(this.activeQuery)
      this.activeQuery = null
    }

    const info = this.renderer.info
    this.callsMax = Math.max(this.callsMax, info.render.calls)
    this.trisMax = Math.max(this.trisMax, info.render.triangles)
    this.cpuMsSum += performance.now() - this.frameStartMs
    this.frames++

    const now = performance.now()
    if (now - this.windowStart >= SAMPLE_WINDOW_MS) this.flush(now)
  }

  /** Collect finished GPU timer queries (results arrive a few frames late). */
  private pollQueries() {
    const gl = this.gl
    if (!gl || !this.timerExt) return
    const disjoint = gl.getParameter(this.timerExt.GPU_DISJOINT_EXT)
    while (this.pendingQueries.length > 0) {
      const q = this.pendingQueries[0]
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number
      if (!disjoint) {
        this.gpuMsSum += ns / 1e6
        this.gpuSamples++
      }
      gl.deleteQuery(q)
      this.pendingQueries.shift()
    }
    // Never let a stalled driver grow the queue unbounded
    while (this.pendingQueries.length > 8) gl.deleteQuery(this.pendingQueries.shift()!)
  }

  private flush(now: number) {
    const n = Math.max(1, this.frames)
    const interval = this.intervalMsSum / n
    const info = this.renderer.info
    const gpu = !this.timerExt
      ? 'n/a (no timer ext)'
      : this.gpuSamples > 0 ? `${(this.gpuMsSum / this.gpuSamples).toFixed(2)} ms` : '…'
    const pr = this.renderer.getPixelRatio()
    const w = Math.round(window.innerWidth * pr)
    const h = Math.round(window.innerHeight * pr)

    this.el.textContent =
      `gfx       ${this.quality}  ${w}x${h} @${pr.toFixed(2)}x\n` +
      `fps       ${interval > 0 ? (1000 / interval).toFixed(0) : '—'}  (${interval.toFixed(2)} ms/frame)\n` +
      `gpu       ${gpu}\n` +
      `cpu       ${(this.cpuMsSum / n).toFixed(2)} ms  (scene.render)\n` +
      `calls     ${this.callsMax}\n` +
      `tris      ${(this.trisMax / 1000).toFixed(1)}k\n` +
      `geo/tex   ${info.memory.geometries} / ${info.memory.textures}\n` +
      `programs  ${info.programs?.length ?? 0}`

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
    const gl = this.gl
    if (gl) {
      if (this.activeQuery) gl.deleteQuery(this.activeQuery)
      for (const q of this.pendingQueries) gl.deleteQuery(q)
    }
    this.pendingQueries = []
    this.renderer.info.autoReset = true
    this.el.remove()
  }
}
