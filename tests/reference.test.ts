import { describe, expect, test } from 'vitest';
import {
  GPU_REFERENCE_DEFAULTS,
  allPairsNeighborCounts,
  buildCompactGrid,
  cellIndexForPosition,
  compareOneStepGpuOracle,
  createGpuGridConfig,
  gridNeighborCounts,
  initializeBoids,
  stepAllPairs,
  stepCompactGrid,
} from '../src/reference/boidsReference';

describe('seeded boid initialization', () => {
  test.each(['constant', 'field', 'herd', 'goal'] as const)('%s is bit-for-bit repeatable', (scenario) => {
    const first = initializeBoids({ count: 1000, seed: 0x5eed1234, worldExtent: 48, scenario });
    const second = initializeBoids({ count: 1000, seed: 0x5eed1234, worldExtent: 48, scenario });
    const different = initializeBoids({ count: 1000, seed: 0x5eed1235, worldExtent: 48, scenario });

    expect(first.positions).toEqual(second.positions);
    expect(first.velocities).toEqual(second.velocities);
    expect(first.positions).not.toEqual(different.positions);
  });
});

describe('compact grid construction', () => {
  test('exclusive scan and scatter form a complete, non-overlapping permutation', () => {
    const state = initializeBoids({ count: 1000, seed: 77, worldExtent: 40 });
    const config = createGpuGridConfig(40);
    const grid = buildCompactGrid(state, config);

    expect(grid.offsets[0]).toBe(0);
    expect(grid.offsets[grid.offsets.length - 1]).toBe(state.count);

    const seen = new Uint8Array(state.count);
    for (let cell = 0; cell < config.cellCount; cell += 1) {
      const start = grid.offsets[cell];
      const end = grid.offsets[cell + 1];
      expect(end - start).toBe(grid.counts[cell]);
      expect(end).toBeGreaterThanOrEqual(start);

      for (let cursor = start; cursor < end; cursor += 1) {
        const boid = grid.indices[cursor];
        expect(boid).toBeLessThan(state.count);
        expect(seen[boid]).toBe(0);
        seen[boid] = 1;
        expect(grid.boidCells[boid]).toBe(cell);
      }
    }

    expect(Array.from(seen).every((value) => value === 1)).toBe(true);
  });

  test('positions on and beyond the domain edge clamp to valid cells', () => {
    const config = createGpuGridConfig(20);
    expect(cellIndexForPosition(-20, -20, config)).toBe(0);
    expect(cellIndexForPosition(20, 20, config)).toBe(config.cellCount - 1);
    expect(cellIndexForPosition(-200, 200, config)).toBe((config.rows - 1) * config.columns);
  });
});

describe('neighbor oracle', () => {
  test.each([256, 1000])('compact-grid counts exactly match all-pairs at %i boids', (count) => {
    const state = initializeBoids({ count, seed: 0xabc01234, worldExtent: 40, scenario: 'field' });
    const grid = buildCompactGrid(state, createGpuGridConfig(40));

    expect(gridNeighborCounts(state, grid, GPU_REFERENCE_DEFAULTS.perceptionRadius)).toEqual(
      allPairsNeighborCounts(state, GPU_REFERENCE_DEFAULTS.perceptionRadius),
    );
  });
});

describe('one-step steering oracle', () => {
  test.each([256, 1000])('compact-grid integration matches all-pairs at %i boids', (count) => {
    const worldExtent = 40;
    const state = initializeBoids({ count, seed: 0xc0ffee, worldExtent, scenario: 'field' });
    const grid = buildCompactGrid(state, createGpuGridConfig(worldExtent));
    const options = {
      ...GPU_REFERENCE_DEFAULTS,
      bounds: { minX: -worldExtent, maxX: worldExtent, minZ: -worldExtent, maxZ: worldExtent },
      deltaSeconds: 1 / 60,
      maxCandidates: Number.POSITIVE_INFINITY,
    };
    const allPairs = stepAllPairs(state, options);
    const compact = stepCompactGrid(state, grid, options);

    expect(compact.neighborsAccepted).toBe(allPairs.neighborsAccepted);
    expect(compact.truncatedBoids).toBe(0);
    expect(allPairs.truncatedBoids).toBe(0);

    for (let index = 0; index < state.positions.length; index += 1) {
      expect(compact.state.positions[index]).toBeCloseTo(allPairs.state.positions[index], 5);
      expect(compact.state.velocities[index]).toBeCloseTo(allPairs.state.velocities[index], 5);
    }
  });

  test('packed vec4 GPU sample comparison preserves x/z components and metadata', () => {
    const count = 32;
    const worldExtent = 20;
    const seed = 314159;
    const initial = initializeBoids({ count, seed, worldExtent, scenario: 'constant' });
    const options = {
      ...GPU_REFERENCE_DEFAULTS,
      bounds: { minX: -worldExtent, maxX: worldExtent, minZ: -worldExtent, maxZ: worldExtent },
      deltaSeconds: 1 / 60,
      dog: { x: 0, z: 0, velocityX: 0, velocityZ: 0, radius: 0, strength: 0 },
      bark: { x: 0, z: 0, directionX: 0, directionZ: -1, radius: 0, strength: 0 },
    };
    const expected = stepCompactGrid(
      initial,
      buildCompactGrid(initial, createGpuGridConfig(worldExtent)),
      options,
    ).state;
    const positions = new Float32Array(count * 4);
    const velocities = new Float32Array(count * 4);
    for (let index = 0; index < count; index += 1) {
      positions[index * 4] = expected.positions[index * 2];
      positions[index * 4 + 1] = 0.24;
      positions[index * 4 + 2] = expected.positions[index * 2 + 1];
      positions[index * 4 + 3] = 1;
      velocities[index * 4] = expected.velocities[index * 2];
      velocities[index * 4 + 2] = expected.velocities[index * 2 + 1];
    }

    const comparison = compareOneStepGpuOracle({
      count,
      stride: 4,
      step: 1,
      seed,
      scenario: 'constant',
      worldExtent,
      delta: 1 / 60,
      positions,
      velocities,
      dog: { position: [0, 0, 0], velocity: [0, 0, 0], radius: 0, strength: 0 },
      bark: { origin: [0, 0, 0], direction: [0, 0, -1], radius: 0, strength: 0 },
    });

    expect(comparison.maximumPositionError).toBe(0);
    expect(comparison.maximumVelocityError).toBe(0);
  });
});
