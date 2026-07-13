# Measured results

Measured on 2026-07-13 using the production Vite preview at 1280 by 720, DPR 1, installed Chrome 150.0.7871.114, and an RTX 3070 WebGPU adapter reported as `ampere`. These figures establish this development machine only.

## Final Home Field benchmark

Each case used a three-second warmup and eight-second measured window.

| Sheep | Frame p50 | Frame p95 | Median FPS | GPU compute | GPU render | Validity |
|---:|---:|---:|---:|---:|---:|---|
| 1,000 | 6.9 ms | 7.0 ms | 144.9 | 0.07 ms | 0.17 ms | Exact neighborhood |
| 100,000 | 6.9 ms | 7.0 ms | 144.9 | 2.89 ms | 3.21 ms | 32,944 sheep candidate-capped at the final sample |

The final 100,000-sheep case advanced simulation in real time with no invalid indices or measured dropped steps and cleared the runner's 60 Hz gate on this machine. It does not certify 60 Hz on inexpensive hardware.

The final sheep mesh costs 130 triangles per sheep (13 million triangles at 100,000) and the complete flock is submitted as one instanced draw.

## Correctness

The installed-Chrome one-step oracle compared all 1,000 GPU sheep with the independent CPU compact-grid implementation after the enlarged Home Field seed change:

- maximum position error: `0.0000019073486328125`;
- maximum velocity error: `0.00000011920928955078125`;
- RMS position error: `0.00000004264961199760036`;
- RMS velocity error: `0.0000000064466113128550476`.

All 11 CPU reference tests pass, including compact-grid versus all-pairs comparisons.

## Interpretation

This build proves that the new engine can keep 100,000 interactive sheep real-time on the named development GPU while rendering the polished Home Field and live tuning UI. Sustained dense clustering can engage the explicit candidate guard; those steps remain bounded and playable but are approximate boids. Raw machine-specific reports are stored under `artifacts/benchmarks/` and are ignored by Git.
