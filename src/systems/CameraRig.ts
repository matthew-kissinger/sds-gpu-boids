import * as THREE from 'three/webgpu';
import type { ArenaBounds } from '../entities/Dog';

export class CameraRig {
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredFocus = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly objective = new THREE.Vector3();
  private readonly zeroVelocity = new THREE.Vector3();
  private readonly workingVelocity = new THREE.Vector3();
  private readonly bounds: ArenaBounds = { halfWidth: 32, halfDepth: 20 };

  private hasObjective = false;
  private aspect = 16 / 9;
  private baseHeight = 24;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.camera.fov = 46;
    this.camera.near = 0.15;
    this.camera.far = 500;
    this.camera.updateProjectionMatrix();
    this.recalculateHeight();
  }

  configureArena(bounds: ArenaBounds, objective?: Readonly<THREE.Vector3>): void {
    this.bounds.halfWidth = bounds.halfWidth;
    this.bounds.halfDepth = bounds.halfDepth;
    this.hasObjective = Boolean(objective);
    if (objective) this.objective.copy(objective);
    this.recalculateHeight();
  }

  setViewport(aspect: number): void {
    this.aspect = Math.max(0.35, aspect);
    this.camera.aspect = this.aspect;
    this.camera.fov = this.aspect < 0.78 ? 51 : this.aspect < 1.1 ? 48 : 46;
    this.camera.updateProjectionMatrix();
    this.recalculateHeight();
  }

  snapTo(target: Readonly<THREE.Vector3>): void {
    this.composeFocus(target, this.zeroVelocity);
    const height = this.composeHeight(target);
    this.composeCameraPosition(height);
    this.camera.position.copy(this.desiredPosition);
    this.lookTarget.copy(this.desiredFocus);
    this.camera.lookAt(this.lookTarget);
  }

  update(
    deltaSeconds: number,
    target: Readonly<THREE.Vector3>,
    velocity: Readonly<THREE.Vector3> = this.zeroVelocity,
    lagSeconds = 0.16,
  ): void {
    this.composeFocus(target, velocity);
    const height = this.composeHeight(target);
    this.composeCameraPosition(height);

    const delta = Math.min(Math.max(deltaSeconds, 0), 0.05);
    const positionBlend = 1 - Math.exp(-delta / Math.max(0.025, lagSeconds));
    const focusBlend = 1 - Math.exp(-delta / Math.max(0.02, lagSeconds * 0.72));
    this.camera.position.lerp(this.desiredPosition, positionBlend);
    this.lookTarget.lerp(this.desiredFocus, focusBlend);
    this.camera.lookAt(this.lookTarget);
  }

  private composeFocus(target: Readonly<THREE.Vector3>, velocity: Readonly<THREE.Vector3>): void {
    this.desiredFocus.copy(target);

    this.workingVelocity.copy(velocity);
    this.workingVelocity.y = 0;
    const speed = this.workingVelocity.length();
    if (speed > 0.01) {
      this.workingVelocity.multiplyScalar(Math.min(0.5, 5 / speed));
      this.desiredFocus.add(this.workingVelocity);
    }

    if (this.hasObjective) {
      const objectiveDistance = this.desiredFocus.distanceTo(this.objective);
      const objectiveWeight = THREE.MathUtils.clamp(objectiveDistance / 125, 0.1, 0.46);
      this.desiredFocus.lerp(this.objective, objectiveWeight);
    }

    const xPadding = Math.min(4, this.bounds.halfWidth * 0.12);
    const zPadding = Math.min(4, this.bounds.halfDepth * 0.12);
    this.desiredFocus.x = THREE.MathUtils.clamp(
      this.desiredFocus.x,
      -this.bounds.halfWidth + xPadding,
      this.bounds.halfWidth - xPadding,
    );
    this.desiredFocus.z = THREE.MathUtils.clamp(
      this.desiredFocus.z,
      -this.bounds.halfDepth + zPadding,
      this.bounds.halfDepth - zPadding,
    );
    this.desiredFocus.y = 0.35;
  }

  private composeHeight(target: Readonly<THREE.Vector3>): number {
    if (!this.hasObjective) return this.baseHeight;
    const targetToObjective = Math.hypot(target.x - this.objective.x, target.z - this.objective.z);
    return this.baseHeight + Math.min(42, targetToObjective * 0.38);
  }

  private composeCameraPosition(height: number): void {
    const portraitLift = this.aspect < 1 ? THREE.MathUtils.lerp(1.18, 1.38, 1 - this.aspect) : 1;
    const adjustedHeight = height * portraitLift;
    const trailingDistance = adjustedHeight * (this.aspect < 0.8 ? 0.56 : 0.68);
    this.desiredPosition.set(
      this.desiredFocus.x,
      this.desiredFocus.y + adjustedHeight,
      this.desiredFocus.z + trailingDistance,
    );
  }

  private recalculateHeight(): void {
    const horizontalDemand = this.bounds.halfWidth / Math.max(0.72, this.aspect);
    const arenaDemand = Math.max(horizontalDemand, this.bounds.halfDepth);
    this.baseHeight = THREE.MathUtils.clamp(15 + arenaDemand * 0.38, 20, 48);
  }
}
