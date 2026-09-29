export interface Box {
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  type: string
  biome: string
}

export interface Spawn {
  x: number
  y: number
  z: number
}

export interface Poi {
  name: string
  x: number
  z: number
}

export interface MapData {
  floor: { w: number; d: number }
  boxes: Box[]
  spawns: Spawn[]
  pois: Poi[]
  seed: number
}

/**
 * MERIDIAN PRIME — static competitive arena (v2).
 *
 * One frozen, hand-balanced map so players learn angles, callouts and
 * jump-pad routes (Apex/Farlight style). Playable area is 300x300, ground
 * stays flat (y=0) — height gameplay comes from climbable mesas and
 * overlook decks (no terrain deformation, so bots, physics and hitscan
 * all stay exact). Unstable wormholes link random map points mid-match.
 */
export const STATIC_MAP_ID = 'meridian-prime-v2'
/** Kept on MapData / welcome protocol so old clients stay compatible. */
export const STATIC_MAP_SEED = 3049
export const MAP_SIZE = 300

/** Flat arena — pure constant so mesh, physics and spawns always agree. */
export function groundHeight(_x: number, _z: number, _seed?: number): number {
  return 0
}

export function getStaticMap(): MapData {
  const boxes: Box[] = []
  const spawns: Spawn[] = []
  const SIZE = MAP_SIZE
  const HALF = SIZE / 2

  function box(
    x: number, y: number, z: number,
    w: number, h: number, d: number,
    type = 'cover', biome = 'neutral'
  ) {
    boxes.push({ x, y, z, w, h, d, type, biome })
  }

  /** Mirror a box across both axes for symmetric fair fights. */
  function quad(
    x: number, y: number, z: number,
    w: number, h: number, d: number,
    type = 'cover', biome = 'neutral'
  ) {
    box(x, y, z, w, h, d, type, biome)
    box(-x, y, z, w, h, d, type, biome)
    box(x, y, -z, w, h, d, type, biome)
    box(-x, y, -z, w, h, d, type, biome)
  }

  // ── Perimeter boundary walls ──────────────────────────────
  const wH = 12, wT = 2
  box(0, 3, -HALF, SIZE, wH + 6, wT, 'wall', 'neutral')
  box(0, 3, HALF, SIZE, wH + 6, wT, 'wall', 'neutral')
  box(-HALF, 3, 0, wT, wH + 6, SIZE, 'wall', 'neutral')
  box(HALF, 3, 0, wT, wH + 6, SIZE, 'wall', 'neutral')

  // ── 5-floor Central Meridian Hub ──────────────────────────
  const FLOORS = 5
  const FH = 3.8
  const BLDG_H = FLOORS * FH
  box(0, BLDG_H / 2, 0, 20, BLDG_H, 15, 'house_body', 'neutral')
  box(0, BLDG_H / 2, 7.6, 16, BLDG_H, 0.4, 'house_window', 'neutral')
  box(0, BLDG_H / 2, -7.6, 16, BLDG_H, 0.4, 'house_window', 'neutral')
  for (let f = 0; f < FLOORS; f++) {
    const wy = (f + 0.55) * FH
    box(-10.2, wy, -1, 0.3, FH * 0.58, 5.5, 'house_window', 'neutral')
    box(-10.2, wy, 5, 0.3, FH * 0.58, 4.0, 'house_window', 'neutral')
    box(10.2, wy, -1, 0.3, FH * 0.58, 5.5, 'house_window', 'neutral')
    box(10.2, wy, 5, 0.3, FH * 0.58, 4.0, 'house_window', 'neutral')
  }
  for (let f = 1; f <= FLOORS; f++) {
    box(0, f * FH, 0, 21, 0.35, 16, 'platform', 'neutral')
  }
  box(0, BLDG_H + 0.65, 0, 22, 1.3, 17, 'wall', 'neutral')
  box(-5, BLDG_H + 1.6, -1, 5, 1.8, 3.5, 'cover', 'neutral')
  box(5, BLDG_H + 1.6, -1, 5, 1.8, 3.5, 'cover', 'neutral')
  box(0, BLDG_H + 1.3, 4, 3, 1.4, 2.5, 'house_chimney', 'neutral')

  // ── Entrance & plaza platforms ───────────────────────────
  box(0, 0.05, 10.5, 16, 0.1, 5, 'path', 'neutral')
  box(0, FH - 0.1, 10.8, 16, 0.35, 4.8, 'platform', 'neutral')
  box(-3.2, FH * 0.42, 7.7, 3.0, FH * 0.78, 0.3, 'house_door', 'neutral')
  box(3.2, FH * 0.42, 7.7, 3.0, FH * 0.78, 0.3, 'house_door', 'neutral')
  for (const px of [-5.5, 0, 5.5]) {
    box(px, FH / 2, 13, 0.7, FH, 0.7, 'pillar', 'neutral')
  }
  box(0, 0.3, -11, 16, 0.6, 7, 'platform', 'neutral')
  box(-9, 0.45, 11, 4, 0.9, 2.5, 'garden', 'neutral')
  box(9, 0.45, 11, 4, 0.9, 2.5, 'garden', 'neutral')

  // ── Courtyard fortifications (N/S/E/W gates) ─────────────
  const BH = 22, WT = 2, WH = 14, DW = 4, DH = 5
  box(-13, WH / 2, -BH, 18, WH, WT, 'building', 'neutral')
  box(13, WH / 2, -BH, 18, WH, WT, 'building', 'neutral')
  box(0, DH + (WH - DH) / 2, -BH, DW * 2, WH - DH, WT, 'building', 'neutral')
  box(-13, WH / 2, BH, 18, WH, WT, 'building', 'neutral')
  box(13, WH / 2, BH, 18, WH, WT, 'building', 'neutral')
  box(0, DH + (WH - DH) / 2, BH, DW * 2, WH - DH, WT, 'building', 'neutral')
  box(BH, WH / 2, -13, WT, WH, 18, 'building', 'neutral')
  box(BH, WH / 2, 13, WT, WH, 18, 'building', 'neutral')
  box(BH, DH + (WH - DH) / 2, 0, WT, WH - DH, DW * 2, 'building', 'neutral')
  box(-BH, WH / 2, -13, WT, WH, 18, 'building', 'neutral')
  box(-BH, WH / 2, 13, WT, WH, 18, 'building', 'neutral')
  box(-BH, DH + (WH - DH) / 2, 0, WT, WH - DH, DW * 2, 'building', 'neutral')
  // Corner towers
  quad(BH, WH / 2, BH, 4, WH, 4, 'building', 'neutral')
  // Sky-ring walkway: 4 deck segments linking the corner towers (tops flush
  // at y=14). Replaces the old solid 46x46 slab, which cut through the Hub,
  // shadowed all of mid and blocked jump-pad flight arcs crossing center.
  // Pad/portal access only — same verticality language as the sniper nests.
  box(0, 13.75, -22, 40, 0.5, 3, 'platform', 'neutral')
  box(0, 13.75, 22, 40, 0.5, 3, 'platform', 'neutral')
  box(22, 13.75, 0, 3, 0.5, 40, 'platform', 'neutral')
  box(-22, 13.75, 0, 3, 0.5, 40, 'platform', 'neutral')
  // Outer railings (crouch-height cover, sightline over the top standing)
  box(0, 14.6, -23.4, 40, 1.2, 0.3, 'cover', 'neutral')
  box(0, 14.6, 23.4, 40, 1.2, 0.3, 'cover', 'neutral')
  box(23.4, 14.6, 0, 0.3, 1.2, 40, 'cover', 'neutral')
  box(-23.4, 14.6, 0, 0.3, 1.2, 40, 'cover', 'neutral')
  quad(14, WH / 2, 14, 2.5, WH, 2.5, 'pillar', 'neutral')

  // ── Central tactical cover ───────────────────────────────
  box(8, 1, -8, 4, 2, 3, 'cover', 'neutral')
  box(-8, 1, 8, 3, 2, 4, 'cover', 'neutral')
  box(-8, 1, -8, 3, 2, 3, 'cover', 'neutral')
  box(8, 1, 8, 4, 2, 4, 'cover', 'neutral')
  box(0, 7.5, -15, 36, 1, 12, 'platform', 'neutral')
  box(0, 9.5, -9, 36, 2, 1, 'cover', 'neutral')
  // Mirrored south deck + wall (pad-to-deck route over the fountain plaza,
  // symmetric with the north side)
  box(0, 7.5, 15, 36, 1, 12, 'platform', 'neutral')
  box(0, 9.5, 9, 36, 2, 1, 'cover', 'neutral')
  box(16, 1.5, 0, 4, 3, 4, 'cover', 'neutral')
  box(16, 3.5, -5, 4, 3, 4, 'cover', 'neutral')
  box(16, 7, -11, 4, 2, 4, 'cover', 'neutral')
  // Mirrored west stack (fair fights on both flanks)
  box(-16, 1.5, 0, 4, 3, 4, 'cover', 'neutral')
  box(-16, 3.5, -5, 4, 3, 4, 'cover', 'neutral')
  box(-16, 7, -11, 4, 2, 4, 'cover', 'neutral')

  // ── North/South avenues ──────────────────────────────────
  box(0, 0.05, 45, 6.5, 0.1, 70, 'path', 'neutral')
  box(0, 0.05, -45, 6.5, 0.1, 70, 'path', 'neutral')
  // Mid-avenue blockers break the 70m sniper lanes (spawns at ±65 keep cover)
  box(0, 1, 48, 4, 2, 2, 'cover', 'terra')
  box(0, 1, -48, 4, 2, 2, 'cover', 'barren')
  for (let pz = 17; pz < 82; pz += 5) box(0, 0.1, pz, 0.28, 0.015, 2.2, 'road_marking', 'neutral')
  for (let pz = -17; pz > -82; pz -= 5) box(0, 0.1, pz, 0.28, 0.015, 2.2, 'road_marking', 'neutral')
  for (const side of [-1, 1]) {
    box(side * 3.6, 0.12, 45, 0.5, 0.24, 70, 'platform', 'neutral')
    box(side * 3.6, 0.12, -45, 0.5, 0.24, 70, 'platform', 'neutral')
  }

  // ── Streetlamps & bollards ───────────────────────────────
  for (const [lx, lz, arm] of [
    [-4, 30, 1], [4, 30, -1], [-4, 57, 1], [4, 57, -1],
    [-4, -30, 1], [4, -30, -1], [-4, -57, 1], [4, -57, -1]
  ] as const) {
    box(lx, 5.1, lz, 0.28, 10.2, 0.28, 'lamp_post', 'neutral')
    box(lx + arm * 1.3, 9.75, lz, 2.6, 0.22, 0.22, 'lamp_post', 'neutral')
    box(lx + arm * 2.5, 9.48, lz, 0.9, 0.45, 0.70, 'lamp_head', 'neutral')
  }
  for (const pz of [22, 32, 42, 52, 62, 72, -22, -32, -42, -52, -62, -72] as const) {
    box(-4.6, 0.55, pz, 0.38, 1.1, 0.38, 'bollard', 'neutral')
    box(4.6, 0.55, pz, 0.38, 1.1, 0.38, 'bollard', 'neutral')
  }

  // ── Plaza fountain & benches ─────────────────────────────
  box(0, 0.5, 17, 8, 1, 8, 'fountain_base', 'neutral')
  box(0, 1.2, 17, 6, 0.4, 6, 'fountain_rim', 'neutral')
  box(0, 1.5, 17, 1.5, 3, 1.5, 'fountain_pillar', 'neutral')
  for (const [bx, bz, bw, bd] of [
    [-12, 17, 5, 1.5], [12, 17, 5, 1.5], [-12, -17, 5, 1.5], [12, -17, 5, 1.5]
  ] as const) {
    box(bx, 0.6, bz, bw, 1.2, bd, 'bench', 'neutral')
    box(bx, 1.5, bz - bd * 0.3, bw, 1.5, 0.3, 'bench', 'neutral')
  }

  // ══ STATIC OUTER ARENA (replaces procedural scatter) ══
  // Four quadrant outposts — U-shaped compounds open toward center.
  // Each: back wall + 2 side walls + center crate. Biomes alternate
  // for terra/barren material variety.
  const OUTPOSTS = [
    { cx: 55, cz: 55, biome: 'terra', name: 'Relay Outpost' },
    { cx: -55, cz: 55, biome: 'barren', name: 'Quarry Outpost' },
    { cx: 55, cz: -55, biome: 'terra', name: 'Garden Outpost' },
    { cx: -55, cz: -55, biome: 'barren', name: 'Docks Outpost' }
  ] as const
  for (const o of OUTPOSTS) {
    // Back wall (faces away from center)
    const sx = Math.sign(o.cx), sz = Math.sign(o.cz)
    box(o.cx, 3, o.cz + sz * 6, 15, 6, 1.5, 'building', o.biome)
    // Side walls
    box(o.cx - sx * 7, 3, o.cz, 1.5, 6, 12, 'building', o.biome)
    box(o.cx + sx * 7, 3, o.cz, 1.5, 6, 12, 'building', o.biome)
    // Center crate + flanking low cover
    box(o.cx, 1, o.cz, 3.5, 2, 3.5, 'cover', o.biome)
    box(o.cx - sx * 4, 0.7, o.cz - sz * 3, 2.5, 1.4, 2.5, 'cover', o.biome)
    box(o.cx + sx * 4, 0.7, o.cz - sz * 3, 2.5, 1.4, 2.5, 'cover', o.biome)
    // Overlook platform on the back wall
    box(o.cx, 6.6, o.cz + sz * 6, 15, 0.6, 3, 'platform', o.biome)
  }

  // Avenue gates at (0,±80) — side pylons + split center block (gate gap).
  for (const sz of [1, -1]) {
    const gz = sz * 80
    const biome = sz > 0 ? 'terra' : 'barren'
    box(-5.5, 4, gz, 3, 8, 3, 'pillar', biome)
    box(5.5, 4, gz, 3, 8, 3, 'pillar', biome)
    box(-9, 1.25, gz, 5, 2.5, 4, 'cover', biome)
    box(9, 1.25, gz, 5, 2.5, 4, 'cover', biome)
    box(0, 8.6, gz, 14, 0.6, 4, 'platform', biome)
  }

  // Ridge gates at (±80,0) — mirrored, rotated 90°.
  for (const sx of [1, -1]) {
    const gx = sx * 80
    const biome = sx > 0 ? 'terra' : 'barren'
    box(gx, 4, -5.5, 3, 8, 3, 'pillar', biome)
    box(gx, 4, 5.5, 3, 8, 3, 'pillar', biome)
    box(gx, 1.25, -9, 4, 2.5, 5, 'cover', biome)
    box(gx, 1.25, 9, 4, 2.5, 5, 'cover', biome)
    box(gx, 8.6, 0, 4, 0.6, 14, 'platform', biome)
  }

  // Corner sniper nests (±95,±95) — pillar + high platform (jump-pad access).
  quad(95, 6, 95, 2.5, 12, 2.5, 'pillar', 'neutral')
  quad(95, 12.3, 95, 10, 0.6, 10, 'platform', 'neutral')
  quad(95, 13.3, 91.5, 10, 1.4, 0.4, 'cover', 'neutral')

  // ── Mesa mounds (stepped rock, climbable by jumping tier to tier) ──
  // Tier tops at y=2 / 4 / 5.5. Rock texture reads as natural height.
  const MESAS = [
    { x: 48, z: 78, biome: 'terra', name: 'Ember Mesa' },
    { x: -48, z: -78, biome: 'barren', name: 'Ash Mesa' },
    { x: 78, z: -48, biome: 'terra', name: 'Cinder Mesa' },
    { x: -78, z: 48, biome: 'barren', name: 'Slate Mesa' }
  ] as const
  for (const m of MESAS) {
    box(m.x, 1, m.z, 18, 2, 18, 'cover', m.biome)
    box(m.x, 3, m.z, 12, 2, 12, 'cover', m.biome)
    box(m.x, 4.75, m.z, 7, 1.5, 7, 'cover', m.biome)
  }

  // ── Overlook decks (jump-up sniper perches, deck top y=4.2) ──
  const DECKS = [[20, 40], [-20, 40], [20, -40], [-20, -40]] as const
  for (const [dx, dz] of DECKS) {
    box(dx, 1, dz, 4, 2, 4, 'cover', 'neutral')
    box(dx, 4.0, dz, 6, 0.4, 6, 'platform', 'neutral')
  }

  // Diagonal lane covers — mirrored crates breaking up long sightlines.
  // Kept ≥4m clear of every jump-pad node and spawn point.
  quad(35, 1, 48, 4, 2, 3, 'cover', 'terra')
  quad(48, 1, 35, 3, 2, 4, 'cover', 'terra')
  quad(35, 1, -48, 4, 2, 3, 'cover', 'barren')
  quad(48, 1, -35, 3, 2, 4, 'cover', 'barren')
  quad(70, 0.9, 20, 3, 1.8, 3, 'cover', 'neutral')
  quad(20, 0.9, 70, 3, 1.8, 3, 'cover', 'neutral')
  quad(70, 0.9, -20, 3, 1.8, 3, 'cover', 'neutral')
  quad(20, 0.9, -70, 3, 1.8, 3, 'cover', 'neutral')

  // Far-strip lane covers for the expanded 300m arena.
  quad(35, 1, 120, 4, 2, 3, 'cover', 'terra')
  quad(90, 1, 120, 3, 2, 4, 'cover', 'terra')
  quad(35, 1, -120, 4, 2, 3, 'cover', 'barren')
  quad(90, 1, -120, 3, 2, 4, 'cover', 'barren')

  // ── Balanced fixed spawns (20, mirrored, hand-cleared) ───
  const SPAWN_Y = 1.6
  const spawnList: Array<[number, number]> = [
    [0, 95], [0, -95],
    [0, 65], [0, -65],
    [95, 0], [-95, 0],
    [62, 0], [-62, 0],
    [35, 35], [-35, 35],
    [35, -35], [-35, -35],
    [88, 88], [-88, 88],
    [88, -88], [-88, -88],
    [0, 130], [0, -130],
    [65, 125], [-65, -125]
  ]
  for (const [x, z] of spawnList) {
    spawns.push({ x, y: SPAWN_Y, z })
  }

  const pois: Poi[] = [
    { name: 'Meridian Hub', x: 0, z: 0 },
    { name: 'Fountain Plaza', x: 0, z: 17 },
    { name: 'North Ring', x: 0, z: -22 },
    { name: 'South Ring', x: 0, z: 22 },
    { name: 'East Ring', x: 22, z: 0 },
    { name: 'West Ring', x: -22, z: 0 },
    { name: 'North Gate', x: 0, z: 80 },
    { name: 'South Gate', x: 0, z: -80 },
    { name: 'East Ridge', x: 80, z: 0 },
    { name: 'West Ridge', x: -80, z: 0 },
    { name: 'Relay Outpost', x: 55, z: 55 },
    { name: 'Quarry Outpost', x: -55, z: 55 },
    { name: 'Garden Outpost', x: 55, z: -55 },
    { name: 'Docks Outpost', x: -55, z: -55 },
    { name: 'NE Nest', x: 95, z: 95 },
    { name: 'NW Nest', x: -95, z: 95 },
    { name: 'SE Nest', x: 95, z: -95 },
    { name: 'SW Nest', x: -95, z: -95 },
    { name: 'Ember Mesa', x: 48, z: 78 },
    { name: 'Ash Mesa', x: -48, z: -78 },
    { name: 'Cinder Mesa', x: 78, z: -48 },
    { name: 'Slate Mesa', x: -78, z: 48 }
  ]

  return { floor: { w: SIZE, d: SIZE }, boxes, spawns, pois, seed: STATIC_MAP_SEED }
}

/**
 * Deterministic entry point. The seed argument is ignored (kept so callers
 * like GameEngine / PeerJSHost don't change) — everyone gets Meridian Prime.
 */
export function generateMap(_seed?: number): MapData {
  return getStaticMap()
}
