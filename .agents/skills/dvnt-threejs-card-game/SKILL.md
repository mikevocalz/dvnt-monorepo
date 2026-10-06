---
name: dvnt-threejs-card-game
description: DVNT Game Night Three.js table, card animation, interaction, lifecycle and performance rules.
---

# DVNT Three.js Card Game

Use this skill for `packages/app/features/game-night/components/table/**` and any new 3D card-table surface.

## Architecture that must stay true

- Web enhanced renderer is an imperative Three.js island. React owns server/game props; Three owns meshes/camera; GSAP owns card motion.
- Keep `GameTable` (Skia/CanvasKit) as the web fallback. A WebGL init/render failure must never take the room down.
- Native enhanced rendering stays on the existing `three/webgpu` + shared `GpuRuntime` path. Do not create or dispose a second shared GPU device.
- Do not introduce React Three Fiber just because a reference project uses it. R3F is acceptable only if a measured ADR shows it removes more complexity than it adds across this monorepo.
- Keep server-authoritative game rules outside the render loop. The scene is a projection and an input surface, never the source of truth.

## Card interaction rules

- Every 3D interaction needs an accessible DOM/RN equivalent.
- Pointer/touch gestures may preview, drag, fan, lift, flip, deal or select cards, but the final action must call the existing command path.
- A drag is not a second command path. It may select a card or judge a reveal; submission still uses the existing server command and idempotency token.
- Cap hover raycasts and avoid allocations in pointermove.
- Use stable mesh keys and retarget existing rigs. Do not rebuild the whole scene on realtime projection refreshes.

## Animation rules

- GSAP targets Three object refs directly. Do not push 60 Hz transforms through React state.
- New cards should originate from a believable physical source (deck/hand), arc through space, then settle.
- Reveals flip on the shortest readable path. Winners may lift/glow, but do not obscure neighboring cards.
- Respect `prefers-reduced-motion`: snap/shorten travel, disable camera drift and continuous decorative motion.
- Scale all continuous motion by elapsed/delta time.

## Responsive camera

- Camera fit must solve both horizontal and vertical bounds.
- On portrait/narrow viewports, compress table spread before moving the camera so far away that card text becomes unreadable.
- Clamp device pixel ratio to protect fill rate.
- Recompute layout through ResizeObserver and retarget existing objects instead of recreating them.

## Materials and lighting

- DVNT Game Night: black/near-black environment, deep purple/violet light, warm gold winner accent.
- The table can use dark felt/leather and a dimensional rail. Avoid generic casino-green unless a specific game theme calls for it.
- Prefer one key light, one purple rim/fill, restrained underglow, soft shadows and physically plausible roughness.
- Reuse geometries/materials/textures. Dispose only resources owned by this scene.

## Performance and cleanup

- Lazy-load Three.js for Game Night web so non-game routes do not pay for it.
- No `new Vector3/Color/Material` inside the frame loop.
- Cap expensive raycasts.
- Kill GSAP tweens before removing rigs.
- Dispose scene-owned geometry/material/texture resources and renderer; remove event listeners, ResizeObserver and RAF.
- Never dispose `GpuRuntime` from a table component.
- Prefer a single table renderer/canvas per room.

## Reference patterns (study, do not copy)

- `aylabyuk/uno`: physical card presentation, modern React 3D card-game motion stack.
- `TesseractCat/bg3d`: tabletop camera and direct object/card manipulation.
- `letuan279/coup-3d`: React 19 multiplayer 3D table + 2D HUD separation and server-authoritative rules.
- `sdfgeoff/solitaire-threejs` and `K-You/threejs-solitaire`: stack/fan/placement semantics.

## Review checklist

- WebGL unavailable -> Skia fallback still works.
- Resize from wide desktop to portrait phone -> no card clipping.
- Pointer and touch both work.
- Reduced motion stays readable and functional.
- Realtime state refresh does not restart every tween.
- A failed animation cannot send a duplicate server command.
- Scene unmount leaves no RAF, listener, observer, texture or renderer behind.
