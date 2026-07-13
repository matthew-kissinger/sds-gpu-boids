export type BoidScenario = 'constant' | 'field' | 'herd' | 'goal';

export type Bounds2D = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type BoidState = {
  count: number;
  positions: Float32Array;
  velocities: Float32Array;
};

export type GridConfig = Bounds2D & {
  cellSize: number;
  columns: number;
  rows: number;
  cellCount: number;
};

export type CompactGrid = {
  config: GridConfig;
  counts: Uint32Array;
  offsets: Uint32Array;
  indices: Uint32Array;
  boidCells: Uint32Array;
};

export type InitialStateOptions = {
  count: number;
  seed: number;
  worldExtent: number;
  scenario?: BoidScenario;
  minSpeed?: number;
  maxSpeed?: number;
};

export type SteeringOptions = {
  perceptionRadius: number;
  separationRadius: number;
  separationWeight: number;
  alignmentWeight: number;
  cohesionWeight: number;
  minSpeed: number;
  maxSpeed: number;
  deltaSeconds: number;
  bounds: Bounds2D;
  maxCandidates?: number;
  boundaryMargin?: number;
  boundaryStrength?: number;
  dog?: RadialInfluencer;
  bark?: DirectionalInfluencer;
};

export type RadialInfluencer = {
  x: number;
  z: number;
  velocityX: number;
  velocityZ: number;
  radius: number;
  strength: number;
};

export type DirectionalInfluencer = {
  x: number;
  z: number;
  directionX: number;
  directionZ: number;
  radius: number;
  strength: number;
};

export type StepResult = {
  state: BoidState;
  candidatesExamined: number;
  neighborsAccepted: number;
  truncatedBoids: number;
};

export type GpuOracleSample = {
  count: number;
  stride: 4;
  step: number;
  seed: number;
  scenario: BoidScenario;
  worldExtent: number;
  delta: number;
  positions: ArrayLike<number>;
  velocities: ArrayLike<number>;
  dog: {
    position: readonly [number, number, number];
    velocity: readonly [number, number, number];
    radius: number;
    strength: number;
  };
  bark: {
    origin: readonly [number, number, number];
    direction: readonly [number, number, number];
    radius: number;
    strength: number;
  };
};

export type OracleComparison = {
  count: number;
  maximumPositionError: number;
  maximumVelocityError: number;
  rootMeanSquarePositionError: number;
  rootMeanSquareVelocityError: number;
  cpu: BoidState;
  gpu: BoidState;
};

export const GPU_REFERENCE_DEFAULTS = {
  perceptionRadius: 2.5,
  separationRadius: 0.85,
  separationWeight: 1.8,
  alignmentWeight: 0.75,
  cohesionWeight: 0.32,
  minSpeed: 1.4,
  maxSpeed: 4.8,
  maxCandidates: 512,
  boundaryMargin: 4,
  boundaryStrength: 7,
} as const;

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function initializeBoids(options: InitialStateOptions): BoidState {
  const {
    count,
    seed,
    worldExtent,
    scenario = 'constant',
    minSpeed = GPU_REFERENCE_DEFAULTS.minSpeed,
    maxSpeed = GPU_REFERENCE_DEFAULTS.maxSpeed,
  } = options;

  if (!Number.isInteger(count) || count < 0) throw new Error('count must be a non-negative integer');
  if (!(worldExtent > 0)) throw new Error('worldExtent must be positive');

  const random = mulberry32(seed);
  const positions = new Float32Array(count * 2);
  const velocities = new Float32Array(count * 2);

  for (let index = 0; index < count; index += 1) {
    let x: number;
    let z: number;
    let velocityAngle: number;

    if (scenario === 'herd') {
      const positionAngle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * Math.min(worldExtent * 0.12, 12);
      x = Math.cos(positionAngle) * radius;
      z = Math.sin(positionAngle) * radius;
      velocityAngle = random() * Math.PI * 2;
    } else if (scenario === 'goal') {
      const positionAngle = random() * Math.PI * 2;
      const goalRadius = Math.min(12, worldExtent * 0.18);
      const radius = Math.sqrt(random()) * goalRadius * 0.82;
      x = worldExtent * 0.55 + Math.cos(positionAngle) * radius;
      z = Math.sin(positionAngle) * radius;
      velocityAngle = random() * Math.PI * 2;
    } else if (scenario === 'field') {
      x = (random() * 2 - 1) * worldExtent * 0.82;
      z = -worldExtent * 0.2 + (random() * 2 - 1) * worldExtent * 0.58;
      velocityAngle = random() * Math.PI * 2;
    } else {
      x = (random() * 2 - 1) * worldExtent * 0.86;
      z = (random() * 2 - 1) * worldExtent * 0.86;
      velocityAngle = random() * Math.PI * 2;
    }

    const speed = minSpeed + (maxSpeed - minSpeed) * random();
    const offset = index * 2;
    positions[offset] = x;
    positions[offset + 1] = z;
    velocities[offset] = Math.cos(velocityAngle) * speed;
    velocities[offset + 1] = Math.sin(velocityAngle) * speed;
  }

  return { count, positions, velocities };
}

