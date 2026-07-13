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
