# Measured results

Measured on 2026-07-13 using the production Vite build at 1280 by 720, DPR 1, installed Chrome 150.0.7871.114, an NVIDIA GeForce RTX 3070 (WebGPU adapter architecture reported as `ampere`), driver 32.0.15.9649, Ryzen 7 3700X, and Windows build 10.0.26200.8655.

These results establish this development machine only. They do not predict or certify the user's inexpensive target instance.

## Correctness

The installed-Chrome one-step GPU oracle read back all 1,000 field boids and compared them with the independent CPU compact-grid implementation:

- maximum position error: 9.5367431640625e-7;
- maximum velocity error: 4.76837158203125e-7;
- RMS position error: 2.924009336522957e-8;
- RMS velocity error: 3.1e-8 to 3.3e-8 across final verification runs; parallel scatter ordering can slightly change floating-point accumulation order.

The unit oracle suite also passes all 11 tests, including exact compact-grid versus all-pairs neighbor counts and one-step integration at 256 and 1,000 boids.

## Five-second ladder

The 27-case ladder used a two-second warmup and five-second measured window per case. Every case maintained real-time 60 Hz simulation, zero invalid indices, zero console/page errors, and a frame p95 no higher than 7.1 ms.

| Workload | Exact-neighborhood tiers | Candidate cap begins | 100k timing |
|---|---:|---:|---:|
| Constant density | 1k through 100k | Not during the five-second window | p95 7.0 ms, p99 7.1 ms, GPU compute 3.21 ms, render 0.38 ms |
| Fixed field | 1k through 16k | 32k | p95 7.1 ms; candidate-capped |
| Compressed herd | 1k through 8k | 16k | p95 7.1 ms; candidate-capped |

Candidate-capped cases remain bounded, interactive boid approximations. They are not exact evaluation of every neighbor within the perception radius.

## Repeats and soak

Three independent 100k constant-density runs used five-second warmups and one-minute measured windows:

- frame p95: 7.0 to 7.1 ms;
- GPU compute: 3.52 to 4.27 ms;
- GPU render: 0.27 to 0.32 ms;
- simulation-rate ratio: 1.0 in all runs;
- invalid indices, dropped measured steps, console errors, page errors, and device loss: zero;
- final-step candidate-capped boids: 19,049 to 22,160 as cohesion formed dense local clusters.

The five-minute 100k soak recorded 43,203 frame samples, p95 7.0 ms, p99 7.1 ms, 3.22 ms GPU compute, 0.33 ms GPU render, exactly 300 seconds of simulation advancement, no measured dropped steps, no invalid indices, no browser errors, and no device loss. Its final sampled step had 8,386 candidate-capped boids.

## Conclusion

This prototype proves stable, interactive 100,000-agent throughput on the named RTX 3070 machine. It also proves exact CPU/GPU agreement for the bounded correctness oracle. It does not prove that 100,000 agents remain exact-neighborhood boids after sustained clustering; the 512-candidate guard intentionally trades neighborhood completeness for bounded work and reports when that tradeoff engages.

Raw local reports are written to `artifacts/benchmarks/` and are intentionally ignored by Git because they are machine-specific evidence.