export function createGridConfig(bounds: Bounds2D, cellSize: number): GridConfig {
  if (!(cellSize > 0)) throw new Error('cellSize must be positive');
  if (!(bounds.maxX > bounds.minX) || !(bounds.maxZ > bounds.minZ)) {
    throw new Error('bounds must have positive area');
  }

  const columns = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellSize));
  const rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cellSize));
  return { ...bounds, cellSize, columns, rows, cellCount: columns * rows };
}

export function createGpuGridConfig(worldExtent: number): GridConfig {
  const dimension = Math.min(
    64,
    Math.max(1, Math.floor((worldExtent * 2) / GPU_REFERENCE_DEFAULTS.perceptionRadius)),
  );
  const cellSize = (worldExtent * 2) / dimension;
  return {
    minX: -worldExtent,
    maxX: worldExtent,
    minZ: -worldExtent,
    maxZ: worldExtent,
    cellSize,
    columns: dimension,
    rows: dimension,
    cellCount: dimension * dimension,
  };
}

export function cellIndexForPosition(x: number, z: number, config: GridConfig): number {
  const cellX = clampInteger(Math.floor((x - config.minX) / config.cellSize), 0, config.columns - 1);
  const cellZ = clampInteger(Math.floor((z - config.minZ) / config.cellSize), 0, config.rows - 1);
  return cellZ * config.columns + cellX;
}

export function exclusiveScanCounts(counts: Uint32Array): Uint32Array {
  const offsets = new Uint32Array(counts.length + 1);
  let sum = 0;
  for (let index = 0; index < counts.length; index += 1) {
    offsets[index] = sum;
    sum += counts[index];
  }
  offsets[counts.length] = sum;
  return offsets;
}

export function buildCompactGrid(state: BoidState, config: GridConfig): CompactGrid {
  assertState(state);
  const counts = new Uint32Array(config.cellCount);
  const boidCells = new Uint32Array(state.count);

  for (let index = 0; index < state.count; index += 1) {
    const offset = index * 2;
    const cell = cellIndexForPosition(state.positions[offset], state.positions[offset + 1], config);
    boidCells[index] = cell;
    counts[cell] += 1;
  }

  const offsets = exclusiveScanCounts(counts);
  const cursors = offsets.slice(0, config.cellCount);
  const indices = new Uint32Array(state.count);

  for (let index = 0; index < state.count; index += 1) {
    const cell = boidCells[index];
    indices[cursors[cell]] = index;
    cursors[cell] += 1;
  }

  return { config, counts, offsets, indices, boidCells };
}

export function allPairsNeighborCounts(state: BoidState, radius: number): Uint32Array {
  assertState(state);
  const counts = new Uint32Array(state.count);
  const radiusSquared = radius * radius;

  for (let index = 0; index < state.count; index += 1) {
    const selfOffset = index * 2;
    for (let other = 0; other < state.count; other += 1) {
      if (other === index) continue;
      const otherOffset = other * 2;
      const dx = state.positions[otherOffset] - state.positions[selfOffset];
      const dz = state.positions[otherOffset + 1] - state.positions[selfOffset + 1];
      if (dx * dx + dz * dz <= radiusSquared) counts[index] += 1;
    }
  }

  return counts;
}

