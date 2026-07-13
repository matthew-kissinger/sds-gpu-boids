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
