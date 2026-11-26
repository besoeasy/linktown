// 3049 Remote Age — Canon specifications from lore.md & commit e392b58b6b4981ece32cff242cbda5a07fceb0f4
import { MAP_SIZE } from './map'

// Movement scales linearly with arena size so full-map traversal time stays
// constant (~20s edge-to-edge at run speed). Reference tuning was done at
// 300x300 (15 u/s run, 9 u/s walk); changing MAP_SIZE in map.ts rescales both.
const REFERENCE_MAP_SIZE = 300
const REFERENCE_RUN_SPEED = 15   // units/sec sprint at reference size
const REFERENCE_WALK_SPEED = 9   // units/sec base walk at reference size
const speedScale = MAP_SIZE / REFERENCE_MAP_SIZE
const round1 = (n: number) => Math.round(n * 10) / 10

export const CFG = {
  TICK_MS: 50,              // 20 Hz simulation
  MATCH_DURATION: 600,      // 10 minutes (seconds)
  MAX_PLAYERS: 16,          // WebRTC P2P mesh room limit
  VIS_RADIUS: 120,          // Distance culling limit
  PLAYER_SPEED: round1(REFERENCE_WALK_SPEED * speedScale), // units/sec base walk, scaled to map
  RUN_SPEED: round1(REFERENCE_RUN_SPEED * speedScale),     // units/sec sprint, scaled to map
  CROUCH_SPEED: 0,          // units/sec while crouched (stationary lock)
  PLAYER_RADIUS: 0.45,
  PLAYER_HEIGHT: 2.3,
  EYE_HEIGHT: 1.95,
  CROUCH_EYE_HEIGHT: 0.85,
  AUTO_CROUCH_MS: 5000,     // Auto-crouch after 5s of no movement
  MAX_HEALTH: 500,          // Hull = nanite census (lore.md:23)
  REGEN_DELAY: 3000,        // Calm period (no damage taken, no hull spent) before hull rebuild starts
  REGEN_RATE: 4,            // Hull rebuilt per second once the calm period completes
  SHOT_COST_SINGLE: 3,      // Nanite mass spent per single shot
  FIRE_INTERVAL_MS: 100,    // Min gap between shots (10 shots/sec max)
  CHARGE_MAX: 4,            // Max charge shot bursts
  SUPER_COST: 50,           // Nanite mass spent to trigger Super overclock
  SUPER_DURATION: 10000,    // 10s Super duration
  RESPAWN_DELAY: 7000,      // 7s reprint delay
  NANITE_CACHE_AMOUNT: 100, // Nanite cache dropped on death
  NANITE_CACHE_RADIUS: 5.0, // Pickup radius in world units
  NANITE_CACHE_LIFETIME: 25000, // Caches decay after 25s to limit snowballing
  JUMP_PAD_COUNT: 6,        // Maximum concurrent active dynamic jump pads
  JUMP_PAD_LIFETIME: 28,    // Active duration in seconds before cycling
  JUMP_PAD_WARNING_TIME: 5, // Warning flicker phase in seconds before despawn
  JUMP_PAD_RADIUS: 2.2,     // Step-on activation radius in world units
  JUMP_PAD_COOLDOWN_MS: 1200,// Anti-retrigger cooldown per entity (ms)
  JUMP_PAD_LAUNCH_VY: 44,   // Vertical launch velocity (clears ~30u height)
  JUMP_PAD_MOMENTUM_BOOST: 1.5, // Airborne speed multiplier after a pad launch
  PORTAL_ROLL_MS: 10000,    // Roll for a portal spawn this often
  PORTAL_CHANCE: 0.5,       // Chance per roll (only when none active)
  PORTAL_LIFETIME: 10,      // Seconds a portal pair stays open
  PORTAL_RADIUS: 2.5,       // Step-in trigger radius at each mouth
  JUMP_SPEED: 18,           // Base vertical jump velocity
  GRAVITY: 32,              // Gravity units/sec^2
  SUPER_JUMP_SPEED: 44,     // High jump velocity (~10x height)
  SUPER_JUMP_COST: 20,      // Nanite mass spent per Super Jump
  DMG_SINGLE: 20,           // Base hitscan damage
  SUPER_MULT: 3,            // 3x damage multiplier while Super is active
  SHIELD_COST: 80,          // Nanite mass spent to deploy shield
  SHIELD_DURATION: 10000,   // 10s damage immunity
  RECONNECT_GRACE_MS: 15000,// 15s grace for reconnect
} as const

export const CHASSIS = {
  hull: CFG.MAX_HEALTH,
  speed: CFG.PLAYER_SPEED,
  superCost: CFG.SUPER_COST,
  shieldCost: CFG.SHIELD_COST,
} as const

// Single RX-11 chassis - all pilots use the same loadout.
export const PLAYER_COLOR = '#00f0ff'