export function gridNeighborCounts(state: BoidState, grid: CompactGrid, radius: number): Uint32Array {
  assertState(state);
  const counts = new Uint32Array(state.count);

  for (let index = 0; index < state.count; index += 1) {
    forEachGridCandidate(state, grid, index, radius, (other, distanceSquared) => {
      if (other !== index && distanceSquared <= radius * radius) counts[index] += 1;
      return true;
    });
  }

  return counts;
}

export function unpackGpuOracleState(sample: GpuOracleSample): BoidState {
  if (sample.stride !== 4) throw new Error(`expected GPU oracle stride 4, received ${sample.stride}`);
  if (sample.positions.length < sample.count * sample.stride || sample.velocities.length < sample.count * sample.stride) {
    throw new Error('GPU oracle arrays are shorter than the declared count and stride');
  }

  const positions = new Float32Array(sample.count * 2);
  const velocities = new Float32Array(sample.count * 2);
  for (let index = 0; index < sample.count; index += 1) {
    const packedOffset = index * sample.stride;
    const flatOffset = index * 2;
    positions[flatOffset] = sample.positions[packedOffset];
    positions[flatOffset + 1] = sample.positions[packedOffset + 2];
    velocities[flatOffset] = sample.velocities[packedOffset];
    velocities[flatOffset + 1] = sample.velocities[packedOffset + 2];
  }
  return { count: sample.count, positions, velocities };
}

export function compareOneStepGpuOracle(sample: GpuOracleSample): OracleComparison {
  if (sample.step !== 1) {
    throw new Error(`one-step comparison requires sample.step === 1, received ${sample.step}`);
  }
  if (sample.scenario === 'goal') {
    throw new Error('goal samples use the objective-demo centering branch and are not generic flock oracle samples');
  }

  const initial = initializeBoids({
    count: sample.count,
    seed: sample.seed,
    scenario: sample.scenario,
    worldExtent: sample.worldExtent,
  });
  const cpu = stepCompactGrid(initial, buildCompactGrid(initial, createGpuGridConfig(sample.worldExtent)), {
    ...GPU_REFERENCE_DEFAULTS,
    deltaSeconds: sample.delta,
    bounds: {
      minX: -sample.worldExtent,
      maxX: sample.worldExtent,
      minZ: -sample.worldExtent,
      maxZ: sample.worldExtent,
    },
    dog: {
      x: sample.dog.position[0],
      z: sample.dog.position[2],
      velocityX: sample.dog.velocity[0],
      velocityZ: sample.dog.velocity[2],
      radius: sample.dog.radius,
      strength: sample.dog.strength,
    },
    bark: {
      x: sample.bark.origin[0],
      z: sample.bark.origin[2],
      directionX: sample.bark.direction[0],
      directionZ: sample.bark.direction[2],
      radius: sample.bark.radius,
      strength: sample.bark.strength,
    },
  }).state;
  const gpu = unpackGpuOracleState(sample);
  let maximumPositionError = 0;
  let maximumVelocityError = 0;
  let squaredPositionError = 0;
  let squaredVelocityError = 0;

  for (let index = 0; index < cpu.positions.length; index += 1) {
    const positionError = Math.abs(cpu.positions[index] - gpu.positions[index]);
    const velocityError = Math.abs(cpu.velocities[index] - gpu.velocities[index]);
    maximumPositionError = Math.max(maximumPositionError, positionError);
    maximumVelocityError = Math.max(maximumVelocityError, velocityError);
    squaredPositionError += positionError * positionError;
    squaredVelocityError += velocityError * velocityError;
  }

  return {
    count: sample.count,
    maximumPositionError,
    maximumVelocityError,
    rootMeanSquarePositionError: Math.sqrt(squaredPositionError / cpu.positions.length),
    rootMeanSquareVelocityError: Math.sqrt(squaredVelocityError / cpu.velocities.length),
    cpu,
    gpu,
  };
}

export function stepAllPairs(state: BoidState, options: SteeringOptions): StepResult {
  return stepWithCandidates(state, options, (_index, visit) => {
    for (let other = 0; other < state.count; other += 1) {
      if (!visit(other)) break;
    }
  });
}

export function stepCompactGrid(
  state: BoidState,
  grid: CompactGrid,
  options: SteeringOptions,
): StepResult {
  return stepWithCandidates(state, options, (index, visit) => {
    forEachGridCandidate(state, grid, index, options.perceptionRadius, (other) => {
      return visit(other);
    });
  });
}

