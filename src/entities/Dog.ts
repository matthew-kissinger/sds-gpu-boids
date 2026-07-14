import * as THREE from 'three/webgpu';
import { createHomeFieldLoader, loadHomeFieldModel } from '../assets/HomeFieldAssets';
import { resolveSegmentCollisions, type CollisionSegment } from '../world/Collision';

export type ArenaBounds = {
  halfWidth: number;
  halfDepth: number;
};

export type DogTuning = {
  maxSpeed: number;
  acceleration: number;
  braking: number;
  turnResponsiveness: number;
  edgePadding: number;
  barkCooldown: number;
  barkDuration: number;
  barkMaxRadius: number;
};

export type DogInfluenceTarget = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  forward: THREE.Vector3;
  barkStrength: number;
  barkRadius: number;
  barkSequence: number;
};

export type BarkPulseEvent = {
  x: number;
  z: number;
  directionX: number;
  directionZ: number;
  maxRadius: number;
  sequence: number;
};

export const DEFAULT_DOG_TUNING: DogTuning = {
  maxSpeed: 34,
  acceleration: 17,
  braking: 22,
  turnResponsiveness: 8,
  edgePadding: 1.2,
  barkCooldown: 1.05,
  barkDuration: 0.46,
  barkMaxRadius: 32,
};

type LocomotionTier = 'idle' | 'walk' | 'trot' | 'run';

/** Overlapping [low, high) bands give tier switches hysteresis instead of flickering at a hard cutoff. */
const LOCOMOTION_BANDS: Record<LocomotionTier, readonly [number, number]> = {
  idle: [0, 0.08],
  walk: [0.05, 0.45],
  trot: [0.4, 0.75],
  run: [0.7, Infinity],
};
const LOCOMOTION_ORDER: readonly LocomotionTier[] = ['idle', 'walk', 'trot', 'run'];
const IDLE_CLIP_NAMES: readonly string[] = ['Idle_1', 'Idle_2', 'Idle_3', 'Idle_4', 'Idle_6', 'Idle_7'];

const BARK_ARC_COUNT = 3;
const BARK_ARC_ANGLE = Math.PI * 0.7;
const BARK_ARC_STAGGER = 0.1;

