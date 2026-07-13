import { Vector2 } from 'three/webgpu';

type PointerState = {
  active: boolean;
  id: number | null;
  centerX: number;
  centerY: number;
  radius: number;
  knobTravel: number;
};

const GAME_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowLeft',
  'ArrowDown',
  'ArrowRight',
  'Space',
  'KeyP',
  'KeyR',
  'Escape',
]);

export class InputController {
  private readonly keys = new Set<string>();
  private readonly stickVector = new Vector2();
  private readonly keyVector = new Vector2();
  private readonly pointerState: PointerState = {
    active: false,
    id: null,
    centerX: 0,
    centerY: 0,
    radius: 1,
    knobTravel: 0,
  };

  private barkPointerId: number | null = null;
  private barkHeld = false;
  private barkPressed = false;
  private restartPressed = false;
  private pausePressed = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const isGlobalCommand = event.code === 'KeyR' || event.code === 'KeyP' || event.code === 'Escape';
    if (this.isTextInput(event.target) && !isGlobalCommand) return;
    if (GAME_KEYS.has(event.code)) event.preventDefault();

    this.keys.add(event.code);
    if (event.repeat) return;

    if (event.code === 'Space') {
      this.barkHeld = true;
      this.barkPressed = true;
    } else if (event.code === 'KeyR') {
      this.restartPressed = true;
    } else if (event.code === 'KeyP' || event.code === 'Escape') {
      this.pausePressed = true;
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
    if (event.code === 'Space') this.barkHeld = false;
  };

  private readonly onStickDown = (event: PointerEvent): void => {
    if (this.pointerState.active) return;
    event.preventDefault();

    const rect = this.stick.getBoundingClientRect();
    this.pointerState.active = true;
    this.pointerState.id = event.pointerId;
    this.pointerState.centerX = rect.left + rect.width / 2;
    this.pointerState.centerY = rect.top + rect.height / 2;
    this.pointerState.radius = Math.max(1, Math.min(rect.width, rect.height) * 0.38);
    this.pointerState.knobTravel = Math.min(rect.width, rect.height) * 0.29;
    this.stick.dataset.active = 'true';

    try {
      this.stick.setPointerCapture(event.pointerId);
    } catch {
      // Some synthetic pointer events are not backed by a capturable pointer.
    }

    this.updateStick(event.clientX, event.clientY);
  };

  private readonly onStickMove = (event: PointerEvent): void => {
    if (!this.pointerState.active || event.pointerId !== this.pointerState.id) return;
    event.preventDefault();
    this.updateStick(event.clientX, event.clientY);
  };

  private readonly onStickRelease = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerState.id) return;
    event.preventDefault();
    this.releaseStick();
  };

  private readonly onBarkDown = (event: PointerEvent): void => {
    if (this.barkPointerId !== null) return;
    event.preventDefault();
    this.barkPointerId = event.pointerId;
    this.barkHeld = true;
    this.barkPressed = true;
    this.barkButton.dataset.pressed = 'true';

    try {
      this.barkButton.setPointerCapture(event.pointerId);
    } catch {
      // Some synthetic pointer events are not backed by a capturable pointer.
    }
  };

  private readonly onBarkRelease = (event: PointerEvent): void => {
    if (event.pointerId !== this.barkPointerId) return;
    event.preventDefault();
    this.releaseBark();
  };

  private readonly onBarkKeyboardClick = (event: MouseEvent): void => {
    if (event.detail !== 0) return;
    this.barkPressed = true;
  };

  private readonly onWindowBlur = (): void => {
    this.resetHeldInput();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') this.resetHeldInput();
  };

  constructor(
    private readonly stick: HTMLElement,
    private readonly knob: HTMLElement,
    private readonly barkButton: HTMLElement,
  ) {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    this.stick.addEventListener('pointerdown', this.onStickDown);
    this.stick.addEventListener('pointermove', this.onStickMove);
    this.stick.addEventListener('pointerup', this.onStickRelease);
    this.stick.addEventListener('pointercancel', this.onStickRelease);
    this.stick.addEventListener('lostpointercapture', this.onStickRelease);

    this.barkButton.addEventListener('pointerdown', this.onBarkDown);
    this.barkButton.addEventListener('pointerup', this.onBarkRelease);
    this.barkButton.addEventListener('pointercancel', this.onBarkRelease);
    this.barkButton.addEventListener('lostpointercapture', this.onBarkRelease);
    this.barkButton.addEventListener('pointerleave', this.onBarkRelease);
    this.barkButton.addEventListener('click', this.onBarkKeyboardClick);
  }

  readMovement(target: Vector2): Vector2 {
    this.keyVector.set(0, 0);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.keyVector.x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.keyVector.x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.keyVector.y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.keyVector.y += 1;

    target.copy(this.keyVector).add(this.stickVector);
    if (target.lengthSq() > 1) target.normalize();
    return target;
  }

  consumeBarkPressed(): boolean {
    const pressed = this.barkPressed;
    this.barkPressed = false;
    return pressed;
  }

  consumeRestartPressed(): boolean {
    const pressed = this.restartPressed;
    this.restartPressed = false;
    return pressed;
  }

  consumePausePressed(): boolean {
    const pressed = this.pausePressed;
    this.pausePressed = false;
    return pressed;
  }

  isBarkHeld(): boolean {
    return this.barkHeld;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);

    this.stick.removeEventListener('pointerdown', this.onStickDown);
    this.stick.removeEventListener('pointermove', this.onStickMove);
    this.stick.removeEventListener('pointerup', this.onStickRelease);
    this.stick.removeEventListener('pointercancel', this.onStickRelease);
    this.stick.removeEventListener('lostpointercapture', this.onStickRelease);

    this.barkButton.removeEventListener('pointerdown', this.onBarkDown);
    this.barkButton.removeEventListener('pointerup', this.onBarkRelease);
    this.barkButton.removeEventListener('pointercancel', this.onBarkRelease);
    this.barkButton.removeEventListener('lostpointercapture', this.onBarkRelease);
    this.barkButton.removeEventListener('pointerleave', this.onBarkRelease);
    this.barkButton.removeEventListener('click', this.onBarkKeyboardClick);

    this.resetHeldInput();
  }

  private updateStick(clientX: number, clientY: number): void {
    const dx = clientX - this.pointerState.centerX;
    const dy = clientY - this.pointerState.centerY;
    this.stickVector.set(dx / this.pointerState.radius, dy / this.pointerState.radius);
    if (this.stickVector.lengthSq() > 1) this.stickVector.normalize();
    this.updateKnob();
  }

  private updateKnob(): void {
    const x = this.stickVector.x * this.pointerState.knobTravel;
    const y = this.stickVector.y * this.pointerState.knobTravel;
    this.knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }

  private releaseStick(): void {
    this.pointerState.active = false;
    this.pointerState.id = null;
    this.stickVector.set(0, 0);
    this.stick.dataset.active = 'false';
    this.updateKnob();
  }

  private releaseBark(): void {
    this.barkPointerId = null;
    this.barkHeld = false;
    this.barkButton.dataset.pressed = 'false';
  }

  private resetHeldInput(): void {
    this.keys.clear();
    this.releaseStick();
    this.releaseBark();
  }

  private isTextInput(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || target.matches('input, select, textarea, button');
  }
}