type CandidateVisitor = (other: number) => boolean;
type CandidateSource = (index: number, visit: CandidateVisitor) => void;

function stepWithCandidates(
  state: BoidState,
  options: SteeringOptions,
  candidates: CandidateSource,
): StepResult {
  assertState(state);
  const nextPositions = new Float32Array(state.positions.length);
  const nextVelocities = new Float32Array(state.velocities.length);
  const perceptionSquared = options.perceptionRadius * options.perceptionRadius;
  const separationSquared = options.separationRadius * options.separationRadius;
  const maxCandidates = options.maxCandidates ?? Number.POSITIVE_INFINITY;
  let candidatesExamined = 0;
  let neighborsAccepted = 0;
  let truncatedBoids = 0;

  for (let index = 0; index < state.count; index += 1) {
    const selfOffset = index * 2;
    const selfX = state.positions[selfOffset];
    const selfZ = state.positions[selfOffset + 1];
    const selfVelocityX = state.velocities[selfOffset];
    const selfVelocityZ = state.velocities[selfOffset + 1];
    let separationX = 0;
    let separationZ = 0;
    let alignmentX = 0;
    let alignmentZ = 0;
    let cohesionX = 0;
    let cohesionZ = 0;
    let accepted = 0;
    let examined = 0;
    let wasTruncated = false;

    candidates(index, (other) => {
      if (examined >= maxCandidates) {
        wasTruncated = true;
        return false;
      }

      examined += 1;
      if (other === index) return true;
      const otherOffset = other * 2;
      const dx = state.positions[otherOffset] - selfX;
      const dz = state.positions[otherOffset + 1] - selfZ;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared > perceptionSquared) return true;

      accepted += 1;
      alignmentX += state.velocities[otherOffset];
      alignmentZ += state.velocities[otherOffset + 1];
      cohesionX += state.positions[otherOffset];
      cohesionZ += state.positions[otherOffset + 1];
      if (distanceSquared < separationSquared) {
        const denominator = distanceSquared + 0.05;
        separationX -= dx / denominator;
        separationZ -= dz / denominator;
      }
      return true;
    });

    candidatesExamined += examined;
    neighborsAccepted += accepted;
    if (wasTruncated) truncatedBoids += 1;

    let accelerationX = separationX * options.separationWeight;
    let accelerationZ = separationZ * options.separationWeight;
    if (accepted > 0) {
      const inverseCount = 1 / accepted;
      accelerationX += (alignmentX * inverseCount - selfVelocityX) * options.alignmentWeight;
      accelerationZ += (alignmentZ * inverseCount - selfVelocityZ) * options.alignmentWeight;
      accelerationX += (cohesionX * inverseCount - selfX) * options.cohesionWeight;
      accelerationZ += (cohesionZ * inverseCount - selfZ) * options.cohesionWeight;
    }

    if (options.dog && options.dog.radius > 0 && options.dog.strength > 0) {
      const predictedX = options.dog.x + options.dog.velocityX * 0.12;
      const predictedZ = options.dog.z + options.dog.velocityZ * 0.12;
      const awayX = selfX - predictedX;
      const awayZ = selfZ - predictedZ;
      const distance = Math.hypot(awayX, awayZ);
      if (distance > 0.0001 && distance < options.dog.radius) {
        const influence = (1 - distance / options.dog.radius) * options.dog.strength / distance;
        accelerationX += awayX * influence;
        accelerationZ += awayZ * influence;
      }
    }

    if (options.bark && options.bark.radius > 0 && options.bark.strength > 0) {
      const awayX = selfX - options.bark.x;
      const awayZ = selfZ - options.bark.z;
      const distance = Math.hypot(awayX, awayZ);
      if (distance > 0.0001 && distance < options.bark.radius) {
        const normalX = awayX / distance;
        const normalZ = awayZ / distance;
        const directionalWeight = Math.max(
          0.2,
          normalX * options.bark.directionX + normalZ * options.bark.directionZ,
        );
        const influence = directionalWeight
          * (1 - distance / options.bark.radius)
          * options.bark.strength;
        accelerationX += normalX * influence;
        accelerationZ += normalZ * influence;
      }
    }

    const boundaryMargin = options.boundaryMargin ?? GPU_REFERENCE_DEFAULTS.boundaryMargin;
    const boundaryStrength = options.boundaryStrength ?? GPU_REFERENCE_DEFAULTS.boundaryStrength;
    const innerMaxX = options.bounds.maxX - boundaryMargin;
    const innerMinX = options.bounds.minX + boundaryMargin;
    const innerMaxZ = options.bounds.maxZ - boundaryMargin;
    const innerMinZ = options.bounds.minZ + boundaryMargin;
    if (selfX > innerMaxX) accelerationX -= (selfX - innerMaxX) / boundaryMargin * boundaryStrength;
    if (selfX < innerMinX) accelerationX += (innerMinX - selfX) / boundaryMargin * boundaryStrength;
    if (selfZ > innerMaxZ) accelerationZ -= (selfZ - innerMaxZ) / boundaryMargin * boundaryStrength;
    if (selfZ < innerMinZ) accelerationZ += (innerMinZ - selfZ) / boundaryMargin * boundaryStrength;

    let velocityX = selfVelocityX + accelerationX * options.deltaSeconds;
    let velocityZ = selfVelocityZ + accelerationZ * options.deltaSeconds;
    const velocityLength = Math.hypot(velocityX, velocityZ);
    if (velocityLength > options.maxSpeed) {
      const scale = options.maxSpeed / velocityLength;
      velocityX *= scale;
      velocityZ *= scale;
    } else if (velocityLength > 0.0001 && velocityLength < options.minSpeed) {
      const scale = options.minSpeed / velocityLength;
      velocityX *= scale;
      velocityZ *= scale;
    }

    let positionX = selfX + velocityX * options.deltaSeconds;
    let positionZ = selfZ + velocityZ * options.deltaSeconds;
    if (positionX < options.bounds.minX) {
      positionX = options.bounds.minX;
      velocityX *= -0.55;
    } else if (positionX > options.bounds.maxX) {
      positionX = options.bounds.maxX;
      velocityX *= -0.55;
    }
    if (positionZ < options.bounds.minZ) {
      positionZ = options.bounds.minZ;
      velocityZ *= -0.55;
    } else if (positionZ > options.bounds.maxZ) {
      positionZ = options.bounds.maxZ;
      velocityZ *= -0.55;
    }

    nextPositions[selfOffset] = positionX;
    nextPositions[selfOffset + 1] = positionZ;
    nextVelocities[selfOffset] = velocityX;
    nextVelocities[selfOffset + 1] = velocityZ;
  }

  return {
    state: { count: state.count, positions: nextPositions, velocities: nextVelocities },
    candidatesExamined,
    neighborsAccepted,
    truncatedBoids,
  };
}

