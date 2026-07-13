Original prompt: Build a standalone new Sheep Dog Simulator prototype that moves boid simulation to GPU/WebGPU, keeps the player interactive, scales toward 100,000 entities, validates the implementation honestly, and then implement the approved plan completely.

## 2026-07-13

- Created an independent Vite + TypeScript project rather than adding a production SDS game mode.
- Pinned Three.js 0.185.0 and current patched Vite/Vitest/Playwright dependencies; npm audit is clean.
- Added the WebGPU-only capability gate, adapter/limit report, device-loss callback, fixed 60 Hz loop, performance tracker, URL configuration, and procedural arena/goal foundation.
- Implemented the GPU compact-grid compute pipeline, storage-backed direct rendering, dog/HUD controls, CPU oracle, benchmark runner, and browser QA tooling.
- Corrected two live-only WebGPU integration faults found by installed Chrome: the unnecessary 100,000-instance matrix uniform and pre-dispatch storage readback.
- Added hardware timestamp-query timing, adapter limits/features, semantic validity classes, and a deterministic one-step GPU/CPU oracle.
- Passed the final unit/build/browser suite, desktop/mobile production canvas checks, and the honest unsupported-WebGPU overlay check.
- Completed the 27-case performance ladder, three one-minute 100k repeats, and a five-minute 100k soak on the RTX 3070 development host.

## Completed outcome

- The standalone prototype is implemented and locally committed as an independent game engine experiment.
- Stable 100,000-agent throughput is proven on the named development machine; dense sustained cases are explicitly labeled when the 512-candidate approximation engages.
- The production `sds` repository remains untouched.
- Capacity on the user's inexpensive target instance remains a hardware-owned follow-up, not an inferred claim.

## Home Field polish and tuning pass

- Rebuilt the prototype world as a 440-meter Home Field using the authentic Jep dog, farmhouse, fence, gate, homestead props, trees, rocks, placement data, music, bark, bleats, and victory audio.
- Added a full start-to-win loop with a north pen, animated goal beacon, 60% hold objective, pause/restart, responsive touch controls, and a camera/start layout designed for herding toward the farm.
- Replaced the placeholder flock wedge with a recognizable low-triangle sheep assembled from one merged geometry and rendered directly from GPU storage in one instanced draw.
- Added the live Flock Lab with four presets, five behavior switches, fifteen sliders, reset, and copy-to-JSON. Changes apply to the active GPU simulation without restarting.
- Added shader uniforms for flock weights/radii/speeds, boundary behavior, dog pressure, bark pressure, and optional goal attraction.
- Revalidated the independent CPU/GPU one-step oracle after the enlarged Home Field seed change.
- Captured desktop/mobile game and tuning-drawer screenshots and completed a fresh 1k/100k production benchmark.

## Home Field control and construction correction

- Traced the production Home Field scene, FencePresets, OptimizedSheep, Sheepdog, placement manifest, and camera controller before changing the standalone prototype.
- Rebuilt the 440-meter pasture as a closed square with a centered north opening, the authored Gate_Assembly, and an attached three-sided retirement pen made from the production fence post and rail meshes.
- Corrected fence rail orientation/scaling and rescaled the production tree manifest to the enlarged field so trees remain outside the playable pasture and clear of the pen.
- Replaced the flock render geometry with the production-style merged instanced sheep silhouette, including body, forward head, legs, eyes, pupils, glints, and nose at lower counts plus a reduced crowd LOD at 100,000.
- Corrected both forward-axis bugs: sheep heads now align with GPU velocity and Jep's root now rotates once toward dog velocity instead of receiving a second 180-degree turn.
- Added follow, free-orbit, and classic overhead camera views with wheel/plus-minus zoom, pointer drag, Q/E look, and C/HUD view cycling.
- Implemented GPU-side gate crossing retirement: retired sheep leave compact-grid/flocking work, move into deterministic pen slots, and feed the retirement objective counter.
- Added browser regressions for dog forward/left facing and zoom/orbit/view cycling, and captured a full south-to-north traversal showing the gate and pen without browser errors.

## Camera-relative controller and scale correction

- Unified keyboard and touch-stick movement around active camera axes: W/S are screen forward/back and A/D are screen left/right in follow, orbit, and classic views.
- Corrected the orbit/classic camera-side convention that inverted lateral input after changing views.
- Split Jep's fixed 60 Hz simulation position/heading from its interpolated render transform, reduced turn response from 15 to 8, and normalized accumulated angles to remove lateral snapping and high-refresh stair-step shake.
- Reduced Home Field from a 440-meter to a 280-meter square, expanded maximum camera zoom from 110 to 180, and enlarged sheep at every render tier.
- Removed the spike-grass instances, retaining the textured meadow surface with no extra grass draw.
- Applied the production rock asset's 0.2-meter native-height normalization before instancing so rocks sit on the ground at believable scale outside the fence.
- Preserved the existing count ladder and added 125k, 150k, 200k, 300k, and 500k stress tiers with GPU storage sized to 500,000 sheep.
