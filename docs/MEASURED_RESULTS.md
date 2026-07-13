# Measured results

Measured on 2026-07-13 using the production Vite preview at 1280 by 720, DPR 1, installed Chrome 150.0.7871.114, and an RTX 3070 WebGPU adapter reported as `ampere`. These figures establish this development machine only.

## Compact Home Field stress ladder

Each stress case used a two-second warmup and five-second measured window after the field/controller polish pass.

| Sheep | Frame p50 | Frame p95 | Median FPS | GPU compute | GPU render | Result |
|---:|---:|---:|---:|---:|---:|---|
| 100,000 | 6.9 ms | 7.0 ms | 144.9 | 2.95 ms | 3.47 ms | 60 Hz pass, candidate-capped |
| 125,000 | 6.9 ms | 7.1 ms | 144.9 | 4.04 ms | 5.62 ms | 60 Hz pass, candidate-capped |
| 150,000 | 7.0 ms | 13.9 ms | 142.9 | 4.17 ms | 6.22 ms | 60 Hz pass, candidate-capped |
| 200,000 | 13.9 ms | 20.9 ms | 71.9 | 7.42 ms | 8.59 ms | 30 Hz pass, candidate-capped |
| 300,000 | 55.6 ms | 62.5 ms | 18.0 | 14.71 ms | 12.63 ms | Below 30 Hz, simulation lag |
| 500,000 | 152.7 ms | 159.7 ms | 6.5 | 42.65 ms | 20.04 ms | Below 30 Hz, simulation lag |

The practical timing boundary on this machine is between 200,000 and 300,000 sheep. All six cases reported zero invalid indices. Candidate-capped tiers are bounded approximations rather than exact full-neighborhood boids, and none of these measurements certify inexpensive hardware.

The 100,000-sheep crowd LOD costs 140 triangles per sheep (14 million triangles total) and the complete flock is submitted as one instanced draw.

## Correctness

The installed-Chrome one-step oracle compared all 1,000 GPU sheep with the independent CPU compact-grid implementation after the enlarged Home Field seed change:

- maximum position error: `0.0000019073486328125`;
- maximum velocity error: `0.00000011920928955078125`;
- RMS position error: `0.00000004264961199760036`;
- RMS velocity error: `0.0000000064466113128550476`.

All 11 CPU reference tests pass, including compact-grid versus all-pairs comparisons.

## Interpretation

This build proves that the new engine can keep 100,000 interactive sheep real-time on the named development GPU while rendering the polished Home Field and live tuning UI. The added ladder also identifies the measured failure regime instead of extrapolating indefinitely. Sustained dense clustering can engage the explicit candidate guard; those steps remain bounded but are approximate boids. Raw machine-specific reports are stored under `artifacts/benchmarks/` and are ignored by Git.