function forEachGridCandidate(
  state: BoidState,
  grid: CompactGrid,
  index: number,
  radius: number,
  visit: (other: number, distanceSquared: number) => boolean,
): void {
  const config = grid.config;
  const selfOffset = index * 2;
  const selfX = state.positions[selfOffset];
  const selfZ = state.positions[selfOffset + 1];
  const centerCell = grid.boidCells[index];
  const centerX = centerCell % config.columns;
  const centerZ = Math.floor(centerCell / config.columns);
  const cellRange = Math.ceil(radius / config.cellSize);

  for (let cellZ = Math.max(0, centerZ - cellRange); cellZ <= Math.min(config.rows - 1, centerZ + cellRange); cellZ += 1) {
    for (let cellX = Math.max(0, centerX - cellRange); cellX <= Math.min(config.columns - 1, centerX + cellRange); cellX += 1) {
      const cell = cellZ * config.columns + cellX;
      for (let cursor = grid.offsets[cell]; cursor < grid.offsets[cell + 1]; cursor += 1) {
        const other = grid.indices[cursor];
        const otherOffset = other * 2;
        const dx = state.positions[otherOffset] - selfX;
        const dz = state.positions[otherOffset + 1] - selfZ;
        if (!visit(other, dx * dx + dz * dz)) return;
      }
    }
  }
}

function assertState(state: BoidState): void {
  if (state.positions.length !== state.count * 2 || state.velocities.length !== state.count * 2) {
    throw new Error('state arrays must contain two components per boid');
  }
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
