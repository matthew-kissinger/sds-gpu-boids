import * as THREE from 'three/webgpu';
import { COUNT_LADDER, readConfig, worldExtentFor, type PrototypeConfig, type ScenarioId } from '../core/Config';
import { InputController } from '../core/InputController';
import { Loop, type LoopFrame } from '../core/Loop';
import { PerformanceTracker } from '../core/PerformanceTracker';
import {
  createRenderer,
  resizeRenderer,
  type RendererBundle,
  type WebGpuCapabilityReport,
} from '../core/Renderer';
import { Dog, type ArenaBounds } from '../entities/Dog';
import {
  GpuBoidSystem,
  MAX_CANDIDATES_PER_BOID,
  type BoidDiagnostics,
} from '../gpu';
import { FlockRenderer } from '../render/FlockRenderer';
import { CameraRig } from '../systems/CameraRig';
import { Hud, type HudState, type SimulationScenario } from '../systems/Hud';
import { World } from '../world/World';

const GOAL_FRACTION = 0.72;
const GOAL_HOLD_SECONDS = 2.5;
const DIAGNOSTIC_INTERVAL_SECONDS = 0.25;

export class Game {
  static async create(canvas: HTMLCanvasElement): Promise<Game> {
    let game: Game | undefined;
    const bundle = await createRenderer(canvas, (info) => game?.handleDeviceLost(info));
    game = new Game(canvas, bundle);
    return game;
  }

  private readonly renderer: THREE.WebGPURenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(46, 1, 0.15, 500);
  private readonly config: PrototypeConfig = readConfig();
  private readonly boids: GpuBoidSystem;
  private readonly flock: FlockRenderer;
  private readonly world: World;
  private readonly dog = new Dog();
  private readonly input: InputController;
  private readonly cameraRig = new CameraRig(this.camera);
  private readonly hud: Hud;
  private readonly performance = new PerformanceTracker();
  private readonly movement = new THREE.Vector2();
  private readonly goalPosition = new THREE.Vector3();
  private readonly dogStart = new THREE.Vector3();
  private readonly arenaBounds: ArenaBounds = { halfWidth: 46, halfDepth: 46 };
  private readonly loop: Loop;
  private readonly adapterLabel: string;
  private readonly capability: WebGpuCapabilityReport;

