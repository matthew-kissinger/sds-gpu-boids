# Verification

## Correctness rails

The Vitest reference suite verifies:

- bit-for-bit seeded initialization for constant-density, field, herd, and goal distributions;
- prefix-scan offsets and monotonicity;
- compact scatter as a complete, non-overlapping boid permutation;
- clamped cell indexing at domain edges;
- exact compact-grid neighbor counts against all-pairs at 256 and 1,000 boids;
- one-step compact-grid steering against all-pairs at 256 and 1,000 boids.

Run it with:

```bash
npm run test:unit
```

These tests validate the CPU oracle and grid construction. The Playwright oracle test separately reads all 1,000 entities after exactly one installed-Chrome WebGPU step and compares them with the same seed and constants; a passing CPU suite alone is not proof that a shader compiled or executed correctly.

For deep diagnostics, request a one-step sample through `window.__GPU_BOID_ORACLE__` and pass it to `compareOneStepGpuOracle`. The automated test uses `deep=1&manual=1` to guarantee one submitted step. Full-flock per-frame readback is explicitly forbidden; the hook is bounded, asynchronous, and available only in deep mode.

## Browser QA

```bash
npm run test:e2e
```

The Playwright suite accepts exactly two startup outcomes:

1. a ready WebGPU runtime with a visible, nonblank canvas; or
2. a visible, explanatory WebGPU capability error.

When WebGPU is ready, it exercises:

- desktop keyboard movement;
- touch-stick movement;
- desktop and touch bark input;
- pause and resume state;
- restart cleanup and seeded reset;
- count rebuild;
- workload rebuild;
- goal-demo objective reduction and win state;
- console and uncaught page errors;
- active-game screenshots and canvas color variance.

An unsupported browser can validate the capability path but cannot count as a gameplay pass. Run the same suite in a WebGPU-capable installed Chrome before calling the prototype complete.

## Canvas inspection

With a server running:

```bash
npm run inspect:canvas
npm run inspect:canvas -- --mobile
```

The inspector records canvas CSS size, drawing-buffer size, sampled color variance, diagnostics, console errors, page errors, and a full-page screenshot under `artifacts/canvas-inspection/`.

## Completion checklist

- `npm install` succeeds from a clean checkout.
- `npm run build` passes.
- Production preview is verified, not only the dev server.
- The player can move and bark within five seconds.
- The goal and hold state are legible.
- Pause, resume, and restart work after active simulation.
- Desktop and mobile canvas checks are nonblank.
- Renderer and grid diagnostics are captured.
- The short benchmark plumbing run writes valid JSON.
- A named adapter completes the intended benchmark matrix.
- Browser tabs, contexts, and preview processes are closed after verification.

## Evidence report template

```text
QA result:
Commit:
Commands:
Preview URL:
Browser / adapter:
Desktop and mobile viewports:
Controls tested:
Canvas pixel result:
Console / page errors:
Renderer diagnostics:
Grid diagnostics:
Benchmark artifact:
Screenshots:
Issues fixed:
Residual risks:
```
