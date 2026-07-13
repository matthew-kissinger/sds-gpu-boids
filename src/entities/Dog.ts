import * as THREE from 'three/webgpu';
import { createHomeFieldLoader, loadHomeFieldModel } from '../assets/HomeFieldAssets';

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
  turnResponsiveness: 15,
  edgePadding: 1.2,
  barkCooldown: 1.05,
  barkDuration: 0.46,
  barkMaxRadius: 32,
};

export class Dog {
  readonly group = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, -1);

  barkStrength = 0;
  barkRadius = 0;
  barkSequence = 0;

  private readonly modelRoot = new THREE.Group();
  private readonly loader = createHomeFieldLoader();
  private readonly targetVelocity = new THREE.Vector3();
  private readonly movement = new THREE.Vector2();
  private readonly legs: THREE.Mesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly barkListeners = new Set<(event: BarkPulseEvent) => void>();
  private readonly barkRingMaterial: THREE.MeshBasicMaterial;
  private readonly barkRing: THREE.Mesh;
  private readonly tuning: DogTuning;
  private importedModel: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private idleAction: THREE.AnimationAction | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  private runAction: THREE.AnimationAction | null = null;
  private barkAction: THREE.AnimationAction | null = null;

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

    const barkRingGeometry = this.trackGeometry(new THREE.RingGeometry(0.86, 1, 40));
    this.barkRingMaterial = new THREE.MeshBasicMaterial({
      color: '#f5c85b',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.materials.push(this.barkRingMaterial);
    this.barkRing = new THREE.Mesh(barkRingGeometry, this.barkRingMaterial);
    this.barkRing.name = 'Bark pressure pulse';
    this.barkRing.rotation.x = -Math.PI / 2;
    this.barkRing.position.y = 0.05;
    this.barkRing.visible = false;
    this.group.add(this.barkRing);
  }

  async loadModel(): Promise<void> {
    const gltf = await loadHomeFieldModel(this.loader, 'dog');
    this.importedModel = gltf.scene;
    this.importedModel.name = 'Jep - Home Field sheepdog';
    this.importedModel.scale.setScalar(3.2);
    this.importedModel.rotation.y = Math.PI;
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
    this.idleAction = clip('Idle_1') ?? clip('Idle_2');
    this.walkAction = clip('Walk_F_IP') ?? this.idleAction;
    this.runAction = clip('Run_F_IP') ?? clip('RunFast_F_IP') ?? this.walkAction;
    this.barkAction = clip('Bark');
    this.transitionAnimation(this.idleAction, 0);
  }

  update(deltaSeconds: number, elapsedSeconds: number, inputMovement: THREE.Vector2, bounds: ArenaBounds): void {
    const delta = Math.min(Math.max(deltaSeconds, 0), 0.05);
    this.movement.copy(inputMovement);
    if (this.movement.lengthSq() > 1) this.movement.normalize();

    this.targetVelocity.set(this.movement.x, 0, this.movement.y).multiplyScalar(this.tuning.maxSpeed);
    const responsiveness = this.targetVelocity.lengthSq() > 0.0001 ? this.tuning.acceleration : this.tuning.braking;
    const velocityBlend = 1 - Math.exp(-responsiveness * delta);
    this.velocity.lerp(this.targetVelocity, velocityBlend);
    if (this.targetVelocity.lengthSq() === 0 && this.velocity.lengthSq() < 0.0025) this.velocity.set(0, 0, 0);

    this.group.position.addScaledVector(this.velocity, delta);
    this.group.position.x = THREE.MathUtils.clamp(
      this.group.position.x,
      -bounds.halfWidth + this.tuning.edgePadding,
      bounds.halfWidth - this.tuning.edgePadding,
    );
    this.group.position.z = THREE.MathUtils.clamp(
      this.group.position.z,
      -bounds.halfDepth + this.tuning.edgePadding,
      bounds.halfDepth - this.tuning.edgePadding,
    );

    const speedSquared = this.velocity.lengthSq();
    if (speedSquared > 0.01) {
      const targetHeading = Math.atan2(this.velocity.x, -this.velocity.z);
      const headingDelta = Math.atan2(
        Math.sin(targetHeading - this.group.rotation.y),
        Math.cos(targetHeading - this.group.rotation.y),
      );
      const turnBlend = 1 - Math.exp(-this.tuning.turnResponsiveness * delta);
      this.group.rotation.y += headingDelta * turnBlend;
      this.forward.set(Math.sin(this.group.rotation.y), 0, -Math.cos(this.group.rotation.y));
    }

    const speedRatio = Math.min(1, Math.sqrt(speedSquared) / this.tuning.maxSpeed);
    const stride = Math.sin(elapsedSeconds * (8 + speedRatio * 6)) * speedRatio;
    this.modelRoot.position.y = Math.abs(Math.sin(elapsedSeconds * 12)) * 0.045 * speedRatio;
    for (let index = 0; index < this.legs.length; index += 1) {
      this.legs[index].rotation.x = stride * (index % 2 === 0 ? 0.44 : -0.44);
    }

    if (this.mixer) {
      const locomotion = speedRatio > 0.56 ? this.runAction : speedRatio > 0.035 ? this.walkAction : this.idleAction;
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

  tryBark(): boolean {
    if (this.barkCooldownRemaining > 0) return false;

    this.barkCooldownRemaining = this.tuning.barkCooldown;
    this.barkAge = 0;
    this.barkStrength = 1;
    this.barkRadius = 1.5;
    this.barkSequence += 1;
    this.barkRing.visible = true;
    this.transitionAnimation(this.barkAction, 0.08);

    const event: BarkPulseEvent = {
      x: this.group.position.x,
      z: this.group.position.z,
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
    target.position.copy(this.group.position);
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
    this.group.position.copy(position);
    this.group.rotation.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.targetVelocity.set(0, 0, 0);
    this.forward.set(0, 0, -1);
    this.barkStrength = 0;
    this.barkRadius = 0;
    this.barkAge = Infinity;
    this.barkCooldownRemaining = 0;
    this.barkRing.visible = false;
    this.barkRingMaterial.opacity = 0;
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
    const progress = THREE.MathUtils.clamp(this.barkAge / this.tuning.barkDuration, 0, 1);
    this.barkStrength = 1 - progress;
    this.barkRadius = THREE.MathUtils.lerp(1.5, this.tuning.barkMaxRadius, progress);

    const ringScale = this.barkRadius;
    this.barkRing.scale.set(ringScale, ringScale, ringScale);
    this.barkRingMaterial.opacity = (1 - progress) * 0.52;

    if (progress >= 1) {
      this.barkAge = Infinity;
      this.barkStrength = 0;
      this.barkRadius = 0;
      this.barkRing.visible = false;
      this.barkRingMaterial.opacity = 0;
    }
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
