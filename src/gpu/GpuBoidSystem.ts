import * as THREE from 'three/webgpu';
import type StorageBufferNode from 'three/src/nodes/accessors/StorageBufferNode.js';
import type ComputeNode from 'three/src/nodes/gpgpu/ComputeNode.js';
import {
  Break,
  Fn,
  If,
  Loop,
  atomicAdd,
  atomicMax,
  atomicStore,
  float,
  floor,
  instanceIndex,
  int,
  storage,
  uint,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import {
  ALIGNMENT_WEIGHT,
  BOUNDARY_MARGIN,
  BOUNDARY_STRENGTH,
  COHESION_WEIGHT,
  COMPUTE_WORKGROUP_SIZE,
  DEFAULT_BARK_DURATION,
  DEFAULT_BARK_RADIUS,
  DEFAULT_BARK_STRENGTH,
  DEFAULT_DOG_RADIUS,
  DEFAULT_DOG_STRENGTH,
  MAX_BOIDS,
  MAX_CANDIDATES_PER_BOID,
  MAX_GRID_CELLS,
  MAX_GRID_DIMENSION,
  MAX_SPEED,
  METRIC_COUNT,
  METRIC_INDEX,
  MIN_SPEED,
  PERCEPTION_RADIUS,
  SEPARATION_RADIUS,
  SEPARATION_WEIGHT,
} from './constants';
import { createMulberry32 } from './random';
import type { BoidDiagnostics, BoidOracleSample, BoidScenario } from './types';

const VECTOR_STRIDE = 4;
const TAU = Math.PI * 2;
const MIN_WORLD_EXTENT = PERCEPTION_RADIUS * 2;

type UintStorageNode = StorageBufferNode<'uint'>;

export type BoidTuning = {
  separationWeight: number;
  alignmentWeight: number;
  cohesionWeight: number;
  perceptionRadius: number;
  separationRadius: number;
  minSpeed: number;
  maxSpeed: number;
  boundaryMargin: number;
  boundaryStrength: number;
  goalAttraction: number;
};

export const DEFAULT_BOID_TUNING: BoidTuning = {
  separationWeight: SEPARATION_WEIGHT,
  alignmentWeight: ALIGNMENT_WEIGHT,
  cohesionWeight: COHESION_WEIGHT,
  perceptionRadius: PERCEPTION_RADIUS,
  separationRadius: SEPARATION_RADIUS,
  minSpeed: MIN_SPEED,
  maxSpeed: MAX_SPEED,
  boundaryMargin: BOUNDARY_MARGIN,
  boundaryStrength: BOUNDARY_STRENGTH,
  goalAttraction: 0,
};

export class GpuBoidSystem {
  private readonly positionAttribute = new THREE.StorageInstancedBufferAttribute(
    new Float32Array(MAX_BOIDS * VECTOR_STRIDE),
    VECTOR_STRIDE,
  );
  private readonly currentVelocityAttribute = new THREE.StorageInstancedBufferAttribute(
    new Float32Array(MAX_BOIDS * VECTOR_STRIDE),
    VECTOR_STRIDE,
  );
  private readonly nextVelocityAttribute = new THREE.StorageInstancedBufferAttribute(
    new Float32Array(MAX_BOIDS * VECTOR_STRIDE),
    VECTOR_STRIDE,
  );
  private readonly cellCountAttribute = new THREE.StorageInstancedBufferAttribute(
    new Uint32Array(MAX_GRID_CELLS),
    1,
  );
  private readonly scanAAttribute = new THREE.StorageInstancedBufferAttribute(
    new Uint32Array(MAX_GRID_CELLS),
    1,
  );
  private readonly scanBAttribute = new THREE.StorageInstancedBufferAttribute(
    new Uint32Array(MAX_GRID_CELLS),
    1,
  );
  private readonly cellCursorAttribute = new THREE.StorageInstancedBufferAttribute(
    new Uint32Array(MAX_GRID_CELLS),
    1,
  );
  private readonly compactIndexAttribute = new THREE.StorageInstancedBufferAttribute(
    new Uint32Array(MAX_BOIDS),
    1,
  );
  private readonly metricAttribute = new THREE.StorageInstancedBufferAttribute(
    new Uint32Array(METRIC_COUNT),
    1,
  );

  private readonly positionRead = storage(this.positionAttribute, 'vec4', MAX_BOIDS).toReadOnly();
  private readonly positionWrite = storage(this.positionAttribute, 'vec4', MAX_BOIDS);
  private readonly currentVelocityRead = storage(
    this.currentVelocityAttribute,
    'vec4',
    MAX_BOIDS,
  ).toReadOnly();
  private readonly currentVelocityWrite = storage(
    this.currentVelocityAttribute,
    'vec4',
    MAX_BOIDS,
  );
  private readonly nextVelocityRead = storage(
    this.nextVelocityAttribute,
    'vec4',
    MAX_BOIDS,
  ).toReadOnly();
  private readonly nextVelocityWrite = storage(
    this.nextVelocityAttribute,
    'vec4',
    MAX_BOIDS,
  );

  private readonly cellCountAtomic = storage(
    this.cellCountAttribute,
    'uint',
    MAX_GRID_CELLS,
  ).toAtomic();
  private readonly cellCountRead = storage(
    this.cellCountAttribute,
    'uint',
    MAX_GRID_CELLS,
  ).toReadOnly();
  private readonly scanARead = storage(this.scanAAttribute, 'uint', MAX_GRID_CELLS).toReadOnly();
  private readonly scanAWrite = storage(this.scanAAttribute, 'uint', MAX_GRID_CELLS);
  private readonly scanBRead = storage(this.scanBAttribute, 'uint', MAX_GRID_CELLS).toReadOnly();
  private readonly scanBWrite = storage(this.scanBAttribute, 'uint', MAX_GRID_CELLS);
  private readonly cellCursorAtomic = storage(
    this.cellCursorAttribute,
    'uint',
    MAX_GRID_CELLS,
  ).toAtomic();
  private readonly compactIndexRead = storage(
    this.compactIndexAttribute,
    'uint',
    MAX_BOIDS,
  ).toReadOnly();
  private readonly compactIndexWrite = storage(
    this.compactIndexAttribute,
    'uint',
    MAX_BOIDS,
  );
  private readonly metricAtomic = storage(this.metricAttribute, 'uint', METRIC_COUNT).toAtomic();

  private readonly deltaUniform = uniform(1 / 60);
  private readonly worldExtentUniform = uniform(80);
  private readonly gridDimensionUniform = uniform(64, 'uint');
  private readonly cellWidthUniform = uniform(PERCEPTION_RADIUS);
  private readonly dogPositionRadiusUniform = uniform(new THREE.Vector4(0, 0, 0, DEFAULT_DOG_RADIUS));
  private readonly dogVelocityStrengthUniform = uniform(
    new THREE.Vector4(0, 0, 0, DEFAULT_DOG_STRENGTH),
  );
  private readonly barkPositionRadiusUniform = uniform(
    new THREE.Vector4(0, 0, 0, DEFAULT_BARK_RADIUS),
  );
  private readonly barkDirectionStrengthUniform = uniform(new THREE.Vector4(0, 0, -1, 0));
  private readonly goalCenterRadiusUniform = uniform(new THREE.Vector4(0, 0, 0, 12));
  private readonly deepDiagnosticsUniform = uniform(0, 'uint');
  private readonly goalScenarioUniform = uniform(0, 'uint');
  private readonly separationWeightUniform = uniform(SEPARATION_WEIGHT);
  private readonly alignmentWeightUniform = uniform(ALIGNMENT_WEIGHT);
  private readonly cohesionWeightUniform = uniform(COHESION_WEIGHT);
  private readonly perceptionRadiusUniform = uniform(PERCEPTION_RADIUS);
  private readonly separationRadiusUniform = uniform(SEPARATION_RADIUS);
  private readonly minSpeedUniform = uniform(MIN_SPEED);
  private readonly maxSpeedUniform = uniform(MAX_SPEED);
  private readonly boundaryMarginUniform = uniform(BOUNDARY_MARGIN);
  private readonly boundaryStrengthUniform = uniform(BOUNDARY_STRENGTH);
  private readonly goalAttractionUniform = uniform(0);

  private stepPasses: ComputeNode[] = [];
  private scanResultRead: UintStorageNode = this.scanBRead;
  private activeCount = 0;
  private activeWorldExtent = 80;
  private activeGridDimension = 64;
  private activeCellWidth = PERCEPTION_RADIUS;
  private activeSeed = 1;
  private activeScenario: BoidScenario = 'constant';
  private submittedSteps = 0;
  private lastDelta = 1 / 60;
  private barkTimeRemaining = 0;
  private barkDuration = DEFAULT_BARK_DURATION;
  private barkPeakStrength = 0;
  private disposed = false;
  private readbackBusy = false;
  private lastDiagnostics: BoidDiagnostics = this.createEmptyDiagnostics();

  constructor(private readonly renderer: THREE.WebGPURenderer) {}

  get count(): number {
    return this.activeCount;
  }

  get maxCount(): number {
    return MAX_BOIDS;
  }

  get worldExtent(): number {
    return this.activeWorldExtent;
  }

  get gridDimension(): number {
    return this.activeGridDimension;
  }

  get cellWidth(): number {
    return this.activeCellWidth;
  }

  initialize(count: number, scenario: BoidScenario, seed: number, worldExtent: number): void {
    this.assertUsable();
    if (!Number.isInteger(count) || count < 1 || count > MAX_BOIDS) {
      throw new RangeError(`Boid count must be an integer from 1 through ${MAX_BOIDS}.`);
    }
    if (!Number.isFinite(worldExtent) || worldExtent < MIN_WORLD_EXTENT) {
      throw new RangeError(`World extent must be at least ${MIN_WORLD_EXTENT}.`);
    }

    this.activeCount = count;
    this.activeWorldExtent = worldExtent;
    this.activeSeed = seed >>> 0;
    this.activeScenario = scenario;
    this.goalScenarioUniform.value = scenario === 'goal' ? 1 : 0;
    this.submittedSteps = 0;
    this.lastDelta = 1 / 60;
    this.activeGridDimension = Math.max(
      1,
      Math.min(MAX_GRID_DIMENSION, Math.floor((worldExtent * 2) / PERCEPTION_RADIUS)),
    );
    this.activeCellWidth = (worldExtent * 2) / this.activeGridDimension;
    this.worldExtentUniform.value = worldExtent;
    this.gridDimensionUniform.value = this.activeGridDimension;
    this.cellWidthUniform.value = this.activeCellWidth;

    this.seedState(count, scenario, seed, worldExtent);
    this.stepPasses = this.createStepPasses(count);
    this.lastDiagnostics = this.createEmptyDiagnostics();
    this.barkTimeRemaining = 0;
    this.barkDuration = DEFAULT_BARK_DURATION;
    this.barkPeakStrength = 0;
    this.barkDirectionStrengthUniform.value.w = 0;
  }

  reinitialize(count: number, scenario: BoidScenario, seed: number, worldExtent: number): void {
    for (const pass of this.stepPasses) pass.dispose();
    this.stepPasses = [];
    this.initialize(count, scenario, seed, worldExtent);
  }

  setDog(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    radius = DEFAULT_DOG_RADIUS,
    strength = DEFAULT_DOG_STRENGTH,
  ): void {
    this.dogPositionRadiusUniform.value.set(position.x, position.y, position.z, Math.max(0, radius));
    this.dogVelocityStrengthUniform.value.set(
      velocity.x,
      velocity.y,
      velocity.z,
      Math.max(0, strength),
    );
  }

  setBark(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    radius = DEFAULT_BARK_RADIUS,
    strength = DEFAULT_BARK_STRENGTH,
    duration = DEFAULT_BARK_DURATION,
  ): void {
    const directionLength = Math.hypot(direction.x, direction.z);
    const directionX = directionLength > 0.0001 ? direction.x / directionLength : 0;
    const directionZ = directionLength > 0.0001 ? direction.z / directionLength : -1;
    this.barkPositionRadiusUniform.value.set(origin.x, origin.y, origin.z, Math.max(0, radius));
    this.barkDirectionStrengthUniform.value.set(directionX, 0, directionZ, Math.max(0, strength));
    this.barkPeakStrength = Math.max(0, strength);
    this.barkDuration = Math.max(0, duration);
    this.barkTimeRemaining = this.barkDuration;
  }

  setGoal(center: THREE.Vector3, radius: number): void {
    this.goalCenterRadiusUniform.value.set(center.x, center.y, center.z, Math.max(0, radius));
  }

  setDeepDiagnostics(enabled: boolean): void {
    this.deepDiagnosticsUniform.value = enabled ? 1 : 0;
  }

  setTuning(tuning: Partial<BoidTuning>): void {
    if (tuning.separationWeight !== undefined) this.separationWeightUniform.value = Math.max(0, tuning.separationWeight);
    if (tuning.alignmentWeight !== undefined) this.alignmentWeightUniform.value = Math.max(0, tuning.alignmentWeight);
    if (tuning.cohesionWeight !== undefined) this.cohesionWeightUniform.value = Math.max(0, tuning.cohesionWeight);
    if (tuning.perceptionRadius !== undefined) this.perceptionRadiusUniform.value = THREE.MathUtils.clamp(tuning.perceptionRadius, 0.5, this.activeCellWidth);
    if (tuning.separationRadius !== undefined) this.separationRadiusUniform.value = THREE.MathUtils.clamp(tuning.separationRadius, 0.1, this.activeCellWidth);
    const requestedMinSpeed = Math.max(0, tuning.minSpeed ?? this.minSpeedUniform.value);
    const requestedMaxSpeed = Math.max(0.1, tuning.maxSpeed ?? this.maxSpeedUniform.value);
    this.minSpeedUniform.value = Math.min(requestedMinSpeed, requestedMaxSpeed);
    this.maxSpeedUniform.value = Math.max(requestedMinSpeed, requestedMaxSpeed);
    if (tuning.boundaryMargin !== undefined) this.boundaryMarginUniform.value = Math.max(0.5, tuning.boundaryMargin);
    if (tuning.boundaryStrength !== undefined) this.boundaryStrengthUniform.value = Math.max(0, tuning.boundaryStrength);
    if (tuning.goalAttraction !== undefined) this.goalAttractionUniform.value = Math.max(0, tuning.goalAttraction);
  }

  step(delta: number): void {
    this.assertUsable();
    if (this.stepPasses.length === 0) throw new Error('Initialize the boid system before stepping it.');

    const fixedDelta = Math.min(Math.max(delta, 0), 1 / 30);
    this.deltaUniform.value = fixedDelta;
    this.lastDelta = fixedDelta;
    if (this.barkTimeRemaining > 0) {
      this.barkTimeRemaining = Math.max(0, this.barkTimeRemaining - fixedDelta);
      this.barkDirectionStrengthUniform.value.w =
        this.barkPeakStrength * Math.min(1, this.barkTimeRemaining / Math.max(0.0001, this.barkDuration));
    } else {
      this.barkDirectionStrengthUniform.value.w = 0;
    }

    this.renderer.compute(this.stepPasses);
    this.submittedSteps += 1;
  }

  getRenderNodes() {
    return {
      position: this.positionRead.toAttribute().xyz,
      velocity: this.currentVelocityRead.toAttribute().xyz,
    };
  }

  async readDiagnostics(): Promise<BoidDiagnostics> {
    this.assertUsable();
    if (this.activeCount === 0 || this.submittedSteps === 0 || this.readbackBusy) {
      return this.lastDiagnostics;
    }

    this.readbackBusy = true;
    try {
      const activeCellCount = this.activeGridDimension * this.activeGridDimension;
      const [metricBuffer, cellCountBuffer] = await Promise.all([
        this.renderer.getArrayBufferAsync(
          this.metricAttribute,
          null,
          0,
          METRIC_COUNT * Uint32Array.BYTES_PER_ELEMENT,
        ),
        this.renderer.getArrayBufferAsync(
          this.cellCountAttribute,
          null,
          0,
          activeCellCount * Uint32Array.BYTES_PER_ELEMENT,
        ),
      ]);
      if (!(metricBuffer instanceof ArrayBuffer) || !(cellCountBuffer instanceof ArrayBuffer)) {
        throw new Error('Expected ArrayBuffer diagnostic readbacks.');
      }
      const values = new Uint32Array(metricBuffer);
      const cellCounts = new Uint32Array(cellCountBuffer);
      let maxCellOccupancy = 0;
      for (let index = 0; index < cellCounts.length; index += 1) {
        maxCellOccupancy = Math.max(maxCellOccupancy, cellCounts[index] ?? 0);
      }
      this.lastDiagnostics = {
        count: this.activeCount,
        maxCount: MAX_BOIDS,
        gridDimension: this.activeGridDimension,
        cellWidth: this.activeCellWidth,
        worldExtent: this.activeWorldExtent,
        goalCount: values[METRIC_INDEX.goalCount] ?? 0,
        truncatedBoids: values[METRIC_INDEX.truncatedBoids] ?? 0,
        maxCellOccupancy,
        candidatesExamined: values[METRIC_INDEX.candidatesExamined] ?? 0,
        neighborsAccepted: values[METRIC_INDEX.neighborsAccepted] ?? 0,
        maxNeighbors: values[METRIC_INDEX.maxNeighbors] ?? 0,
        invalidIndices: values[METRIC_INDEX.invalidIndices] ?? 0,
        sampledAt: performance.now(),
      };
      return this.lastDiagnostics;
    } finally {
      this.readbackBusy = false;
    }
  }

  async readOracleSample(sampleCount = 256): Promise<BoidOracleSample> {
    this.assertUsable();
    if (this.submittedSteps === 0) {
      throw new Error('Submit at least one boid step before requesting a GPU oracle sample.');
    }
    const count = Math.min(this.activeCount, Math.max(1, Math.floor(sampleCount)));
    const byteCount = count * VECTOR_STRIDE * Float32Array.BYTES_PER_ELEMENT;
    const [positionBuffer, velocityBuffer] = await Promise.all([
      this.renderer.getArrayBufferAsync(this.positionAttribute, null, 0, byteCount),
      this.renderer.getArrayBufferAsync(this.currentVelocityAttribute, null, 0, byteCount),
    ]);
    if (!(positionBuffer instanceof ArrayBuffer) || !(velocityBuffer instanceof ArrayBuffer)) {
      throw new Error('Expected ArrayBuffer oracle readbacks.');
    }
    return {
      count,
      stride: VECTOR_STRIDE,
      step: this.submittedSteps,
      seed: this.activeSeed,
      scenario: this.activeScenario,
      worldExtent: this.activeWorldExtent,
      delta: this.lastDelta,
      positions: new Float32Array(positionBuffer),
      velocities: new Float32Array(velocityBuffer),
      dog: {
        position: [
          this.dogPositionRadiusUniform.value.x,
          this.dogPositionRadiusUniform.value.y,
          this.dogPositionRadiusUniform.value.z,
        ],
        velocity: [
          this.dogVelocityStrengthUniform.value.x,
          this.dogVelocityStrengthUniform.value.y,
          this.dogVelocityStrengthUniform.value.z,
        ],
        radius: this.dogPositionRadiusUniform.value.w,
        strength: this.dogVelocityStrengthUniform.value.w,
      },
      bark: {
        origin: [
          this.barkPositionRadiusUniform.value.x,
          this.barkPositionRadiusUniform.value.y,
          this.barkPositionRadiusUniform.value.z,
        ],
        direction: [
          this.barkDirectionStrengthUniform.value.x,
          this.barkDirectionStrengthUniform.value.y,
          this.barkDirectionStrengthUniform.value.z,
        ],
        radius: this.barkPositionRadiusUniform.value.w,
        strength: this.barkDirectionStrengthUniform.value.w,
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pass of this.stepPasses) pass.dispose();
    this.stepPasses = [];
    for (const attribute of [
      this.positionAttribute,
      this.currentVelocityAttribute,
      this.nextVelocityAttribute,
      this.cellCountAttribute,
      this.scanAAttribute,
      this.scanBAttribute,
      this.cellCursorAttribute,
      this.compactIndexAttribute,
      this.metricAttribute,
    ]) {
      attribute.dispose();
    }
  }

  private createStepPasses(count: number): ComputeNode[] {
    const passes: ComputeNode[] = [];
    passes.push(this.createClearPass());
    passes.push(this.createCountPass(count));

    let source: UintStorageNode = this.cellCountRead;
    for (let offset = 1, passIndex = 0; offset < MAX_GRID_CELLS; offset *= 2, passIndex += 1) {
      const targetWrite: UintStorageNode = passIndex % 2 === 0 ? this.scanAWrite : this.scanBWrite;
      const targetRead: UintStorageNode = passIndex % 2 === 0 ? this.scanARead : this.scanBRead;
      passes.push(this.createScanPass(source, targetWrite, offset));
      source = targetRead;
    }
    this.scanResultRead = source;

    passes.push(this.createScatterPass(count));
    passes.push(this.createFlockPass(count));
    passes.push(this.createIntegratePass(count));
    passes.push(this.createObjectivePass(count));
    return passes;
  }

  private createClearPass(): ComputeNode {
    return Fn(() => {
      const index = instanceIndex;
      atomicStore(this.cellCountAtomic.element(index), uint(0));
      atomicStore(this.cellCursorAtomic.element(index), uint(0));
      this.scanAWrite.element(index).assign(uint(0));
      this.scanBWrite.element(index).assign(uint(0));
      If(index.lessThan(uint(METRIC_COUNT)), () => {
        atomicStore(this.metricAtomic.element(index), uint(0));
      });
    })().compute(MAX_GRID_CELLS, [COMPUTE_WORKGROUP_SIZE]);
  }

  private createCountPass(count: number): ComputeNode {
    return Fn(() => {
      const position = this.positionRead.element(instanceIndex);
      const gridDimension = this.gridDimensionUniform;
      const boundedX = position.x.clamp(
        this.worldExtentUniform.negate(),
        this.worldExtentUniform.sub(0.0001),
      );
      const boundedZ = position.z.clamp(
        this.worldExtentUniform.negate(),
        this.worldExtentUniform.sub(0.0001),
      );
      const cellX = uint(floor(boundedX.add(this.worldExtentUniform).div(this.cellWidthUniform)));
      const cellZ = uint(floor(boundedZ.add(this.worldExtentUniform).div(this.cellWidthUniform)));
      const cellIndex = cellZ.mul(gridDimension).add(cellX);
      atomicAdd(this.cellCountAtomic.element(cellIndex), uint(1));
    })().compute(count, [COMPUTE_WORKGROUP_SIZE]);
  }

  private createScanPass(
    source: UintStorageNode,
    target: UintStorageNode,
    offset: number,
  ): ComputeNode {
    return Fn(() => {
      const index = instanceIndex;
      const value = source.element(index).toVar();
      If(index.greaterThanEqual(uint(offset)), () => {
        value.addAssign(source.element(index.sub(uint(offset))));
      });
      target.element(index).assign(value);
    })().compute(MAX_GRID_CELLS, [COMPUTE_WORKGROUP_SIZE]);
  }

  private createScatterPass(count: number): ComputeNode {
    const scanResult = this.scanResultRead;
    return Fn(() => {
      const position = this.positionRead.element(instanceIndex);
      const gridDimension = this.gridDimensionUniform;
      const boundedX = position.x.clamp(
        this.worldExtentUniform.negate(),
        this.worldExtentUniform.sub(0.0001),
      );
      const boundedZ = position.z.clamp(
        this.worldExtentUniform.negate(),
        this.worldExtentUniform.sub(0.0001),
      );
      const cellX = uint(floor(boundedX.add(this.worldExtentUniform).div(this.cellWidthUniform)));
      const cellZ = uint(floor(boundedZ.add(this.worldExtentUniform).div(this.cellWidthUniform)));
      const cellIndex = cellZ.mul(gridDimension).add(cellX);
      const cellCount = this.cellCountRead.element(cellIndex);
      const cellStart = scanResult.element(cellIndex).sub(cellCount);
      const localIndex = atomicAdd(this.cellCursorAtomic.element(cellIndex), uint(1));
      const compactIndex = cellStart.add(localIndex);
      If(compactIndex.lessThan(uint(count)), () => {
        this.compactIndexWrite.element(compactIndex).assign(instanceIndex);
      }).Else(() => {
        atomicAdd(this.metricAtomic.element(uint(METRIC_INDEX.invalidIndices)), uint(1));
      });
    })().compute(count, [COMPUTE_WORKGROUP_SIZE]);
  }

  private createFlockPass(count: number): ComputeNode {
    const scanResult = this.scanResultRead;
    return Fn(() => {
      const selfIndex = instanceIndex;
      const position = this.positionRead.element(selfIndex);
      const velocity = this.currentVelocityRead.element(selfIndex);
      const gridDimension = this.gridDimensionUniform;
      const boundedX = position.x.clamp(
        this.worldExtentUniform.negate(),
        this.worldExtentUniform.sub(0.0001),
      );
      const boundedZ = position.z.clamp(
        this.worldExtentUniform.negate(),
        this.worldExtentUniform.sub(0.0001),
      );
      const cellX = int(floor(boundedX.add(this.worldExtentUniform).div(this.cellWidthUniform)));
      const cellZ = int(floor(boundedZ.add(this.worldExtentUniform).div(this.cellWidthUniform)));

      const separation = vec3(0).toVar();
      const alignment = vec3(0).toVar();
      const cohesion = vec3(0).toVar();
      const acceleration = vec3(0).toVar();
      const candidateCount = uint(0).toVar();
      const neighborCount = uint(0).toVar();
      const truncated = uint(0).toVar();

      for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const neighborX = cellX.add(int(offsetX));
          const neighborZ = cellZ.add(int(offsetZ));
          const validCell = neighborX
            .greaterThanEqual(int(0))
            .and(neighborZ.greaterThanEqual(int(0)))
            .and(neighborX.lessThan(int(gridDimension)))
            .and(neighborZ.lessThan(int(gridDimension)));

          If(validCell, () => {
            const neighborCell = uint(neighborZ).mul(gridDimension).add(uint(neighborX));
            const cellEntryCount = this.cellCountRead.element(neighborCell);
            const cellEnd = scanResult.element(neighborCell);
            const cellStart = cellEnd.sub(cellEntryCount);

            If(candidateCount.lessThan(uint(MAX_CANDIDATES_PER_BOID)), () => {
              Loop(
                { start: cellStart, end: cellEnd, type: 'uint', condition: '<' },
                ({ i }) => {
                  If(candidateCount.greaterThanEqual(uint(MAX_CANDIDATES_PER_BOID)), () => {
                    truncated.assign(uint(1));
                    Break();
                  });
                  candidateCount.addAssign(uint(1));
                  const otherIndex = this.compactIndexRead.element(i);
                  If(otherIndex.lessThan(uint(count)), () => {
                    If(otherIndex.notEqual(selfIndex), () => {
                      const otherPosition = this.positionRead.element(otherIndex);
                      const delta = position.xyz.sub(otherPosition.xyz);
                      const distanceSquared = delta.dot(delta);
                      If(
                        distanceSquared
                          .greaterThan(float(0.0001))
                          .and(distanceSquared.lessThanEqual(this.perceptionRadiusUniform.mul(this.perceptionRadiusUniform))),
                        () => {
                          alignment.addAssign(this.currentVelocityRead.element(otherIndex).xyz);
                          cohesion.addAssign(otherPosition.xyz);
                          neighborCount.addAssign(uint(1));
                          If(distanceSquared.lessThan(this.separationRadiusUniform.mul(this.separationRadiusUniform)), () => {
                            separation.addAssign(delta.div(distanceSquared.add(0.05)));
                          });
                        },
                      );
                    });
                  }).Else(() => {
                    atomicAdd(this.metricAtomic.element(uint(METRIC_INDEX.invalidIndices)), uint(1));
                  });
                },
              );
            }).Else(() => {
              If(cellEntryCount.greaterThan(uint(0)), () => {
                truncated.assign(uint(1));
              });
            });
          });
        }
      }

      If(neighborCount.greaterThan(uint(0)), () => {
        const reciprocal = float(1).div(float(neighborCount));
        alignment.mulAssign(reciprocal);
        alignment.subAssign(velocity.xyz);
        cohesion.mulAssign(reciprocal);
        cohesion.subAssign(position.xyz);
        acceleration.addAssign(separation.mul(this.separationWeightUniform));
        acceleration.addAssign(alignment.mul(this.alignmentWeightUniform));
        acceleration.addAssign(cohesion.mul(this.cohesionWeightUniform));
      });

      const predictedDog = this.dogPositionRadiusUniform.xyz.add(
        this.dogVelocityStrengthUniform.xyz.mul(0.12),
      );
      const awayFromDog = vec3(
        position.x.sub(predictedDog.x),
        float(0),
        position.z.sub(predictedDog.z),
      );
      const dogDistance = awayFromDog.length();
      If(
        dogDistance
          .greaterThan(0.0001)
          .and(dogDistance.lessThan(this.dogPositionRadiusUniform.w)),
        () => {
          const falloff = float(1).sub(dogDistance.div(this.dogPositionRadiusUniform.w));
          acceleration.addAssign(
            awayFromDog
              .div(dogDistance)
              .mul(falloff)
              .mul(this.dogVelocityStrengthUniform.w),
          );
        },
      );

      const awayFromBark = vec3(
        position.x.sub(this.barkPositionRadiusUniform.x),
        float(0),
        position.z.sub(this.barkPositionRadiusUniform.z),
      );
      const barkDistance = awayFromBark.length();
      If(
        barkDistance
          .greaterThan(0.0001)
          .and(barkDistance.lessThan(this.barkPositionRadiusUniform.w))
          .and(this.barkDirectionStrengthUniform.w.greaterThan(0)),
        () => {
          const barkDirection = awayFromBark.div(barkDistance);
          const directionalWeight = barkDirection
            .dot(this.barkDirectionStrengthUniform.xyz)
            .max(0.2);
          const falloff = float(1).sub(barkDistance.div(this.barkPositionRadiusUniform.w));
          acceleration.addAssign(
            barkDirection
              .mul(directionalWeight)
              .mul(falloff)
              .mul(this.barkDirectionStrengthUniform.w),
          );
        },
      );

      const innerBoundary = this.worldExtentUniform.sub(this.boundaryMarginUniform);
      If(position.x.greaterThan(innerBoundary), () => {
        acceleration.x.subAssign(
          position.x.sub(innerBoundary).div(this.boundaryMarginUniform).mul(this.boundaryStrengthUniform),
        );
      });
      If(position.x.lessThan(innerBoundary.negate()), () => {
        acceleration.x.addAssign(
          innerBoundary.negate().sub(position.x).div(this.boundaryMarginUniform).mul(this.boundaryStrengthUniform),
        );
      });
      If(position.z.greaterThan(innerBoundary), () => {
        acceleration.z.subAssign(
          position.z.sub(innerBoundary).div(this.boundaryMarginUniform).mul(this.boundaryStrengthUniform),
        );
      });
      If(position.z.lessThan(innerBoundary.negate()), () => {
        acceleration.z.addAssign(
          innerBoundary.negate().sub(position.z).div(this.boundaryMarginUniform).mul(this.boundaryStrengthUniform),
        );
      });

      const toGoalAssist = this.goalCenterRadiusUniform.xyz.sub(position.xyz);
      const goalAssistDistance = toGoalAssist.length();
      If(goalAssistDistance.greaterThan(0.001).and(this.goalAttractionUniform.greaterThan(0)), () => {
        acceleration.addAssign(toGoalAssist.div(goalAssistDistance).mul(this.goalAttractionUniform));
      });
      const nextVelocity = velocity.xyz.add(acceleration.mul(this.deltaUniform)).toVar();
      const speed = nextVelocity.length().toVar();
      If(speed.greaterThan(this.maxSpeedUniform), () => {
        nextVelocity.mulAssign(this.maxSpeedUniform.div(speed));
        speed.assign(this.maxSpeedUniform);
      });
      If(speed.greaterThan(0.0001).and(speed.lessThan(this.minSpeedUniform)), () => {
        nextVelocity.mulAssign(this.minSpeedUniform.div(speed));
      });
      If(this.goalScenarioUniform.greaterThan(uint(0)), () => {
        const toGoal = this.goalCenterRadiusUniform.xyz.sub(position.xyz);
        nextVelocity.assign(vec3(toGoal.x.mul(0.35), float(0), toGoal.z.mul(0.35)));
      });
      this.nextVelocityWrite
        .element(selfIndex)
        .assign(vec4(nextVelocity.x, float(0), nextVelocity.z, float(0)));

      If(this.deepDiagnosticsUniform.greaterThan(uint(0)), () => {
        atomicAdd(
          this.metricAtomic.element(uint(METRIC_INDEX.candidatesExamined)),
          candidateCount,
        );
        atomicAdd(
          this.metricAtomic.element(uint(METRIC_INDEX.neighborsAccepted)),
          neighborCount,
        );
        atomicMax(this.metricAtomic.element(uint(METRIC_INDEX.maxNeighbors)), neighborCount);
      });
      If(truncated.greaterThan(uint(0)), () => {
        atomicAdd(this.metricAtomic.element(uint(METRIC_INDEX.truncatedBoids)), uint(1));
      });
    })().compute(count, [COMPUTE_WORKGROUP_SIZE]);
  }

  private createIntegratePass(count: number): ComputeNode {
    return Fn(() => {
      const index = instanceIndex;
      const position = this.positionWrite.element(index).xyz.toVar();
      const velocity = this.nextVelocityRead.element(index).xyz.toVar();
      position.addAssign(velocity.mul(this.deltaUniform));

      If(position.x.greaterThan(this.worldExtentUniform), () => {
        position.x.assign(this.worldExtentUniform);
        velocity.x.mulAssign(-0.55);
      });
      If(position.x.lessThan(this.worldExtentUniform.negate()), () => {
        position.x.assign(this.worldExtentUniform.negate());
        velocity.x.mulAssign(-0.55);
      });
      If(position.z.greaterThan(this.worldExtentUniform), () => {
        position.z.assign(this.worldExtentUniform);
        velocity.z.mulAssign(-0.55);
      });
      If(position.z.lessThan(this.worldExtentUniform.negate()), () => {
        position.z.assign(this.worldExtentUniform.negate());
        velocity.z.mulAssign(-0.55);
      });

      this.positionWrite
        .element(index)
        .assign(vec4(position.x, float(0.24), position.z, float(1)));
      this.currentVelocityWrite
        .element(index)
        .assign(vec4(velocity.x, float(0), velocity.z, float(0)));
    })().compute(count, [COMPUTE_WORKGROUP_SIZE]);
  }

  private createObjectivePass(count: number): ComputeNode {
    return Fn(() => {
      const position = this.positionRead.element(instanceIndex);
      const offset = position.xyz.sub(this.goalCenterRadiusUniform.xyz);
      const radiusSquared = this.goalCenterRadiusUniform.w.mul(this.goalCenterRadiusUniform.w);
      If(offset.dot(offset).lessThanEqual(radiusSquared), () => {
        atomicAdd(this.metricAtomic.element(uint(METRIC_INDEX.goalCount)), uint(1));
      });
    })().compute(count, [COMPUTE_WORKGROUP_SIZE]);
  }

  private seedState(count: number, scenario: BoidScenario, seed: number, worldExtent: number): void {
    const positions = this.positionAttribute.array as Float32Array;
    const currentVelocities = this.currentVelocityAttribute.array as Float32Array;
    const nextVelocities = this.nextVelocityAttribute.array as Float32Array;
    const random = createMulberry32(seed);

    for (let index = 0; index < count; index += 1) {
      let x: number;
      let z: number;
      let direction: number;
      let speed: number;

      if (scenario === 'constant') {
        x = (random() * 2 - 1) * worldExtent * 0.86;
        z = (random() * 2 - 1) * worldExtent * 0.86;
        direction = random() * TAU;
        speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * random();
      } else if (scenario === 'field') {
        x = (random() * 2 - 1) * worldExtent * 0.82;
        z = -worldExtent * 0.2 + (random() * 2 - 1) * worldExtent * 0.58;
        direction = random() * TAU;
        speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * random();
      } else if (scenario === 'herd') {
        const positionAngle = random() * TAU;
        const radius = Math.sqrt(random()) * Math.min(worldExtent * 0.12, 12);
        x = Math.cos(positionAngle) * radius;
        z = Math.sin(positionAngle) * radius;
        direction = random() * TAU;
        speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * random();
      } else {
        const positionAngle = random() * TAU;
        const goalRadius = Math.max(1, this.goalCenterRadiusUniform.value.w);
        const radius = Math.sqrt(random()) * goalRadius * 0.82;
        x = this.goalCenterRadiusUniform.value.x + Math.cos(positionAngle) * radius;
        z = this.goalCenterRadiusUniform.value.z + Math.sin(positionAngle) * radius;
        direction = random() * TAU;
        speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * random();
      }

      const offset = index * VECTOR_STRIDE;
      positions[offset] = x;
      positions[offset + 1] = 0.24;
      positions[offset + 2] = z;
      positions[offset + 3] = 1;
      currentVelocities[offset] = Math.cos(direction) * speed;
      currentVelocities[offset + 1] = 0;
      currentVelocities[offset + 2] = Math.sin(direction) * speed;
      currentVelocities[offset + 3] = 0;
      nextVelocities[offset] = currentVelocities[offset];
      nextVelocities[offset + 1] = 0;
      nextVelocities[offset + 2] = currentVelocities[offset + 2];
      nextVelocities[offset + 3] = 0;
    }

    this.positionAttribute.needsUpdate = true;
    this.currentVelocityAttribute.needsUpdate = true;
    this.nextVelocityAttribute.needsUpdate = true;
  }

  private createEmptyDiagnostics(): BoidDiagnostics {
    return {
      count: this.activeCount,
      maxCount: MAX_BOIDS,
      gridDimension: this.activeGridDimension,
      cellWidth: this.activeCellWidth,
      worldExtent: this.activeWorldExtent,
      goalCount: 0,
      truncatedBoids: 0,
      maxCellOccupancy: 0,
      candidatesExamined: 0,
      neighborsAccepted: 0,
      maxNeighbors: 0,
      invalidIndices: 0,
      sampledAt: 0,
    };
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('GpuBoidSystem has been disposed.');
  }
}