  private diagnostics: BoidDiagnostics | null = null;
  private simulationElapsed = 0;
  private lastDiagnosticRequestAt = -Infinity;
  private readbackState = 'warming';
  private readbackPending = false;
  private goalCount = 0;
  private holdProgress = 0;
  private paused = false;
  private won = false;
  private fatalError: string | null = null;
  private computeSubmitMs = 0;
  private lastRenderSubmitMs = 0;
  private lastComputeSubmitMs = 0;
  private timestampPending = false;
  private lastTimestampRequestAt = -Infinity;
  private gpuComputeMs = 0;
  private gpuRenderMs = 0;
  private gpuTimingMeasured = false;
  private frame = 0;
  private disposed = false;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    bundle: RendererBundle,
  ) {
    this.renderer = bundle.renderer;
    this.capability = bundle.capability;
    this.adapterLabel = this.formatAdapter(bundle);
    this.scene.background = new THREE.Color('#b7c68b');
    this.scene.fog = new THREE.Fog('#b7c68b', 62, 150);

    this.world = new World(this.scene);
    this.boids = new GpuBoidSystem(this.renderer);
    this.boids.setDeepDiagnostics(this.config.deepDiagnostics);
    this.configureSimulation(false);
    this.flock = new FlockRenderer(this.boids);
    this.scene.add(this.flock.mesh, this.dog.group);

    this.input = new InputController(
      this.getElement('#touch-stick'),
      this.getElement('#touch-knob'),
      this.getElement('#bark-button'),
    );
    this.hud = new Hud({
      onCountChange: (count) => this.setCount(count),
      onScenarioChange: (scenario) => this.setScenario(scenario),
      onPause: () => this.togglePause(),
      onRestart: () => this.restart(),
    });

    this.loop = new Loop(
      (delta) => this.fixedUpdate(delta),
      (frame) => this.update(frame),
      () => this.render(),
      1 / 60,
      3,
    );

    this.resetPlayerAndCamera();
    resizeRenderer(this.renderer, this.camera, this.config.maxDpr);
    this.installTestHooks();
    this.publishDiagnostics();
  }

  start(): void {
    if (this.config.manualStep) {
      this.fixedUpdate(1 / 60);
      this.render();
      this.publishDiagnostics();
      return;
    }
    this.loop.start();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    this.input.dispose();
    this.hud.dispose();
    this.dog.dispose();
    this.flock.dispose();
    this.boids.dispose();
    this.world.dispose();
    this.performance.dispose();
    this.renderer.dispose();
    window.removeEventListener('keydown', this.onGlobalKeyDown);
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.render_game_to_text = undefined;
    window.advanceTime = undefined;
    window.__GPU_BOID_ORACLE__ = undefined;
  }

  private fixedUpdate(delta: number): void {
    if (this.paused || this.won || this.fatalError) return;
    this.simulationElapsed += delta;
    this.input.readMovement(this.movement);
    this.dog.update(delta, this.simulationElapsed, this.movement, this.arenaBounds);

    if (this.input.consumeBarkPressed() && this.dog.tryBark()) {
      this.boids.setBark(this.dog.group.position, this.dog.forward);
      this.hud.flashBark();
    }

    this.boids.setDog(this.dog.group.position, this.dog.velocity);
    if (!this.config.goalDemo || this.simulationElapsed <= delta) {
      const computeStart = performance.now();
      this.boids.step(delta);
      this.computeSubmitMs += performance.now() - computeStart;
    }
  }

  private update(frame: LoopFrame): void {
    this.frame += 1;
    const resized = resizeRenderer(this.renderer, this.camera, this.config.maxDpr);
    if (resized) this.cameraRig.setViewport(this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));

    if (this.input.consumePausePressed()) this.togglePause();
    if (this.input.consumeRestartPressed()) this.restart();

    this.cameraRig.update(frame.deltaSeconds, this.dog.group.position, this.dog.velocity);
    const goalFraction = this.config.count > 0 ? this.goalCount / this.config.count : 0;
    if (!this.paused && !this.won && !this.fatalError) {
      if (goalFraction >= GOAL_FRACTION) {
        this.holdProgress = Math.min(1, this.holdProgress + frame.deltaSeconds / GOAL_HOLD_SECONDS);
      } else {
        this.holdProgress = Math.max(0, this.holdProgress - frame.deltaSeconds * 0.8);
      }
      if (this.holdProgress >= 1) this.won = true;
    }
    this.world.update(this.simulationElapsed, this.holdProgress);
    this.requestDiagnostics(frame.elapsedSeconds);
    this.requestGpuTimestamps(frame.elapsedSeconds);

    const perf = this.performance.snapshot();
    this.hud.update(this.createHudState(perf.fps, perf.frameP95Ms));
    this.performance.add(frame.deltaSeconds * 1_000, this.computeSubmitMs, this.lastRenderSubmitMs);
    this.lastComputeSubmitMs = this.computeSubmitMs;
    this.computeSubmitMs = 0;
    this.publishDiagnostics(frame);
  }

  private render(): void {
    const start = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.lastRenderSubmitMs = performance.now() - start;
  }

  private configureSimulation(reinitialize: boolean): void {
    const extent = worldExtentFor(this.config.count, this.config.scenario);
    const fog = this.scene.fog;
    if (fog instanceof THREE.Fog) {
      fog.near = Math.max(40, extent * 1.2);
      fog.far = Math.max(120, extent * 3.2);
    }
    this.arenaBounds.halfWidth = extent;
    this.arenaBounds.halfDepth = extent;
    this.world.configure(extent);
    this.goalPosition.set(this.world.goal.center.x, 0, this.world.goal.center.y);

    if (reinitialize) {
      this.boids.reinitialize(this.config.count, this.config.scenario, this.config.seed, extent);
      this.flock.syncCount();
    } else {
      this.boids.initialize(this.config.count, this.config.scenario, this.config.seed, extent);
    }
    this.boids.setGoal(this.goalPosition, this.world.goal.radius);
    this.cameraRig.configureArena(this.arenaBounds, this.goalPosition);
    this.resetRunState();
  }

  private resetPlayerAndCamera(): void {
    const extent = this.arenaBounds.halfWidth;
    this.dogStart.set(-extent * 0.62, 0, Math.min(8, extent * 0.18));
    this.dog.reset(this.dogStart);
    this.boids.setDog(this.dog.group.position, this.dog.velocity);
    this.cameraRig.configureArena(this.arenaBounds, this.goalPosition);
    this.cameraRig.setViewport(this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    this.cameraRig.snapTo(this.dog.group.position);
  }

  private resetRunState(): void {
    this.goalCount = 0;
    this.holdProgress = 0;
    this.won = false;
    this.paused = false;
    this.fatalError = null;
    this.simulationElapsed = 0;
    this.diagnostics = null;
    this.readbackState = 'warming';
    this.lastDiagnosticRequestAt = -Infinity;
    this.performance.reset();
    this.gpuComputeMs = 0;
    this.gpuRenderMs = 0;
    this.gpuTimingMeasured = false;
    this.lastTimestampRequestAt = -Infinity;
  }

  private restart(): void {
    if (this.fatalError) {
      window.location.reload();
      return;
    }
    this.configureSimulation(true);
    this.resetPlayerAndCamera();
    this.loop.resetClock();
    this.updateUrl();
  }

  private setCount(count: number): void {
    if (!COUNT_LADDER.includes(count as (typeof COUNT_LADDER)[number])) return;
    this.config.count = count;
    this.restart();
  }

  private setScenario(scenario: SimulationScenario): void {
    this.config.scenario = scenario as ScenarioId;
    this.restart();
  }

  private togglePause(): void {
    if (this.won || this.fatalError) return;
    this.paused = !this.paused;
    this.loop.resetClock();
  }

  private requestDiagnostics(elapsed: number): void {
    if (this.readbackPending || elapsed - this.lastDiagnosticRequestAt < DIAGNOSTIC_INTERVAL_SECONDS) return;
    this.readbackPending = true;
    this.lastDiagnosticRequestAt = elapsed;
    this.readbackState = 'pending';
    void this.boids.readDiagnostics()
      .then((diagnostics) => {
        this.diagnostics = diagnostics;
        this.goalCount = diagnostics.goalCount;
        this.readbackState = `${Math.round(performance.now() - diagnostics.sampledAt)} ms old`;
      })
      .catch((error: unknown) => {
        this.readbackState = 'readback error';
        this.fatalError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        this.readbackPending = false;
      });
  }

  private createHudState(fps: number, p95Ms: number): HudState {
    const goalPercent = this.config.count > 0 ? (this.goalCount / this.config.count) * 100 : 0;
    return {
      ready: true,
      paused: this.paused,
      won: this.won,
      error: this.fatalError,
      boidCount: this.config.count,
      scenario: this.config.scenario,
      goalPercent,
      holdProgress: this.holdProgress,
      barkReadiness: this.dog.barkReadiness,
      fps,
      p95Ms,
      algorithm: 'compact grid / exact radius',
      gridMaxOccupancy: this.diagnostics?.maxCellOccupancy ?? 0,
      gridCellCapacity: MAX_CANDIDATES_PER_BOID,
      truncations: this.diagnostics?.truncatedBoids ?? 0,
      readbackState: this.readbackState,
      status: this.statusText(goalPercent),
      adapter: this.adapterLabel,
    };
  }

  private requestGpuTimestamps(elapsed: number): void {
    if (!this.config.benchmark || !this.capability.timestampQuery || this.timestampPending) return;
    if (elapsed < 1 || elapsed - this.lastTimestampRequestAt < 1) return;
    this.timestampPending = true;
    this.lastTimestampRequestAt = elapsed;
    void Promise.all([
      this.renderer.resolveTimestampsAsync(THREE.TimestampQuery.COMPUTE),
      this.renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER),
    ]).then(([compute, render]) => {
      if (Number.isFinite(compute) && Number.isFinite(render)) {
        this.gpuComputeMs = Number(compute);
        this.gpuRenderMs = Number(render);
        this.gpuTimingMeasured = this.gpuComputeMs > 0 || this.gpuRenderMs > 0;
      }
    }).finally(() => {
      this.timestampPending = false;
    });
  }

  private statusText(goalPercent: number): string {
    if (this.won) return 'Flock secured - press R to run again';
    if (this.paused) return 'Simulation paused';
    if (goalPercent >= GOAL_FRACTION * 100) return `Hold the flock - ${Math.round(this.holdProgress * 100)}%`;
    return `Drive ${Math.round(GOAL_FRACTION * 100)}% into the gold pen`;
  }

  private publishDiagnostics(frame?: LoopFrame): void {
    const perf = this.performance.snapshot();
    const info = this.renderer.info;
    const diagnostics = {
      status: this.fatalError ? 'error' : this.won ? 'won' : this.paused ? 'paused' : 'playing',
      frame: this.frame,
      simulationElapsed: this.simulationElapsed,
      config: { ...this.config },
      dog: {
        position: { x: this.dog.group.position.x, y: this.dog.group.position.y, z: this.dog.group.position.z },
        velocity: { x: this.dog.velocity.x, y: this.dog.velocity.y, z: this.dog.velocity.z },
        barkSequence: this.dog.barkSequence,
        barkReadiness: this.dog.barkReadiness,
      },
      objective: {
        goalCount: this.goalCount,
        goalPercent: this.config.count > 0 ? (this.goalCount / this.config.count) * 100 : 0,
        holdProgress: this.holdProgress,
        requiredFraction: GOAL_FRACTION,
      },
      boids: this.diagnostics ?? {
        count: this.config.count,
        gridDimension: this.boids.gridDimension,
        cellWidth: this.boids.cellWidth,
        worldExtent: this.boids.worldExtent,
      },
      performance: {
        ...perf,
        cpuComputeSubmissionMs: this.lastComputeSubmitMs,
        cpuRenderSubmissionMs: this.lastRenderSubmitMs,
        gpuTimingAvailable: this.adapterLabel.includes('timestamp-query'),
        gpuTimingMeasured: this.gpuTimingMeasured,
        droppedSteps: frame?.droppedSteps ?? 0,
        substeps: frame?.substeps ?? 0,
      },
      timing: {
        gpuSource: this.gpuTimingMeasured ? 'timestamp-query' : 'unmeasured',
        gpuTimestampSupported: this.capability.timestampQuery,
        gpuComputeMs: this.gpuTimingMeasured ? this.gpuComputeMs : null,
        gpuRenderMs: this.gpuTimingMeasured ? this.gpuRenderMs : null,
        gpuTotalMs: this.gpuTimingMeasured ? this.gpuComputeMs + this.gpuRenderMs : null,
        computeSubmitP95Ms: perf.computeSubmitP95Ms,
        renderSubmitP95Ms: perf.renderSubmitP95Ms,
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        flockDrawCalls: 1,
        flockTriangles: this.config.count * 8,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        adapter: {
          name: this.capability.adapterName,
          features: this.capability.features,
          limits: this.capability.limits,
          timestampQuery: this.capability.timestampQuery,
        },
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, this.config.maxDpr),
      },
      error: this.fatalError,
    };
    window.__THREE_GAME_DIAGNOSTICS__ = diagnostics;
  }

  private installTestHooks(): void {
    window.addEventListener('keydown', this.onGlobalKeyDown);
    window.render_game_to_text = () => JSON.stringify({
      coordinateSystem: 'ground plane: +x right/east, +z down/south, y up',
      state: window.__THREE_GAME_DIAGNOSTICS__,
      controls: 'WASD/arrows move, Space bark, P pause, R restart, F fullscreen',
    });
    window.advanceTime = (milliseconds: number) => {
      const steps = Math.max(1, Math.min(600, Math.round(milliseconds / (1_000 / 60))));
      for (let index = 0; index < steps; index += 1) this.fixedUpdate(1 / 60);
      this.render();
      this.publishDiagnostics();
    };
    if (this.config.deepDiagnostics) {
      window.__GPU_BOID_ORACLE__ = (count = 256) => this.boids.readOracleSample(count);
    }
  }

  private readonly onGlobalKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'KeyF' || event.repeat) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void this.canvas.requestFullscreen();
  };

  private handleDeviceLost(info: unknown): void {
    this.fatalError = `GPU device lost: ${String(info)}`;
    this.paused = true;
    this.loop?.stop();
    this.hud?.showError(this.fatalError);
    this.publishDiagnostics();
  }

  private updateUrl(): void {
    const params = new URLSearchParams(window.location.search);
    params.set('count', String(this.config.count));
    params.set('scenario', this.config.scenario);
    params.set('seed', String(this.config.seed));
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }

  private formatAdapter(bundle: RendererBundle): string {
    const timestamp = bundle.capability.timestampQuery ? 'timestamp-query' : 'end-to-end timing';
    return `${bundle.capability.adapterName} - WebGPU - ${timestamp}`;
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}
