export const MAX_BOIDS = 100_000;
export const MAX_GRID_DIMENSION = 64;
export const MAX_GRID_CELLS = MAX_GRID_DIMENSION * MAX_GRID_DIMENSION;
export const COMPUTE_WORKGROUP_SIZE = 128;
export const MAX_CANDIDATES_PER_BOID = 512;

export const PERCEPTION_RADIUS = 2.5;
export const SEPARATION_RADIUS = 0.85;
export const MIN_SPEED = 1.4;
export const MAX_SPEED = 4.8;

export const SEPARATION_WEIGHT = 1.8;
export const ALIGNMENT_WEIGHT = 0.75;
export const COHESION_WEIGHT = 0.32;
export const BOUNDARY_MARGIN = 4;
export const BOUNDARY_STRENGTH = 7;

export const DEFAULT_DOG_RADIUS = 8;
export const DEFAULT_DOG_STRENGTH = 18;
export const DEFAULT_BARK_RADIUS = 14;
export const DEFAULT_BARK_STRENGTH = 28;
export const DEFAULT_BARK_DURATION = 0.35;

export const METRIC_INDEX = {
  goalCount: 0,
  truncatedBoids: 1,
  maxCellOccupancy: 2,
  candidatesExamined: 3,
  neighborsAccepted: 4,
  maxNeighbors: 5,
  invalidIndices: 6,
} as const;

export const METRIC_COUNT = 7;
