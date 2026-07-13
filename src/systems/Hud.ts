export const BOID_COUNT_LADDER = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 50_000, 75_000, 100_000] as const;

export type SimulationScenario = 'constant' | 'field' | 'herd' | 'goal';

export type HudState = {
  ready: boolean;
  paused: boolean;
  won: boolean;
  error: string | null;
  boidCount: number;
  scenario: SimulationScenario;
  goalPercent: number;
  holdProgress: number;
  barkReadiness: number;
  fps: number;
  p95Ms: number;
  algorithm: string;
  gridMaxOccupancy: number;
  gridCellCapacity: number;
  truncations: number;
  readbackState: string;
  status: string;
  adapter: string;
  camera: { mode: 'follow' | 'orbit' | 'classic'; distance: number };
};

export type HudCallbacks = {
  onCountChange: (count: number) => void;
  onScenarioChange: (scenario: SimulationScenario) => void;
  onPause: () => void;
  onRestart: () => void;
  onMute: () => boolean;
  onCamera: () => 'follow' | 'orbit' | 'classic';
};

export const HUD_EVENT_NAMES = {
  countChange: 'gpu-boids:count-change',
  scenarioChange: 'gpu-boids:scenario-change',
  pause: 'gpu-boids:pause',
  restart: 'gpu-boids:restart',
} as const;

type OverlayState = 'playing' | 'loading' | 'paused' | 'won' | 'error';

export class Hud {
  private readonly boidCount = this.getElement('#boid-count');
  private readonly goalPercent = this.getElement('#goal-percent');
  private readonly goalMeterFill = this.getElement('#goal-meter-fill');
  private readonly holdMeterFill = this.getElement('#hold-meter-fill');
  private readonly fpsValue = this.getElement('#fps-value');
  private readonly p95Value = this.getElement('#p95-value');
  private readonly statusLine = this.getElement('#status-line');
  private readonly adapterLine = this.getElement('#adapter-line');
  private readonly algorithmValue = this.getElement('#algorithm-value');
  private readonly occupancyValue = this.getElement('#occupancy-value');
  private readonly truncationValue = this.getElement('#truncation-value');
  private readonly readbackValue = this.getElement('#readback-value');
  private readonly countSelect = this.getElement<HTMLSelectElement>('#count-select');
  private readonly scenarioSelect = this.getElement<HTMLSelectElement>('#scenario-select');
  private readonly pauseButton = this.getElement<HTMLButtonElement>('#pause-button');
  private readonly restartButton = this.getElement<HTMLButtonElement>('#restart-button');
  private readonly muteButton = this.getElement<HTMLButtonElement>('#mute-button');
  private readonly cameraButton = this.getElement<HTMLButtonElement>('#camera-button');
  private readonly metricsToggle = this.getElement<HTMLButtonElement>('#metrics-toggle');
  private readonly metricsPanel = this.getElement('#metrics-panel');
  private readonly barkButton = this.getElement<HTMLButtonElement>('#bark-button');
  private readonly overlay = this.getElement('#game-overlay');
  private readonly overlayKicker = this.getElement('#overlay-kicker');
  private readonly overlayTitle = this.getElement('#overlay-title');
  private readonly overlayBody = this.getElement('#overlay-body');
  private readonly overlayPrimary = this.getElement<HTMLButtonElement>('#overlay-primary');
  private readonly overlaySecondary = this.getElement<HTMLButtonElement>('#overlay-secondary');
  private readonly callbacks: Partial<HudCallbacks>;

  private overlayState: OverlayState = 'playing';

  private readonly onCountChange = (): void => {
    const count = Number(this.countSelect.value);
    if (!Number.isFinite(count)) return;
    this.callbacks.onCountChange?.(count);
    window.dispatchEvent(new CustomEvent(HUD_EVENT_NAMES.countChange, { detail: { count } }));
  };

  private readonly onScenarioChange = (): void => {
    const scenario = this.countScenario(this.scenarioSelect.value);
    this.callbacks.onScenarioChange?.(scenario);
    window.dispatchEvent(new CustomEvent(HUD_EVENT_NAMES.scenarioChange, { detail: { scenario } }));
  };

