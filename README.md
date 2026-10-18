<img width="2160" height="1350" alt="LT" src="https://github.com/user-attachments/assets/243a1011-47b9-4f48-81e3-59ca961ca182" />

# LINKTOWN

A 3D multiplayer browser game rendered with Three.js.

## Lore

Set in 3049, humans never touch the ground — robots go down, operators stay in orbit. See [lore.md](lore.md) for the full story.

Know more about LINKTOWN lore: [ask Duck.ai about the lore](https://duck.ai/?q=Understand%20the%20LINKTOWN%20lore%20from%20https%3A%2F%2Fgithub.com%2Fbesoeasy%2FLINKTOWN%2Fblob%2Fmain%2Flore.md%20and%20answer%20my%20question%20based%20on%20that)

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
