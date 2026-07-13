export type BoidScenario = 'constant' | 'field' | 'herd' | 'goal';

export type BoidDiagnostics = {
  count: number;
  maxCount: number;
  gridDimension: number;
  cellWidth: number;
  worldExtent: number;
  goalCount: number;
  truncatedBoids: number;
  maxCellOccupancy: number;
  candidatesExamined: number;
  neighborsAccepted: number;
  maxNeighbors: number;
  invalidIndices: number;
  sampledAt: number;
};

export type BoidOracleSample = {
  count: number;
  stride: 4;
  step: number;
  seed: number;
  scenario: BoidScenario;
  worldExtent: number;
  delta: number;
  positions: Float32Array;
  velocities: Float32Array;
  dog: {
    position: [number, number, number];
    velocity: [number, number, number];
    radius: number;
    strength: number;
  };
  bark: {
    origin: [number, number, number];
    direction: [number, number, number];
    radius: number;
    strength: number;
  };
};
