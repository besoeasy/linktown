<img width="2160" height="1350" alt="LT" src="https://github.com/user-attachments/assets/243a1011-47b9-4f48-81e3-59ca961ca182" />

# LINKTOWN

[![Star History Rank](https://api.star-history.com/badge?repo=besoeasy/linktown&type=rank)](https://www.star-history.com/besoeasy/linktown)

A 3D multiplayer browser game rendered with Three.js.

## Lore

Set in 3049, humans never touch the ground — robots go down, operators stay in orbit. Every pilot drops in the same RX-11 chassis; no loadouts, no character picks.

## Development

```sh
npm install
npm run dev
```

## Graphics

Rendering is WebGPU-first: the game uses three.js' `WebGPURenderer`, which runs
on a real WebGPU device when the browser exposes an adapter and falls back to
WebGL 2 otherwise (the same scene, post stack and materials on both). The frame
is produced by the node post stack — multisampled HDR scene pass, optional GTAO
and bloom, tone map — and submitted once per frame from an awaited render loop.

Quality and backend can be chosen with URL parameters (each one persists to
localStorage for later loads):

| Parameter | Values | Default | Effect |
| --- | --- | --- | --- |
| `?gfx=` | `low`, `medium`, `high` | `medium` | MSAA, shadow resolution, GTAO, bloom, pixel ratio |
| `?gpu=` | `webgpu`, `webgl` | auto | Force a backend (auto uses WebGPU when available) |
| `?dyn=` | `0`, `1` | `1` | Adaptive render scale, driven by measured GPU frame time |
| `?debug=1` | flag | off | Performance overlay (backend, GPU/CPU ms, calls, triangles) |

Example: `?gfx=high&debug=1` for the full look with the overlay, or
`?gfx=low` on a weak GPU.

## Build

```sh
npm run build
npm run preview
```


## Star History

[![Star History Chart](https://api.star-history.com/chart?repos=besoeasy/linktown&type=date&legend=top-left)](https://www.star-history.com/?repos=besoeasy%2Flinktown&type=date&legend=top-left)