  private readonly onPause = (): void => {
    this.callbacks.onPause?.();
    window.dispatchEvent(new CustomEvent(HUD_EVENT_NAMES.pause));
  };

  private readonly onRestart = (): void => {
    this.callbacks.onRestart?.();
    window.dispatchEvent(new CustomEvent(HUD_EVENT_NAMES.restart));
  };

  private readonly onMetricsToggle = (): void => {
    const expanded = this.metricsToggle.getAttribute('aria-expanded') === 'true';
    this.metricsToggle.setAttribute('aria-expanded', String(!expanded));
    this.metricsPanel.hidden = expanded;
  };

  private readonly onMute = (): void => {
    const muted = this.callbacks.onMute?.() ?? false;
    this.muteButton.dataset.muted = String(muted);
    this.muteButton.textContent = muted ? 'OFF' : 'SFX';
    this.muteButton.setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
  };

  private readonly onCamera = (): void => {
    this.callbacks.onCamera?.();
  };

  private readonly onOverlayPrimary = (): void => {
    if (this.overlayState === 'paused') this.onPause();
    else if (this.overlayState === 'won' || this.overlayState === 'error') this.onRestart();
  };

  constructor(callbacks: Partial<HudCallbacks> = {}) {
    this.callbacks = callbacks;
    this.countSelect.addEventListener('change', this.onCountChange);
    this.scenarioSelect.addEventListener('change', this.onScenarioChange);
    this.pauseButton.addEventListener('click', this.onPause);
    this.restartButton.addEventListener('click', this.onRestart);
    this.muteButton.addEventListener('click', this.onMute);
    this.cameraButton.addEventListener('click', this.onCamera);
    this.metricsToggle.addEventListener('click', this.onMetricsToggle);
    this.overlayPrimary.addEventListener('click', this.onOverlayPrimary);
    this.overlaySecondary.addEventListener('click', this.onRestart);

    if (new URLSearchParams(window.location.search).has('debug')) {
      this.metricsToggle.setAttribute('aria-expanded', 'true');
      this.metricsPanel.hidden = false;
    }
  }

  update(state: HudState): void {
    this.setText(this.boidCount, Math.round(state.boidCount).toLocaleString());
    this.setText(this.goalPercent, `${Math.round(state.goalPercent)}%`);
    this.setText(this.fpsValue, Math.max(0, Math.round(state.fps)).toString().padStart(3, '0'));
    this.setText(this.p95Value, `${Math.max(0, state.p95Ms).toFixed(1)} ms`);
    this.setText(this.statusLine, state.status);
    this.setText(this.algorithmValue, state.algorithm);
    this.setText(this.occupancyValue, `${state.gridMaxOccupancy}/${state.gridCellCapacity}`);
    this.setText(this.truncationValue, Math.max(0, state.truncations).toLocaleString());
    this.setText(this.readbackValue, state.readbackState);
    this.setAdapter(state.adapter);
    this.cameraButton.textContent = state.camera.mode === 'follow' ? 'FOLLOW' : state.camera.mode === 'orbit' ? 'ORBIT' : 'TOP';
    this.cameraButton.title = `${state.camera.mode} camera - ${Math.round(state.camera.distance)}m (C to cycle)`;

    this.setMeter(this.goalMeterFill, state.goalPercent / 100, state.goalPercent);
    this.setMeter(this.holdMeterFill, state.holdProgress, state.holdProgress * 100);
    this.barkButton.style.setProperty('--bark-readiness', String(this.clamp01(state.barkReadiness)));
    this.barkButton.disabled = !state.ready || Boolean(state.error) || state.paused || state.won;

    const countValue = String(Math.round(state.boidCount));
    if (this.countSelect.value !== countValue) this.countSelect.value = countValue;
    if (this.scenarioSelect.value !== state.scenario) this.scenarioSelect.value = state.scenario;

    const controlsDisabled = !state.ready || Boolean(state.error);
    this.countSelect.disabled = controlsDisabled;
    this.scenarioSelect.disabled = controlsDisabled;
    this.pauseButton.disabled = controlsDisabled || state.won;
    this.pauseButton.setAttribute('aria-label', state.paused ? 'Resume simulation' : 'Pause simulation');
    this.pauseButton.dataset.paused = String(state.paused);

    if (state.error) this.setOverlay('error', state.error);
    else if (!state.ready) this.setOverlay('loading');
    else if (state.won) this.setOverlay('won');
    else if (state.paused) this.setOverlay('paused');
    else this.setOverlay('playing');
  }

