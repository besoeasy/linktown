// 3049 Remote Age — Canon specifications from lore.md & commit e392b58b6b4981ece32cff242cbda5a07fceb0f4
export const CFG = {
  TICK_MS: 50,              // 20 Hz simulation
  MATCH_DURATION: 600,      // 10 minutes (seconds)
  MAX_PLAYERS: 16,          // WebRTC P2P mesh room limit
  VIS_RADIUS: 120,          // Distance culling limit
  PLAYER_SPEED: 9,          // units/sec base walk speed
  RUN_SPEED: 15,            // units/sec sprint
  CROUCH_SPEED: 0,          // units/sec while crouched (stationary lock)
  PLAYER_RADIUS: 0.45,
  PLAYER_HEIGHT: 2.3,
  EYE_HEIGHT: 1.95,
  CROUCH_EYE_HEIGHT: 0.85,
  AUTO_CROUCH_MS: 5000,     // Auto-crouch after 5s of no movement
  MAX_HEALTH: 500,          // Hull = nanite census (lore.md:23)
  REGEN_DELAY: 3000,        // Calm period (no damage taken, no hull spent) before hull rebuild starts
  REGEN_RATE: 1,            // Hull rebuilt per second once the calm period completes
  SHOT_COST_SINGLE: 2,      // Nanite mass spent per single shot
  FIRE_INTERVAL_MS: 100,    // Min gap between shots (10 shots/sec max)
  CHARGE_MAX: 4,            // Max charge shot bursts
  SUPER_COST: 50,           // Nanite mass spent to trigger Super overclock
  SUPER_DURATION: 10000,    // 10s Super duration
  RESPAWN_DELAY: 7000,      // 7s reprint delay
  NANITE_CACHE_AMOUNT: 100, // Nanite cache dropped on death
  NANITE_CACHE_RADIUS: 5.0, // Pickup radius in world units
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
  ANCHOR_LIFETIME: 30000,   // Telepotu relay anchor lifetime (ms)
  RECALL_COST: 15,          // Nanite mass spent to warp back to anchor
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

export type CoreId =
  | 'denja'
  | 'mednix'
  | 'tank'
  | 'anchor'
  | 'telepotu'

export interface CoreInfo {
  id: CoreId
  name: string
  maker: string
  ability: string
  cooldown: number // ms
  color: string
  badge: string
  desc: string
  lore: string
}

export const CORE_DETAILS: Record<CoreId, CoreInfo> = {
  denja: {
    id: 'denja',
    name: 'Denja',
    maker: 'Kuro Racer Syndicate',
    ability: 'Overdrive',
    cooldown: 30000,
    color: '#f97316',
    badge: '🔥',
    desc: 'Overclocks chassis mobility to 2× speed for 8s.',
    lore: 'Pit-racer governor removal burst; burns raw nanite conduits.'
  },
  mednix: {
    id: 'mednix',
    name: 'Mednix',
    maker: 'Helix Med-Corps',
    ability: 'Field Repair',
    cooldown: 20000,
    color: '#10b981',
    badge: '💊',
    desc: 'Recycles waste heat to restore 1–50 Hull immediately.',
    lore: 'Rapid field fabrication protocol from frontline orbital trauma units.'
  },
  tank: {
    id: 'tank',
    name: 'Tank',
    maker: 'Bastion Siege Foundry',
    ability: 'Bulwark',
    cooldown: 35000,
    color: '#3b82f6',
    badge: '🛡️',
    desc: 'Reinforces nanite density: 50% damage reduction for 8s.',
    lore: 'Siege barrier architecture capable of withstanding direct kinetic strikes.'
  },
  anchor: {
    id: 'anchor',
    name: 'Anchor',
    maker: 'Orbital Guard',
    ability: 'Aegis',
    cooldown: 40000,
    color: '#06b6d4',
    badge: '⚓',
    desc: 'Deploys a pre-charged cell for 3s of full immunity with 0 Hull cost.',
    lore: 'Standard military guard cell designed for breaching hot drop zones.'
  },
  telepotu: {
    id: 'telepotu',
    name: 'Telepotu',
    maker: 'Vela Relay Compact',
    ability: 'Recall Relay',
    cooldown: 30000,
    color: '#f59e0b',
    badge: '📡',
    desc: 'Drops a relay anchor with Q. Press Q again within 30s to warp back for 15 Hull.',
    lore: 'Vela breakaway-freight recall beacons, tuned for hot extractions.'
  },
}

export const CORE_IDS: CoreId[] = Object.keys(CORE_DETAILS) as CoreId[]
