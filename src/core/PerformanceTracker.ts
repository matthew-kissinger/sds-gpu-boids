export type PerformanceSnapshot = {
  samples: number;
  fps: number;
  frameP50Ms: number;
  frameP95Ms: number;
  frameP99Ms: number;
  computeSubmitP95Ms: number;
  renderSubmitP95Ms: number;
  longTasks: number;
};

const EMPTY: PerformanceSnapshot = {
  samples: 0,
  fps: 0,
  frameP50Ms: 0,
  frameP95Ms: 0,
  frameP99Ms: 0,
  computeSubmitP95Ms: 0,
  renderSubmitP95Ms: 0,
  longTasks: 0,
};

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction));
  return sorted[index] ?? 0;
}
export class PerformanceTracker {
  private readonly frameSamples = new Float32Array(3_600);
  private readonly computeSamples = new Float32Array(3_600);
  private readonly renderSamples = new Float32Array(3_600);
  private writeIndex = 0;
  private sampleCount = 0;
  private lastSnapshotAt = 0;
  private snapshotValue: PerformanceSnapshot = { ...EMPTY };
  private longTasks = 0;
  private readonly observer: PerformanceObserver | null;

  constructor() {
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      this.observer = new PerformanceObserver((list) => {
        this.longTasks += list.getEntries().length;
      });
      this.observer.observe({ entryTypes: ['longtask'] });
    } else {
      this.observer = null;
    }
  }

  add(frameMs: number, computeSubmitMs: number, renderSubmitMs: number): void {
    this.frameSamples[this.writeIndex] = frameMs;
    this.computeSamples[this.writeIndex] = computeSubmitMs;
    this.renderSamples[this.writeIndex] = renderSubmitMs;
    this.writeIndex = (this.writeIndex + 1) % this.frameSamples.length;
    this.sampleCount = Math.min(this.sampleCount + 1, this.frameSamples.length);
  }

  snapshot(now = performance.now()): PerformanceSnapshot {
    if (now - this.lastSnapshotAt < 500 && this.snapshotValue.samples > 0) return this.snapshotValue;
    this.lastSnapshotAt = now;

    const frames: number[] = [];
    const computes: number[] = [];
    const renders: number[] = [];
    for (let i = 0; i < this.sampleCount; i += 1) {
      frames.push(this.frameSamples[i] ?? 0);
      computes.push(this.computeSamples[i] ?? 0);
      renders.push(this.renderSamples[i] ?? 0);
    }
    frames.sort((a, b) => a - b);
    computes.sort((a, b) => a - b);
    renders.sort((a, b) => a - b);
    const p50 = percentile(frames, 0.5);
    this.snapshotValue = {
      samples: this.sampleCount,
      fps: p50 > 0 ? 1_000 / p50 : 0,
      frameP50Ms: p50,
      frameP95Ms: percentile(frames, 0.95),
      frameP99Ms: percentile(frames, 0.99),
      computeSubmitP95Ms: percentile(computes, 0.95),
      renderSubmitP95Ms: percentile(renders, 0.95),
      longTasks: this.longTasks,
    };
    return this.snapshotValue;
  }

  reset(): void {
    this.writeIndex = 0;
    this.sampleCount = 0;
    this.longTasks = 0;
    this.snapshotValue = { ...EMPTY };
  }

  dispose(): void {
    this.observer?.disconnect();
  }
}
