import { DEFAULT_BOID_TUNING, type BoidTuning } from '../gpu';

export type FlockTuning = BoidTuning & {
  dogRadius: number;
  dogStrength: number;
  dogSpeed: number;
  barkRadius: number;
  barkStrength: number;
  flockingEnabled: boolean;
  dogPressureEnabled: boolean;
  barkEnabled: boolean;
  boundaryEnabled: boolean;
  goalAssistEnabled: boolean;
};

export const DEFAULT_FLOCK_TUNING: FlockTuning = {
  ...DEFAULT_BOID_TUNING,
  dogRadius: 15,
  dogStrength: 28,
  dogSpeed: 34,
  barkRadius: 32,
  barkStrength: 44,
  goalAttraction: 0.45,
  flockingEnabled: true,
  dogPressureEnabled: true,
  barkEnabled: true,
  boundaryEnabled: true,
  goalAssistEnabled: false,
};

const PRESETS: Record<string, Partial<FlockTuning>> = {
  natural: DEFAULT_FLOCK_TUNING,
  cohesive: {
    separationWeight: 1.25,
    alignmentWeight: 1.2,
    cohesionWeight: 0.72,
    perceptionRadius: 4.4,
    separationRadius: 0.72,
    minSpeed: 1.2,
    maxSpeed: 4.1,
  },
  loose: {
    separationWeight: 2.7,
    alignmentWeight: 0.28,
    cohesionWeight: 0.1,
    perceptionRadius: 2,
    separationRadius: 1.2,
    minSpeed: 1.7,
    maxSpeed: 5.8,
  },
  dramatic: {
    separationWeight: 1.8,
    alignmentWeight: 1.05,
    cohesionWeight: 0.48,
    perceptionRadius: 5.2,
    separationRadius: 0.9,
    maxSpeed: 7.2,
    dogRadius: 24,
    dogStrength: 44,
    barkRadius: 48,
    barkStrength: 68,
  },
};

export class TuningPanel {
  private readonly panel = this.getElement('#tuning-panel');
  private readonly toggle = this.getElement<HTMLButtonElement>('#tuning-toggle');
  private readonly resetButton = this.getElement<HTMLButtonElement>('#tuning-reset');
  private readonly copyButton = this.getElement<HTMLButtonElement>('#tuning-copy');
  private tuning: FlockTuning = { ...DEFAULT_FLOCK_TUNING };

  constructor(private readonly onChange: (tuning: Readonly<FlockTuning>) => void) {
    this.toggle.addEventListener('click', this.onToggle);
    this.resetButton.addEventListener('click', this.onReset);
    this.copyButton.addEventListener('click', this.onCopy);
    for (const input of this.inputs()) input.addEventListener('input', this.onInput);
    for (const button of this.panel.querySelectorAll<HTMLButtonElement>('[data-tuning-preset]')) {
      button.addEventListener('click', this.onPreset);
    }
    this.writeInputs();
    this.onChange(this.effectiveTuning());
  }

  dispose(): void {
    this.toggle.removeEventListener('click', this.onToggle);
    this.resetButton.removeEventListener('click', this.onReset);
    this.copyButton.removeEventListener('click', this.onCopy);
    for (const input of this.inputs()) input.removeEventListener('input', this.onInput);
    for (const button of this.panel.querySelectorAll<HTMLButtonElement>('[data-tuning-preset]')) {
      button.removeEventListener('click', this.onPreset);
    }
  }

  private readonly onToggle = (): void => {
    const expanded = this.toggle.getAttribute('aria-expanded') === 'true';
    this.toggle.setAttribute('aria-expanded', String(!expanded));
    this.panel.hidden = expanded;
  };

  private readonly onInput = (): void => {
    this.readInputs();
    this.onChange(this.effectiveTuning());
  };

  private readonly onReset = (): void => {
    this.tuning = { ...DEFAULT_FLOCK_TUNING };
    this.writeInputs();
    this.onChange(this.effectiveTuning());
  };

  private readonly onPreset = (event: Event): void => {
    const button = event.currentTarget as HTMLButtonElement;
    const preset = PRESETS[button.dataset.tuningPreset ?? ''];
    if (!preset) return;
    this.tuning = { ...this.tuning, ...preset };
    this.writeInputs();
    this.onChange(this.effectiveTuning());
  };

  private readonly onCopy = (): void => {
    void navigator.clipboard.writeText(JSON.stringify(this.tuning, null, 2)).then(() => {
      this.copyButton.textContent = 'COPIED';
      window.setTimeout(() => { this.copyButton.textContent = 'COPY'; }, 900);
    }).catch(() => undefined);
  };

  private readInputs(): void {
    for (const input of this.inputs()) {
      const key = input.dataset.tuningKey as keyof FlockTuning | undefined;
      if (!key) continue;
      if (input instanceof HTMLInputElement && input.type === 'checkbox') {
        (this.tuning as unknown as Record<string, boolean>)[key] = input.checked;
      } else {
        (this.tuning as unknown as Record<string, number>)[key] = Number(input.value);
      }
    }
    this.updateOutputs();
  }

  private writeInputs(): void {
    for (const input of this.inputs()) {
      const key = input.dataset.tuningKey as keyof FlockTuning | undefined;
      if (!key) continue;
      const value = this.tuning[key];
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = String(value);
    }
    this.updateOutputs();
  }

  private updateOutputs(): void {
    for (const output of this.panel.querySelectorAll<HTMLOutputElement>('output[data-tuning-output]')) {
      const key = output.dataset.tuningOutput as keyof FlockTuning | undefined;
      if (!key) continue;
      const value = this.tuning[key];
      output.textContent = typeof value === 'number' ? value.toFixed(value < 10 ? 2 : 1).replace(/\.00$/, '') : String(value);
    }
  }

  private effectiveTuning(): FlockTuning {
    return {
      ...this.tuning,
      separationWeight: this.tuning.flockingEnabled ? this.tuning.separationWeight : 0,
      alignmentWeight: this.tuning.flockingEnabled ? this.tuning.alignmentWeight : 0,
      cohesionWeight: this.tuning.flockingEnabled ? this.tuning.cohesionWeight : 0,
      dogRadius: this.tuning.dogPressureEnabled ? this.tuning.dogRadius : 0,
      dogStrength: this.tuning.dogPressureEnabled ? this.tuning.dogStrength : 0,
      barkRadius: this.tuning.barkEnabled ? this.tuning.barkRadius : 0,
      barkStrength: this.tuning.barkEnabled ? this.tuning.barkStrength : 0,
      boundaryStrength: this.tuning.boundaryEnabled ? this.tuning.boundaryStrength : 0,
      goalAttraction: this.tuning.goalAssistEnabled ? this.tuning.goalAttraction : 0,
    };
  }

  private inputs(): NodeListOf<HTMLInputElement> {
    return this.panel.querySelectorAll<HTMLInputElement>('input[data-tuning-key]');
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing tuning element: ${selector}`);
    return element;
  }
}