  setAdapter(adapter: string): void {
    const label = adapter || 'Adapter details pending';
    this.setText(this.adapterLine, label);
    this.adapterLine.title = label;
  }

  setStatus(status: string): void {
    this.setText(this.statusLine, status);
  }

  showError(message: string): void {
    this.setOverlay('error', message);
  }

  flashBark(): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.barkButton.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.08)' },
        { transform: 'scale(1)' },
      ],
      { duration: 180, easing: 'ease-out' },
    );
  }

  dispose(): void {
    this.countSelect.removeEventListener('change', this.onCountChange);
    this.scenarioSelect.removeEventListener('change', this.onScenarioChange);
    this.pauseButton.removeEventListener('click', this.onPause);
    this.restartButton.removeEventListener('click', this.onRestart);
    this.muteButton.removeEventListener('click', this.onMute);
    this.cameraButton.removeEventListener('click', this.onCamera);
    this.metricsToggle.removeEventListener('click', this.onMetricsToggle);
    this.overlayPrimary.removeEventListener('click', this.onOverlayPrimary);
    this.overlaySecondary.removeEventListener('click', this.onRestart);
  }

  private setOverlay(state: OverlayState, errorMessage = ''): void {
    const stateChanged = state !== this.overlayState;
    if (!stateChanged && state !== 'error') return;
    const previousState = this.overlayState;
    this.overlayState = state;
    this.overlay.dataset.state = state;
    this.overlay.hidden = state === 'playing';

    if (state === 'loading') {
      this.setText(this.overlayKicker, 'WEBGPU COMPUTE');
      this.setText(this.overlayTitle, 'Preparing the flock');
      this.setText(this.overlayBody, 'Checking the adapter and allocating GPU state.');
      this.overlayPrimary.hidden = true;
      this.overlaySecondary.hidden = true;
    } else if (state === 'paused') {
      this.setText(this.overlayKicker, 'HOME FIELD');
      this.setText(this.overlayTitle, 'Taking a breather');
      this.setText(this.overlayBody, 'Jep and every sheep are waiting exactly where you left them.');
      this.setText(this.overlayPrimary, 'Resume');
      this.overlayPrimary.hidden = false;
      this.overlaySecondary.hidden = false;
    } else if (state === 'won') {
      this.setText(this.overlayKicker, 'HOME FIELD COMPLETE');
      this.setText(this.overlayTitle, 'Flock secured');
      this.setText(this.overlayBody, 'Jep held the flock safely inside the north pen.');
      this.setText(this.overlayPrimary, 'Run again');
      this.overlayPrimary.hidden = false;
      this.overlaySecondary.hidden = true;
    } else if (state === 'error') {
      this.setText(this.overlayKicker, 'WEBGPU STOP');
      this.setText(this.overlayTitle, 'Prototype unavailable');
      this.setText(this.overlayBody, errorMessage);
      this.setText(this.overlayPrimary, 'Retry');
      this.overlayPrimary.hidden = false;
      this.overlaySecondary.hidden = true;
    }

    if (stateChanged && state !== 'playing' && state !== 'loading') {
      this.overlayPrimary.focus({ preventScroll: true });
    } else if (state === 'playing' && previousState !== 'playing') {
      document.querySelector<HTMLCanvasElement>('#game-canvas')?.focus({ preventScroll: true });
    }
  }

  private setMeter(element: HTMLElement, progress: number, ariaValue: number): void {
    element.style.transform = `scaleX(${this.clamp01(progress)})`;
    element.parentElement?.setAttribute('aria-valuenow', String(Math.round(ariaValue)));
  }

  private setText(element: HTMLElement, value: string): void {
    if (element.textContent !== value) element.textContent = value;
  }

  private countScenario(value: string): SimulationScenario {
    if (value === 'field' || value === 'herd' || value === 'goal') return value;
    return 'constant';
  }

  private clamp01(value: number): number {
    return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}
