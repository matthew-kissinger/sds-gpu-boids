export type LoopFrame = {
  deltaSeconds: number;
  elapsedSeconds: number;
  interpolation: number;
  substeps: number;
  droppedSteps: number;
  frameMs: number;
};

export class Loop {
  private frameId = 0;
  private lastTime = 0;
  private elapsed = 0;
  private accumulator = 0;
  private running = false;
  private droppedSteps = 0;
  private readonly frame: LoopFrame = {
    deltaSeconds: 0,
    elapsedSeconds: 0,
    interpolation: 0,
    substeps: 0,
    droppedSteps: 0,
    frameMs: 0,
  };

  constructor(
    private readonly fixedUpdate: (fixedDeltaSeconds: number) => void,
    private readonly update: (frame: LoopFrame) => void,
    private readonly render: () => void,
    private readonly fixedDeltaSeconds = 1 / 60,
    private readonly maxSubsteps = 3,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.frameId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }

  resetClock(): void {
    this.lastTime = performance.now();
    this.accumulator = 0;
  }

  private readonly tick = (time: number) => {
    if (!this.running) return;
    const frameStart = performance.now();
    const deltaSeconds = Math.min(Math.max((time - this.lastTime) / 1000, 0), 0.1);
    this.lastTime = time;
    this.elapsed += deltaSeconds;
    this.accumulator += deltaSeconds;

    let substeps = 0;
    while (this.accumulator >= this.fixedDeltaSeconds && substeps < this.maxSubsteps) {
      this.fixedUpdate(this.fixedDeltaSeconds);
      this.accumulator -= this.fixedDeltaSeconds;
      substeps += 1;
    }

    if (this.accumulator >= this.fixedDeltaSeconds) {
      const dropped = Math.floor(this.accumulator / this.fixedDeltaSeconds);
      this.droppedSteps += dropped;
      this.accumulator -= dropped * this.fixedDeltaSeconds;
    }

    this.frame.deltaSeconds = deltaSeconds;
    this.frame.elapsedSeconds = this.elapsed;
    this.frame.interpolation = this.accumulator / this.fixedDeltaSeconds;
    this.frame.substeps = substeps;
    this.frame.droppedSteps = this.droppedSteps;
    this.frame.frameMs = performance.now() - frameStart;
    this.update(this.frame);
    this.render();
    this.frameId = requestAnimationFrame(this.tick);
  };
}
