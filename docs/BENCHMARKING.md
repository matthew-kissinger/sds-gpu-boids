# Benchmark methodology

## Principle

The benchmark reports the highest measured stable tier and continues through configured stress tiers to expose a failure mode. It does not infer performance from a smaller run, treat CPU submission time as GPU time, or call a sparse open-field result representative of a compressed herd.

## Standard run

Build and serve the production artifact:

```bash
npm run build
npm run preview
```

In another terminal:

```bash
npm run benchmark
```

The default matrix is:

- Counts: 1k, 2k, 4k, 8k, 16k, 32k, 50k, 75k, 100k
- Workloads: constant density, fixed field, herding clump
- Viewport: 1280 by 720
- Device scale factor: 1
- Warmup: 10 seconds per case
- Measurement: 60 seconds per case
- Browser: installed Chrome through Playwright
- Seed: fixed and recorded in the report

The complete default matrix takes more than 30 minutes. A short plumbing smoke is:

```bash
npm run benchmark -- --counts 1000,16000 --scenarios constant,herd --warmup 1000 --duration 5000
```

Supported runner options:

```text
--url URL
--counts 1000,16000,100000,150000,200000,300000,500000
--scenarios constant,field,herd
--warmup MILLISECONDS
--duration MILLISECONDS
--seed INTEGER
--repeats INTEGER
--out FILE
--channel chrome
--headed
```

## Workload definitions

### Constant density

The world extent scales with count. This tests algorithmic scaling when expected local neighbor density remains approximately stable.

### Fixed field

Every tier uses the same open world extent. Density rises with count and exposes candidate growth that a constant-density chart can hide.

### Herding clump

Agents begin in a compressed central region. This deliberately stresses maximum cell occupancy, candidate truncation, and neighbor acceptance. It approximates the difficult state created by actual herding.

## Recorded evidence

Each case saves:

- exact URL, count, workload, seed, browser, viewport, DPR, and WebGPU exposure;
- warmup and measurement durations;
- requestAnimationFrame interval sample count, mean, p50, p95, p99, median delivered FPS, and long-frame count;
- diagnostics before and after the measured window;
- console and uncaught page errors;
- CPU compute-submission evidence, labeled as CPU timing;
- GPU compute/render timing only when the diagnostics source is `timestamp-query`.

Percentiles use nearest-rank selection. Frame intervals are delivery intervals and include browser scheduling, CPU work, GPU back-pressure, and presentation. They are useful end-to-end evidence but are not isolated GPU kernel durations.

## Classification

- `60-hz-pass`: p95 at most 16.7 ms and p99 at most 25 ms
- `30-hz-pass`: p95 at most 33.3 ms and p99 at most 50 ms
- `below-30-hz`: misses the 30 Hz thresholds
- `unmeasured`: no valid frame distribution

The runner suffixes the timing result when semantic validity is reduced. For example, `60-hz-pass-candidate-capped` means delivery timing passed while one or more boids reached the explicit 512-candidate neighborhood guard. It is throughput evidence, not exact-neighborhood evidence. Simulation-rate lag, dropped steps, and invalid indices receive their own invalidating suffixes.

A timing classification is invalidated by page errors, invalid indices, non-finite state, device loss, or unexplained diagnostic truncation. Candidate truncation must be reported alongside timing; it may be acceptable as an explicit behavior-quality tradeoff, but never as exact flocking.

## Device coverage

The development desktop is a control machine, not the inexpensive-target acceptance device. Save separate reports per adapter and browser. Do not merge results from different machines into one unlabeled capacity claim.

For a capacity claim, rerun the highest passing tier three times and soak it for five minutes. Record thermal or power constraints where available.

## Results

Benchmark JSON is written under `artifacts/benchmarks/` by default. Results are deliberately not committed to this document until a named device and exact command have produced them.
