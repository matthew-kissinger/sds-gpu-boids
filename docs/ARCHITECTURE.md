# Architecture

## Boundary

This project is a standalone Vite and TypeScript application. It shares product ideas with Sheep Dog Simulator, but it has its own renderer, loop, player controller, flock simulation, UI, test harness, and build output.

It does not:

- register a scene in the production SDS registry;
- import production `shared/` flocking or movement modules;
- connect to the SDS Worker, Durable Objects, D1, leaderboards, or replays;
- promise deterministic agreement across CPUs and GPUs;
- read the complete flock back to JavaScript each frame.

That boundary is intentional. Floating-point GPU execution and scheduling cannot satisfy the production multiplayer simulation's byte-identical deterministic contract.

## Runtime ownership

```text
keyboard / touch
       |
       v
CPU dog controller -----> CPU follow camera
       |
       v
small dog + bark uniforms
       |
       v
GPU clear -> count -> prefix scan -> scatter -> neighbor steering -> integrate
       |                                                        |
       |                                                        v
       +--------------------------------------------> storage-resident positions
                                                                |
                                     +--------------------------+------------------+
                                     |                                             |
                                     v                                             v
                          direct instanced rendering                    reduced diagnostics
                                                                                  |
                                                                                  v
                                                                    sparse scalar readback
```

The dog remains CPU-owned so input and camera response never wait for flock readback. Only position, velocity, pressure radius, and bark data cross into the compute simulation.

## GPU state

Boid positions and velocities use storage-backed arrays. Velocity is ping-ponged so every boid in a step reads the same previous state. The renderer reads current positions and velocities directly to orient low-triangle instances.

The compact uniform grid consists of:

- cell counts;
- prefix-scan scratch buffers;
- cell write cursors;
- a compact boid-index array;
- reduced diagnostic counters.

The grid dimension is capped at 64 per axis. Cell width is derived from the active world extent and perception radius. Queries inspect the neighboring 3 by 3 cells and then apply the exact distance test.

The compute sequence uses separate dispatches because a WGSL workgroup barrier cannot synchronize all workgroups. Dispatch boundaries provide the global ordering needed between counting, scan, scatter, and query phases.

## Fixed-step loop

The flock uses a 60 Hz fixed simulation step with a clamped accumulator and bounded catch-up. Rendering runs independently. Tab suspension or a long frame cannot inject an arbitrarily large delta into the flock.

Pause stops fixed-step advancement while rendering and UI remain responsive. Restart rebuilds storage state from the same count, workload, and seed and clears transient dog, bark, objective, timing, and diagnostic state.

## Objective

The GPU counts sheep inside the goal during simulation. JavaScript receives only the reduced scalar result at a controlled cadence. The CPU applies the hold timer and owns the paused and won states.

## Diagnostics contract

`window.__THREE_GAME_DIAGNOSTICS__` is the read-only browser verification surface. It includes:

- runtime status (`playing`, `paused`, `won`, `error`) and fatal-error text;
- active configuration, count, workload, seed, and objective progress;
- dog position, velocity, bark strength, and bark sequence;
- compact-grid occupancy, truncation, candidate, neighbor, and invalid-index counters;
- frame interval and CPU submission summaries;
- renderer calls, triangles, memory counts, canvas dimensions, and DPR;
- browser/adapter capability information when exposed by the browser.

Diagnostics are evidence and test hooks, not an alternate control API. Tests exercise the same keyboard, pointer, and DOM controls as a player.

## CPU reference oracle

`src/reference/boidsReference.ts` supplies seeded initialization, cell indexing, exclusive scan, compact scatter, all-pairs neighbor counts, compact-grid neighbor counts, and one-step steering.

It is intentionally independent of Three.js and the GPU implementation. Unit tests compare the compact path against the all-pairs oracle at 256 and 1,000 boids. The oracle is a correctness tool, not a runtime fallback.

`compareOneStepGpuOracle` accepts the bounded vec4 sample returned by the deep-diagnostics `window.__GPU_BOID_ORACLE__` hook, reconstructs the seeded initial state and influencer packet, runs exactly one CPU compact-grid step, and reports maximum and RMS position and velocity error. It rejects samples after more than one step because current dog and bark metadata cannot reconstruct an earlier input history. Browser QA uses `deep=1&manual=1` to submit exactly one GPU step before reading the complete 1,000-boid oracle sample.
