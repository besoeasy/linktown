# LINKTOWN — Current Game Economy Plan

## 1. Lore Frame (why economy exists)

* Year 3049. Humans never touch ground. Robots do mining / soldiering / research. Operators pilot from orbit.
* **RX-11:** one chassis for everything. Same hull, speed, wiring. No loadouts, no class picks — every pilot drops in identical.
* **L-Town:** decommissioned Meridian transit hub, first shell printed here. No residents, only shells + drones. One map per day, 10-min trials dawn to dusk, instant requeue. Highest score wins.
* **Operators:** open amateurs, death = disconnect white-out + headache, then requeue.

This justifies: no loadouts, no upgrades, death is cheap, score = resume.

## 2. Nanites Concept (single-currency economy)

Lore rule:

> Hull = nanite count: fuel, function, and mass at once. Fire, jumps, shields spend nanites. Survive 3s calm — no hits taken, no nanites spent — core rebuilds 1 hull/s — 3x crouched behind cover. Any spend or wound restarts clock. Destroyed swarms reprint whole after 7s. Destroyed swarms eject +100 cache.

Rules:

* Max hull 500 = start and cap.
* Hull is simultaneously HP + ammo + ability resource. No separate bullets, mana, stamina.
* Regen clock: any damage taken or any hull spent resets the 3s timer.
* Death -> zero, 7s respawn, full 500 reprint, all buffs wiped.

Design intent: aggression drains you, passivity restores you, but too slow to turtle through a fight.

## 3. Income (how you gain hull)

| Source | Value |
|---|---|
| Spawn / reprint | 500 full |
| Calm regen standing/moving | 1/s after 3s calm |
| Calm regen crouched | 3/s after 3s calm, stationary lock, auto-crouch after 5s idle |
| Nanite cache salvage | +100, pickup radius 5u, closest alive shell wins, capped at 500 |

Caches are the only map-spawned income. One death = one 100 cache at death pos. No passive map pickups otherwise.

## 4. Costs / Outflows (how you lose hull)

| Sink | Cost | Notes |
|---|---|---|
| Hitscan shot | -2 per shot, 100ms interval = max 20/s drain |
| Cannot fire | blocked at 2 hull or less |
| Super (E) | -50, requires 51+, 10s 3x dmg + 2x speed, blocks shield |
| Shield (R) | -80, requires 81+, 10s full immunity, trigger dead while up (projector hand) |
| Super Jump | -20 |
| Normal jump | 0 currently, free verticality via pads |
| Base damage taken | 20 per hit, falloff with distance, min 25% |
| Super damage taken | 60 per hit at point blank (20x3) |

Math:
* 500 hull = 250 shots max if never hit.
* TTK point blank: 25 hits = 2.5s hold-fire. At 60u+: falloff ~0.6x = ~41 hits.
* Firing 10/s while taking 20/hit means you lose net hull fast — forces 3s disengage to regen.
* Regen is weak in-fight (1/s vs 20 dmg), strong between fights if you crouch (3/s = 180 to full from 320 in 60s, or cache +100 instant).

## 5. Chassis Actions (single RX-11 loadout)

All pilots use the same chassis and actions. No character picks, no class abilities.

* **Fire (LMB):** hitscan shot, -2 hull per shot.
* **Super (E):** -50 hull, 10s of 3x damage + 2x speed. Blocks shield while active.
* **Shield (R):** -80 hull, 10s full immunity. Firing disabled while shield is up. Blocked while Super is active.
* **Jump (Space):** normal jump; Super Jump costs -20 hull.
* **Crouch (C):** stationary, 3x hull regen after calm period.

## 6. Time & Score Economy

* Match 600s, 20 ticks per second.
* Kill = +1 score to shooter, suicide = 0. No bounty, no assist.
* Winner = highest score at 0s. Rank + total + winner shown.
* Respawn tax: 7s dead = ~1.1% of match per death. Dying 5x = ~35s lost + feeds caches to enemy.
* HVT = top alive scorer above 0. Leaderboard top 5.
* Bots use the same chassis, scavenge caches under 30u if hurt. Solo = 1 human + 7 bots.

Loop: spend hull to frag -> drop cache -> winner siphons 100 -> snowball -> victim reprints full in 7s elsewhere -> contest next cache.

## 7. Movement / Position Costs

* Walk 9, run 15 always-run, crouch 0. Crouch = trade all mobility for 3x regen.
* Jump pads: free, 6 active, 28s life, 2.2u radius, 1.2s CD, high launch + extra air steer for 3s.
* Portals: free, coin-flip to appear if none active, 10s life, 2.5u radius. 1.5s warp CD.
* Proximity radar only under 100u, crouched shells hidden — info is scarce, positioning matters.

## 8. What to Watch When Porting / Tuning

1. Regen 1/s is too slow to matter in 10-min PC pace — consider 4-6/s base.
2. Shot cost 2 is negligible vs 20 dmg — raise to make spam hurt, or keep as anti-hold-fire only.
3. Cache 100 is 20% max — strong snowball. Cap siphon or decay over time.
4. Free mobility (pads/portals) can break hull-as-fuel fantasy — add small hull toll if strict.
