import * as THREE from 'three/webgpu';
import type { ArenaBounds } from '../entities/Dog';

export type CameraMode = 'follow' | 'orbit' | 'classic';

export type CameraState = {
  mode: CameraMode;
  distance: number;
  yaw: number;
  pitch: number;
};

const MODES: CameraMode[] = ['follow', 'orbit', 'classic'];

export class CameraRig {
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredFocus = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly workingVelocity = new THREE.Vector3();
  private readonly bounds: ArenaBounds = { halfWidth: 32, halfDepth: 20 };
  private mode: CameraMode = 'follow';
  private distance = 38;
  private aspect = 16 / 9;
  private followYaw = 0;
  private orbitYaw = 0;
  private orbitPitch = 0.48;
  private pointerId: number | null = null;
  private pointerX = 0;
  private pointerY = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly inputSurface: HTMLElement,
  ) {
    this.camera.fov = 50;
    this.camera.near = 0.15;
    this.camera.far = 900;
    this.camera.updateProjectionMatrix();
    this.inputSurface.addEventListener('wheel', this.onWheel, { passive: false });
    this.inputSurface.addEventListener('pointerdown', this.onPointerDown);
    this.inputSurface.addEventListener('pointermove', this.onPointerMove);
    this.inputSurface.addEventListener('pointerup', this.onPointerRelease);
    this.inputSurface.addEventListener('pointercancel', this.onPointerRelease);
    this.inputSurface.addEventListener('lostpointercapture', this.onPointerRelease);
  }

  configureArena(bounds: ArenaBounds, _objective?: Readonly<THREE.Vector3>): void {
    this.bounds.halfWidth = bounds.halfWidth;
    this.bounds.halfDepth = bounds.halfDepth;
  }

  setViewport(aspect: number): void {
    this.aspect = Math.max(0.35, aspect);
    this.camera.aspect = this.aspect;
    this.camera.fov = this.aspect < 0.78 ? 56 : this.aspect < 1.1 ? 53 : 50;
    this.camera.updateProjectionMatrix();
  }

  cycleMode(): CameraMode {
    const index = MODES.indexOf(this.mode);
    this.mode = MODES[(index + 1) % MODES.length]!;
    return this.mode;
  }

  zoomBy(delta: number): void {
    this.distance = THREE.MathUtils.clamp(this.distance + delta, 16, 110);
  }

  orbitBy(deltaYaw: number, deltaPitch = 0): void {
    if (this.mode !== 'orbit') this.mode = 'orbit';
    this.orbitYaw += deltaYaw;
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + deltaPitch, 0.22, 1.18);
  }

  getState(): CameraState {
    return {
      mode: this.mode,
      distance: this.distance,
      yaw: this.mode === 'follow' ? this.followYaw : this.orbitYaw,
      pitch: this.orbitPitch,
    };
  }

  snapTo(target: Readonly<THREE.Vector3>, velocity = new THREE.Vector3()): void {
    this.composeFocus(target, velocity);
    this.composeCameraPosition(velocity);
    this.camera.position.copy(this.desiredPosition);
    this.lookTarget.copy(this.desiredFocus);
    this.camera.lookAt(this.lookTarget);
  }

  update(
    deltaSeconds: number,
    target: Readonly<THREE.Vector3>,
    velocity: Readonly<THREE.Vector3>,
    lagSeconds = 0.14,
  ): void {
    this.composeFocus(target, velocity);
    this.composeCameraPosition(velocity);

    const delta = Math.min(Math.max(deltaSeconds, 0), 0.05);
    const positionBlend = this.mode === 'orbit'
      ? 1 - Math.exp(-delta / 0.06)
      : 1 - Math.exp(-delta / Math.max(0.025, lagSeconds));
    const focusBlend = 1 - Math.exp(-delta / Math.max(0.02, lagSeconds * 0.72));
    this.camera.position.lerp(this.desiredPosition, positionBlend);
    this.lookTarget.lerp(this.desiredFocus, focusBlend);
    this.camera.lookAt(this.lookTarget);
  }

  dispose(): void {
    this.inputSurface.removeEventListener('wheel', this.onWheel);
    this.inputSurface.removeEventListener('pointerdown', this.onPointerDown);
    this.inputSurface.removeEventListener('pointermove', this.onPointerMove);
    this.inputSurface.removeEventListener('pointerup', this.onPointerRelease);
    this.inputSurface.removeEventListener('pointercancel', this.onPointerRelease);
    this.inputSurface.removeEventListener('lostpointercapture', this.onPointerRelease);
  }

  private composeFocus(target: Readonly<THREE.Vector3>, velocity: Readonly<THREE.Vector3>): void {
    this.desiredFocus.copy(target);
    this.workingVelocity.copy(velocity);
    this.workingVelocity.y = 0;
    const speed = this.workingVelocity.length();
    if (speed > 0.01) {
      this.workingVelocity.multiplyScalar(Math.min(5, speed * 0.18) / speed);
      this.desiredFocus.add(this.workingVelocity);
    }
    this.desiredFocus.x = THREE.MathUtils.clamp(this.desiredFocus.x, -this.bounds.halfWidth, this.bounds.halfWidth);
    this.desiredFocus.z = THREE.MathUtils.clamp(this.desiredFocus.z, -this.bounds.halfDepth, this.bounds.halfDepth);
    this.desiredFocus.y = 1.25;
  }

  private composeCameraPosition(velocity: Readonly<THREE.Vector3>): void {
    const speed = Math.hypot(velocity.x, velocity.z);
    if (speed > 0.1) {
      const targetYaw = Math.atan2(velocity.x, velocity.z);
      this.followYaw = this.lerpAngle(this.followYaw, targetYaw, 0.16);
    }

    const portraitLift = this.aspect < 1 ? THREE.MathUtils.lerp(1.08, 1.28, 1 - this.aspect) : 1;
    if (this.mode === 'classic') {
      this.desiredPosition.set(
        this.desiredFocus.x,
        this.desiredFocus.y + this.distance * 1.08 * portraitLift,
        this.desiredFocus.z + this.distance * 0.62,
      );
      return;
    }

    if (this.mode === 'orbit') {
      const horizontal = Math.cos(this.orbitPitch) * this.distance;
      this.desiredPosition.set(
        this.desiredFocus.x + Math.sin(this.orbitYaw) * horizontal,
        this.desiredFocus.y + Math.sin(this.orbitPitch) * this.distance * portraitLift,
        this.desiredFocus.z + Math.cos(this.orbitYaw) * horizontal,
      );
      return;
    }

    const followHeight = (5 + this.distance * 0.44) * portraitLift;
    this.desiredPosition.set(
      this.desiredFocus.x - Math.sin(this.followYaw) * this.distance,
      this.desiredFocus.y + followHeight,
      this.desiredFocus.z - Math.cos(this.followYaw) * this.distance,
    );
  }

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.zoomBy(Math.sign(event.deltaY) * 5);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.pointerId !== null || event.button !== 0) return;
    this.pointerId = event.pointerId;
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.inputSurface.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    const dx = event.clientX - this.pointerX;
    const dy = event.clientY - this.pointerY;
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
    this.orbitBy(-dx * 0.008, dy * 0.006);
  };

  private readonly onPointerRelease = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.pointerId = null;
  };

  private lerpAngle(from: number, to: number, blend: number): number {
    const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + delta * blend;
  }
}
