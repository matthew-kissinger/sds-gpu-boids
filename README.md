# Sheepdog GPU Home Field

A standalone, playable WebGPU re-imagining of Sheep Dog Simulator's Home Field. It uses the original Jep dog, farm, fence, gate, tree, rock, homestead, music, bark, and bleat assets while a new GPU compute engine simulates and directly renders up to 100,000 sheep.

This is a new-engine prototype. It is not a Sheep Dog Simulator scene, game mode, multiplayer client, or replacement release. It deliberately does not import the production game's `shared/` deterministic simulation or connect to its Cloudflare Worker.

## Requirements

- Node.js 22 or newer
- A browser and adapter with WebGPU support
- Chrome installed for the default benchmark runner

The app is intentionally WebGPU-only. Unsupported browsers receive a capability explanation rather than an unrelated CPU or WebGL fallback.

## Run it

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5190`. The first screen is the playable field.

Useful commands:

```bash
npm run build
npm run preview
npm run test:unit
npm run test:e2e
npm run inspect:canvas
npm run benchmark -- --counts 1000,16000 --duration 5000 --warmup 1000
```

The production preview runs at `http://127.0.0.1:4190`. Benchmarking defaults to that URL.

## Controls

- `WASD` or arrow keys: move the dog
- `Space`: bark
- Mouse/touch drag or `Q` / `E`: look around in free-orbit view
- Mouse wheel or `+` / `-`: zoom
- `C` or the camera HUD button: cycle follow, orbit, and classic overhead views
- `P`: pause or resume
- `R`: restart the current seed and workload
- Touch stick: move on touch devices
- `Bark` touch button: bark
- Count and starting-layout selectors: rebuild the simulation
- `Tune`: open the live Flock Lab
- `SFX`: mute or restore music and effects

Flock Lab changes the running compute simulation without a restart. It includes presets plus switches and sliders for separation, alignment, cohesion, awareness, personal space, speed limits, boundaries, dog speed/pressure, bark pressure, and optional goal attraction. `Copy` writes the current tuning as JSON.

Herd 60% of the flock through the centered north gate. Sheep that cross the threshold retire from flocking and take a place inside the attached pen. The `Goal demo` workload exists for retirement/objective QA; it is not a benchmark workload.

## Starting layouts

- `Open pasture`: scatters throughout the enlarged Home Field.
- `Home Field scatter`: places the flock between Jep and the north pen for a complete herding run.
- `Tight flock`: starts compressed and stresses crowd response.

The count ladder is 1k, 2k, 4k, 8k, 16k, 32k, 50k, 75k, and 100k. The same complete ladder is available in the UI and benchmark runner.

## What the metrics mean

Frame p50/p95/p99 are delivered frame intervals. Compute-submit and render-submit measurements are CPU time spent issuing work. They are not GPU execution time. The benchmark emits GPU timing only when diagnostics identify a hardware timestamp query as the source.

The HUD also reports candidate truncation, maximum cell occupancy, invalid indices, and the goal reduction. A high frame rate with invalid indices or silent truncation is not considered a valid result.

See:

- [Architecture](docs/ARCHITECTURE.md)
- [Benchmark methodology](docs/BENCHMARKING.md)
- [Verification](docs/VERIFICATION.md)
- [Measured results](docs/MEASURED_RESULTS.md)
- [Originality and licensing](docs/ORIGINALITY-AND-LICENSING.md)
