/**
 * Graphics backend layer — WebGPU-first, with the WebGL 2 fallback built into
 * three's `WebGPURenderer` backend selection.
 *
 * Why this module exists:
 *  - The renderer is a real `WebGPURenderer` (three/webgpu): WebGPU when the
 *    browser exposes an adapter, WebGL 2 otherwise. `?gpu=webgpu|webgl`
 *    forces one; the choice persists in localStorage.
 *  - Post-processing is the node pipeline (`PostProcessing` + `pass()` +
 *    TSL bloom / GTAO). All work is submitted exactly once per frame from the
 *    awaited engine loop — no fire-and-forget render promises, which is what
 *    previously caused frame lag with this stack.
 *  - GPU frame time is measured per frame (WebGPU timestamp queries, WebGL2
 *    timer queries) and drives an adaptive render scale so weak GPUs (or
 *    heavier scenes) trade resolution instead of dropping frames.
 *
 * Quality presets (`?gfx=low|medium|high`) scale MSAA, shadow resolution,
 * post effects and the maximum pixel ratio.
 */

import * as THREE from 'three/webgpu'
import { float, mix, mrt, normalView, output, pass } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'

export type GfxQuality = 'low' | 'medium' | 'high'
export type BackendKind = 'webgpu' | 'webgl2'

export interface GfxPreset {
  /** Upper bound on devicePixelRatio (before adaptive scaling). */
  maxPixelRatio: number
  /** MSAA samples on the scene pass render target (0 = off). */
  msaa: number
  /** Sun shadow map resolution. */
  shadowMap: number
  /** Ground-truth ambient occlusion node (high only: it re-samples depth). */
  gtao: boolean
  /** TSL bloom on emissive/lit highlights. */
  bloom: boolean
}

export const GFX_PRESETS: Record<GfxQuality, GfxPreset> = {
  low: { maxPixelRatio: 1, msaa: 0, shadowMap: 1024, gtao: false, bloom: false },
  medium: { maxPixelRatio: 1, msaa: 4, shadowMap: 2048, gtao: false, bloom: true },
  high: { maxPixelRatio: 1.5, msaa: 4, shadowMap: 2048, gtao: true, bloom: true }
}

export function getGfxQuality(): GfxQuality {
  const isQ = (v: unknown): v is GfxQuality => v === 'low' || v === 'medium' || v === 'high'
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('gfx')
    if (isQ(fromUrl)) {
      localStorage.setItem('ltown_gfx', fromUrl)
      return fromUrl
    }
    const stored = localStorage.getItem('ltown_gfx')
    if (isQ(stored)) return stored
  } catch { /* storage unavailable */ }
  return 'medium'
}

/** `?gpu=webgpu|webgl` (persisted); null = auto-detect. */
function forcedBackend(): 'webgpu' | 'webgl' | null {
  const isB = (v: unknown): v is 'webgpu' | 'webgl' => v === 'webgpu' || v === 'webgl'
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('gpu')
    if (isB(fromUrl)) {
      localStorage.setItem('ltown_gpu', fromUrl)
      return fromUrl
    }
    const stored = localStorage.getItem('ltown_gpu')
    if (isB(stored)) return stored
  } catch { /* storage unavailable */ }
  return null
}

/** `?dyn=0` disables adaptive resolution; persisted. */
function dynamicResolutionEnabled(): boolean {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('dyn')
    if (fromUrl === '0' || fromUrl === '1') {
      localStorage.setItem('ltown_dyn', fromUrl)
      return fromUrl === '1'
    }
    const stored = localStorage.getItem('ltown_dyn')
    if (stored === '0') return false
  } catch { /* storage unavailable */ }
  return true
}