export class Dog {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, 1);

  barkStrength = 0;
  barkRadius = 0;
  barkSequence = 0;

  private readonly modelRoot = new THREE.Group();
  private readonly loader = createHomeFieldLoader();
  private readonly targetVelocity = new THREE.Vector3();
  private readonly previousPosition = new THREE.Vector3();
  private heading = 0;
  private previousHeading = 0;
  private readonly movement = new THREE.Vector2();
  private readonly legs: THREE.Mesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly barkListeners = new Set<(event: BarkPulseEvent) => void>();
  private readonly barkArcs: THREE.Mesh[] = [];
  private readonly barkArcMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly tuning: DogTuning;
  private readonly collisionPosition = new THREE.Vector2();
  private importedModel: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private readonly idleActions: THREE.AnimationAction[] = [];
  private idleAction: THREE.AnimationAction | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  private trotAction: THREE.AnimationAction | null = null;
  private runAction: THREE.AnimationAction | null = null;
  private barkAction: THREE.AnimationAction | null = null;
  private locomotionTier: LocomotionTier = 'idle';
  private idleVariantIndex = 0;
  private idleVariantTimer = 0;
  private nextIdleSwitchAt = 5;

  private barkAge = Infinity;
  private barkCooldownRemaining = 0;

  constructor(tuning: Partial<DogTuning> = {}) {
    this.tuning = { ...DEFAULT_DOG_TUNING, ...tuning };
    this.group.name = 'CPU Sheepdog';

    const coat = this.createStandardMaterial('#202724', 0.88);
    const white = this.createStandardMaterial('#e9e4d2', 0.9);
    const tan = this.createStandardMaterial('#b66b3f', 0.82);
    const noseMaterial = this.createStandardMaterial('#090c0b', 0.62);

    const bodyGeometry = this.trackGeometry(new THREE.DodecahedronGeometry(0.58, 0));
    const headGeometry = this.trackGeometry(new THREE.DodecahedronGeometry(0.38, 0));
    const boxGeometry = this.trackGeometry(new THREE.BoxGeometry(1, 1, 1));
    const earGeometry = this.trackGeometry(new THREE.ConeGeometry(0.13, 0.34, 3));
    const tailGeometry = this.trackGeometry(new THREE.ConeGeometry(0.11, 0.75, 5));

    const body = this.createMesh(bodyGeometry, coat);
    body.position.set(0, 0.82, 0);
    body.scale.set(0.88, 0.72, 1.35);
    this.modelRoot.add(body);

    const chest = this.createMesh(boxGeometry, white);
    chest.position.set(0, 0.78, -0.55);
    chest.scale.set(0.48, 0.52, 0.18);
    this.modelRoot.add(chest);

    const head = this.createMesh(headGeometry, coat);
    head.position.set(0, 1.18, -0.73);
    head.scale.set(0.9, 1.02, 1.05);
    this.modelRoot.add(head);

    const blaze = this.createMesh(boxGeometry, white);
    blaze.position.set(0, 1.25, -1.03);
    blaze.scale.set(0.12, 0.34, 0.08);
    this.modelRoot.add(blaze);

    const muzzle = this.createMesh(boxGeometry, tan);
    muzzle.position.set(0, 1.08, -1.08);
    muzzle.scale.set(0.34, 0.23, 0.42);
    this.modelRoot.add(muzzle);

    const nose = this.createMesh(boxGeometry, noseMaterial);
    nose.position.set(0, 1.11, -1.31);
    nose.scale.set(0.24, 0.17, 0.12);
    this.modelRoot.add(nose);

    for (const x of [-0.23, 0.23]) {
      const ear = this.createMesh(earGeometry, coat);
      ear.position.set(x, 1.57, -0.75);
      ear.rotation.z = x < 0 ? 0.18 : -0.18;
      this.modelRoot.add(ear);
    }

    const legPositions: ReadonlyArray<readonly [number, number]> = [
      [-0.31, -0.38],
      [0.31, -0.38],
      [-0.31, 0.4],
      [0.31, 0.4],
    ];
    for (const [x, z] of legPositions) {
      const leg = this.createMesh(boxGeometry, z < 0 ? white : coat);
      leg.position.set(x, 0.34, z);
      leg.scale.set(0.18, 0.62, 0.2);
      this.legs.push(leg);
      this.modelRoot.add(leg);
    }

    const tail = this.createMesh(tailGeometry, white);
    tail.position.set(0, 0.98, 0.88);
    tail.rotation.x = Math.PI * 0.42;
    this.modelRoot.add(tail);

    this.group.add(this.modelRoot);

    // Centered at theta=-PI/2 (pre-rotation -Y) so that after the -90deg X-axis flatten below,
    // the arc's sweep is centered on local +Z - which prepareRender()'s heading rotation maps
    // to the dog's forward direction (matches how `this.forward` is derived from heading).
    const arcGeometry = this.trackGeometry(
      new THREE.RingGeometry(0.82, 1, 48, 1, -Math.PI / 2 - BARK_ARC_ANGLE / 2, BARK_ARC_ANGLE),
    );
    for (let index = 0; index < BARK_ARC_COUNT; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: '#f5c85b',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(material);
      this.barkArcMaterials.push(material);
      const arc = new THREE.Mesh(arcGeometry, material);
      arc.name = `Bark pressure arc ${index}`;
      arc.rotation.x = -Math.PI / 2;
      arc.position.y = 0.05;
      arc.visible = false;
      this.barkArcs.push(arc);
      this.group.add(arc);
    }
  }

  async loadModel(): Promise<void> {
    const gltf = await loadHomeFieldModel(this.loader, 'dog');
    this.importedModel = gltf.scene;
    this.importedModel.name = 'Jep - Home Field sheepdog';
    this.importedModel.scale.setScalar(3.2);
    this.importedModel.rotation.y = 0;
    this.importedModel.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    this.modelRoot.visible = false;
    this.group.add(this.importedModel);

    this.mixer = new THREE.AnimationMixer(this.importedModel);
    const clip = (name: string): THREE.AnimationAction | null => {
      const animation = gltf.animations.find((candidate) => candidate.name === name);
      return animation ? this.mixer!.clipAction(animation) : null;
    };
    for (const name of IDLE_CLIP_NAMES) {
      const action = clip(name);
      if (action) this.idleActions.push(action);
    }
    this.idleAction = this.idleActions[0] ?? null;
    this.walkAction = clip('Walk_F_IP') ?? this.idleAction;
    this.trotAction = clip('Trot_F_IP') ?? this.walkAction;
    this.runAction = clip('Run_F_IP') ?? clip('RunFast_F_IP') ?? this.trotAction;
    this.barkAction = clip('Bark');
    this.transitionAnimation(this.idleAction, 0);
  }

  update(deltaSeconds: number, elapsedSeconds: number, inputMovement: THREE.Vector2, bounds: ArenaBounds): void {
    const delta = Math.min(Math.max(deltaSeconds, 0), 0.05);
    this.previousPosition.copy(this.position);
    this.previousHeading = this.heading;
    this.movement.copy(inputMovement);
    if (this.movement.lengthSq() > 1) this.movement.normalize();

    this.targetVelocity.set(this.movement.x, 0, this.movement.y).multiplyScalar(this.tuning.maxSpeed);
    const responsiveness = this.targetVelocity.lengthSq() > 0.0001 ? this.tuning.acceleration : this.tuning.braking;
    const velocityBlend = 1 - Math.exp(-responsiveness * delta);
    this.velocity.lerp(this.targetVelocity, velocityBlend);
    if (this.targetVelocity.lengthSq() === 0 && this.velocity.lengthSq() < 0.0025) this.velocity.set(0, 0, 0);

    this.position.addScaledVector(this.velocity, delta);
    this.position.x = THREE.MathUtils.clamp(
      this.position.x,
      -bounds.halfWidth + this.tuning.edgePadding,
      bounds.halfWidth - this.tuning.edgePadding,
    );
    this.position.z = THREE.MathUtils.clamp(
      this.position.z,
      -bounds.halfDepth + this.tuning.edgePadding,
      bounds.halfDepth - this.tuning.edgePadding,
    );

    const speedSquared = this.velocity.lengthSq();
    if (speedSquared > 0.01) {
      const headingVelocity = this.targetVelocity.lengthSq() > 0.01 ? this.targetVelocity : this.velocity;
      const targetHeading = Math.atan2(headingVelocity.x, headingVelocity.z);
      const headingDelta = Math.atan2(
        Math.sin(targetHeading - this.heading),
        Math.cos(targetHeading - this.heading),
      );
      const turnBlend = 1 - Math.exp(-this.tuning.turnResponsiveness * delta);
      this.heading += headingDelta * turnBlend;
      this.heading = Math.atan2(Math.sin(this.heading), Math.cos(this.heading));
      this.forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    }

    const speedRatio = Math.min(1, Math.sqrt(speedSquared) / this.tuning.maxSpeed);
    const stride = Math.sin(elapsedSeconds * (8 + speedRatio * 6)) * speedRatio;
    this.modelRoot.position.y = Math.abs(Math.sin(elapsedSeconds * 12)) * 0.045 * speedRatio;
    for (let index = 0; index < this.legs.length; index += 1) {
      this.legs[index].rotation.x = stride * (index % 2 === 0 ? 0.44 : -0.44);
    }

    if (this.mixer) {
      this.locomotionTier = this.resolveLocomotionTier(speedRatio);
      this.updateIdleVariant(delta, this.locomotionTier === 'idle');
      const locomotion: THREE.AnimationAction | null =
        this.locomotionTier === 'run'
          ? this.runAction
          : this.locomotionTier === 'trot'
            ? this.trotAction
            : this.locomotionTier === 'walk'
              ? this.walkAction
              : this.idleAction;
      if (this.barkAge >= this.tuning.barkDuration || !Number.isFinite(this.barkAge)) {
        this.transitionAnimation(locomotion, 0.18);
      }
      if (this.currentAction && this.currentAction !== this.barkAction) {
        this.currentAction.timeScale = THREE.MathUtils.clamp(0.55 + speedRatio * 1.2, 0.55, 1.65);
      }
      this.mixer.update(delta);
    }

    this.updateBark(delta);
  }

  /** Pushes the dog out of fence geometry. Call after `update()`, before anything reads `position`. */
  resolveCollision(segments: readonly CollisionSegment[]): void {
    this.collisionPosition.set(this.position.x, this.position.z);
    resolveSegmentCollisions(this.collisionPosition, segments, this.tuning.edgePadding);
    this.position.x = this.collisionPosition.x;
    this.position.z = this.collisionPosition.y;
  }

  prepareRender(interpolation: number): void {
    const alpha = THREE.MathUtils.clamp(interpolation, 0, 1);
    this.group.position.lerpVectors(this.previousPosition, this.position, alpha);
    const headingDelta = Math.atan2(
      Math.sin(this.heading - this.previousHeading),
      Math.cos(this.heading - this.previousHeading),
    );
    this.group.rotation.y = this.previousHeading + headingDelta * alpha;
  }

  tryBark(): boolean {
    if (this.barkCooldownRemaining > 0) return false;

    this.barkCooldownRemaining = this.tuning.barkCooldown;
    this.barkAge = 0;
    this.barkStrength = 1;
    this.barkRadius = 1.5;
    this.barkSequence += 1;
    for (const arc of this.barkArcs) arc.visible = true;
    this.transitionAnimation(this.barkAction, 0.08);

    const event: BarkPulseEvent = {
      x: this.position.x,
      z: this.position.z,
      directionX: this.forward.x,
      directionZ: this.forward.z,
      maxRadius: this.tuning.barkMaxRadius,
      sequence: this.barkSequence,
    };
    for (const listener of this.barkListeners) listener(event);
    return true;
  }

  onBark(listener: (event: BarkPulseEvent) => void): () => void {
    this.barkListeners.add(listener);
    return () => this.barkListeners.delete(listener);
  }

  writeInfluence(target: DogInfluenceTarget): DogInfluenceTarget {
    target.position.copy(this.position);
    target.velocity.copy(this.velocity);
    target.forward.copy(this.forward);
    target.barkStrength = this.barkStrength;
    target.barkRadius = this.barkRadius;
    target.barkSequence = this.barkSequence;
    return target;
  }

  get barkReadiness(): number {
    return THREE.MathUtils.clamp(1 - this.barkCooldownRemaining / this.tuning.barkCooldown, 0, 1);
  }

  get barkCooldown(): number {
    return this.tuning.barkCooldown;
  }

  setMaxSpeed(maxSpeed: number): void {
    this.tuning.maxSpeed = THREE.MathUtils.clamp(maxSpeed, 1, 80);
  }

  reset(position: Readonly<THREE.Vector3> = new THREE.Vector3()): void {
    this.position.copy(position);
    this.previousPosition.copy(position);
    this.group.position.copy(position);
    this.group.rotation.set(0, 0, 0);
    this.heading = 0;
    this.previousHeading = 0;
    this.velocity.set(0, 0, 0);
    this.targetVelocity.set(0, 0, 0);
    this.forward.set(0, 0, 1);
    this.barkStrength = 0;
    this.barkRadius = 0;
    this.barkAge = Infinity;
    this.barkCooldownRemaining = 0;
    for (const arc of this.barkArcs) arc.visible = false;
    for (const material of this.barkArcMaterials) material.opacity = 0;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    if (this.importedModel) {
      this.importedModel.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const list = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of list) material.dispose();
      });
    }
    this.mixer?.stopAllAction();
    this.loader.dracoLoader?.dispose();
    this.barkListeners.clear();
  }

  private transitionAnimation(next: THREE.AnimationAction | null, fadeSeconds: number): void {
    if (!next || next === this.currentAction) return;
    const previous = this.currentAction;
    next.reset().fadeIn(fadeSeconds).play();
    previous?.fadeOut(fadeSeconds);
    this.currentAction = next;
  }

  private updateBark(delta: number): void {
    this.barkCooldownRemaining = Math.max(0, this.barkCooldownRemaining - delta);
    if (!Number.isFinite(this.barkAge)) return;

    this.barkAge += delta;
    const totalDuration = this.tuning.barkDuration + (BARK_ARC_COUNT - 1) * BARK_ARC_STAGGER;
    const overallProgress = THREE.MathUtils.clamp(this.barkAge / totalDuration, 0, 1);
    this.barkStrength = 1 - overallProgress;
    this.barkRadius = THREE.MathUtils.lerp(1.5, this.tuning.barkMaxRadius, overallProgress);

    for (let index = 0; index < this.barkArcs.length; index += 1) {
      const arc = this.barkArcs[index]!;
      const material = this.barkArcMaterials[index]!;
      const staggeredAge = this.barkAge - index * BARK_ARC_STAGGER;
      if (staggeredAge <= 0) {
        arc.visible = false;
        continue;
      }
      const arcProgress = THREE.MathUtils.clamp(staggeredAge / this.tuning.barkDuration, 0, 1);
      const eased = 1 - (1 - arcProgress) ** 3;
      const scale = THREE.MathUtils.lerp(1.5, this.tuning.barkMaxRadius, eased);
      arc.visible = true;
      arc.scale.setScalar(scale);
      material.opacity = (1 - arcProgress) * 0.52;
    }

    if (this.barkAge >= totalDuration) {
      this.barkAge = Infinity;
      this.barkStrength = 0;
      this.barkRadius = 0;
      for (const arc of this.barkArcs) arc.visible = false;
      for (const material of this.barkArcMaterials) material.opacity = 0;
    }
  }

  private resolveLocomotionTier(speedRatio: number): LocomotionTier {
    const [currentLow, currentHigh] = LOCOMOTION_BANDS[this.locomotionTier];
    if (speedRatio >= currentLow && speedRatio < currentHigh) return this.locomotionTier;
    for (const tier of LOCOMOTION_ORDER) {
      const [low, high] = LOCOMOTION_BANDS[tier];
      if (speedRatio >= low && speedRatio < high) return tier;
    }
    return 'run';
  }

  private updateIdleVariant(delta: number, isIdle: boolean): void {
    if (this.idleActions.length < 2) return;
    if (!isIdle) {
      this.idleVariantTimer = 0;
      return;
    }
    this.idleVariantTimer += delta;
    if (this.idleVariantTimer < this.nextIdleSwitchAt) return;
    this.idleVariantTimer = 0;
    this.nextIdleSwitchAt = 4 + Math.random() * 3;
    this.idleVariantIndex = (this.idleVariantIndex + 1) % this.idleActions.length;
    this.idleAction = this.idleActions[this.idleVariantIndex]!;
  }

  private createStandardMaterial(color: THREE.ColorRepresentation, roughness: number): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
    this.materials.push(material);
    return material;
  }

  private createMesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private trackGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }
}