/** True when the browser can actually hand out a WebGPU adapter. */
async function probeWebGPU(timeoutMs = 2500): Promise<boolean> {
  const gpu = (navigator as any).gpu
  if (!gpu?.requestAdapter) return false
  try {
    const adapter = await Promise.race([
      gpu.requestAdapter({ powerPreference: 'high-performance' }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ])
    return !!adapter
  } catch {
    return false
  }
}

export interface Gfx {
  readonly kind: BackendKind
  readonly renderer: THREE.WebGPURenderer
  readonly preset: GfxPreset
  readonly quality: GfxQuality
  /** Adaptive render-scale multiplier on top of the preset pixel ratio (1 = none). */
  readonly renderScale: number
  /** GPU frame time of a recent frame in ms, or null when not measurable. */
  readonly gpuTimeMs: number | null
  /** Backing-store size in device pixels (what the overlay should report). */
  readonly drawWidth: number
  readonly drawHeight: number
  /** Effective pixel ratio (devicePixelRatio clamped to preset × renderScale). */
  readonly pixelRatio: number
  /** Renders the post stack. Call exactly once per frame. */
  renderFrame(dtSeconds: number): void
  setSize(width: number, height: number): void
  getMaxAnisotropy(): number
  dispose(): void
}

const RENDER_SCALE_MIN = 0.55
const RENDER_SCALE_STEP_DOWN = 0.1
const RENDER_SCALE_STEP_UP = 0.05
/** Sustained over/under budget windows (frames) before acting. */
const OVER_LIMIT = 4
const UNDER_LIMIT = 12
/** Minimum time between scale changes (ms). */
const SCALE_COOLDOWN_MS = 800
/** Warm-up: shader compilation spikes at match start must not trip the scaler. */
const SCALE_WARMUP_MS = 2500

export async function createGfx(
  canvas: HTMLCanvasElement,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera
): Promise<Gfx> {
  const quality = getGfxQuality()
  const preset = GFX_PRESETS[quality]
  const force = forcedBackend()
  const wantWebGPU = force === 'webgl' ? false : await probeWebGPU()
  if (force === 'webgpu' && !wantWebGPU) {
    console.warn('[gfx] ?gpu=webgpu requested but no WebGPU adapter is available — using WebGL 2.')
  }
  const adaptive = dynamicResolutionEnabled()

  // `trackTimestamp` enables per-frame GPU timing (WebGPU timestamp queries,
  // WebGL2 EXT_disjoint_timer_query) — the adaptive scaler and the ?debug=1
  // overlay both read it. It is cheap enough to leave on by default.
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    forceWebGL: !wantWebGPU,
    trackTimestamp: true
  })
  await renderer.init()

  const kind: BackendKind = (renderer.backend as any).isWebGPUBackend === true ? 'webgpu' : 'webgl2'
  console.info(`[gfx] backend: ${kind}${kind === 'webgl2' && !wantWebGPU && force !== 'webgl' ? ' (no WebGPU adapter — automatic fallback)' : ''}`)

  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = THREE.SRGBColorSpace

  // ---- Post stack -----------------------------------------------------
  // scene pass -> [GTAO] -> [bloom] -> tonemap/sRGB output. The pass RT is
  // HDR (half float) and multisampled per preset; `outputColorTransform`
  // applies the renderer's tone mapping + color space on the final blit.
  const post = new THREE.PostProcessing(renderer)
  const scenePass = pass(scene, camera, { samples: preset.msaa })
  if (preset.gtao) {
    scenePass.setMRT(mrt({ output: output, normal: normalView }))
  }
  const sceneColor: any = scenePass.getTextureNode('output')
  let outputNode: any = sceneColor

  if (preset.gtao) {
    const aoNode: any = ao(scenePass.getTextureNode('depth'), scenePass.getTextureNode('normal'), camera)
    aoNode.radius.value = 0.72
    aoNode.thickness.value = 1
    aoNode.distanceExponent.value = 1
    aoNode.samples.value = 8
    // Half-resolution AO: the documented sweet spot, ~4x cheaper than full.
    aoNode.resolutionScale = 0.5
    // Match the old GTAOPass blend intensity of 0.72:
    // color * (0.28 + 0.72 * ao)
    const aoMix: any = mix(float(1), aoNode.getTextureNode().r, float(0.72))
    outputNode = sceneColor.mul(aoMix)
  }

  if (preset.bloom) {
    const bloomNode: any = bloom(outputNode, 0.32, 0.52, 1.05)
    outputNode = outputNode.add(bloomNode)
  }

  post.outputNode = outputNode
  post.needsUpdate = true

  // ---- Sizing + adaptive render scale ---------------------------------
  let scale = 1
  let width = window.innerWidth
  let height = window.innerHeight
  let pixelRatio = Math.min(window.devicePixelRatio, preset.maxPixelRatio)

  const applySize = () => {
    pixelRatio = Math.min(window.devicePixelRatio, preset.maxPixelRatio) * scale
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height)
  }
  applySize()

  // ---- GPU timing ------------------------------------------------------
  let gpuTimeMs: number | null = null
  let timestampsAlive = true
  let resolveInFlight = false

  const resolveTimestamp = () => {
    if (!timestampsAlive || resolveInFlight) return
    resolveInFlight = true
    ;(renderer as any)
      .resolveTimestampsAsync('render')
      .then((duration: unknown) => {
        const ms = typeof duration === 'number' && duration > 0
          ? duration
          : (renderer.info.render as any).timestamp
        if (typeof ms === 'number' && ms > 0 && ms < 1000) gpuTimeMs = ms
      })
      .catch(() => { timestampsAlive = false })
      .finally(() => { resolveInFlight = false })
  }

  // ---- Adaptive scale controller ---------------------------------------
  // Decisions are per-frame flags with hysteresis so a single spike (shader
  // compile, GC, tab focus) never moves the scale. The load signal is
  // `gpuTimeMs` only: a vsync-locked frame interval says nothing about
  // headroom, and without a real signal a transient hitch would degrade
  // quality permanently (frame-interval scaling has no way back up).
  let over = 0
  let under = 0
  let lastChange = performance.now()
  const warmupUntil = performance.now() + SCALE_WARMUP_MS
  // Smoothed frame interval — only used to infer the display's refresh period
  // (the GPU-time budget is a fraction of it; at 120 Hz the budget is half).
  let intervalEma = 16.7

  const tickAdaptive = (nowMs: number) => {
    if (!adaptive || gpuTimeMs === null) return
    const refresh = Math.min(16.7, Math.max(6.9, intervalEma))
    const budget = refresh * 0.72
    const isOver = gpuTimeMs > budget
    const isUnder = gpuTimeMs < budget * 0.6
    if (isOver) { over++; under = 0 } else if (isUnder) { under++; over = 0 } else { over = 0; under = 0 }

    if (nowMs < warmupUntil || nowMs - lastChange < SCALE_COOLDOWN_MS) return
    if (over >= OVER_LIMIT && scale > RENDER_SCALE_MIN) {
      scale = Math.max(RENDER_SCALE_MIN, scale - RENDER_SCALE_STEP_DOWN)
      over = 0
      lastChange = nowMs
      applySize()
      console.info(`[gfx] render scale ${scale.toFixed(2)}x (gpu ${gpuTimeMs.toFixed(1)}ms > ${budget.toFixed(1)}ms budget)`)
    } else if (under >= UNDER_LIMIT && scale < 1) {
      scale = Math.min(1, scale + RENDER_SCALE_STEP_UP)
      under = 0
      lastChange = nowMs
      applySize()
      console.info(`[gfx] render scale ${scale.toFixed(2)}x (headroom)`)
    }
  }

  const gfx: Gfx = {
    kind,
    renderer,
    preset,
    quality,
    get renderScale() { return scale },
    get gpuTimeMs() { return gpuTimeMs },
    get drawWidth() { return Math.round(width * pixelRatio) },
    get drawHeight() { return Math.round(height * pixelRatio) },
    get pixelRatio() { return pixelRatio },
    renderFrame(dtSeconds: number) {
      intervalEma = intervalEma * 0.9 + Math.min(200, dtSeconds * 1000) * 0.1
      post.render()
      resolveTimestamp()
      tickAdaptive(performance.now())
    },
    setSize(w: number, h: number) {
      width = w
      height = h
      applySize()
    },
    getMaxAnisotropy() {
      try {
        return Math.min(8, renderer.getMaxAnisotropy())
      } catch {
        return 8
      }
    },
    dispose() {
      post.dispose()
      renderer.dispose()
    }
  }
  return gfx
}
