import * as THREE from 'three/webgpu';

const POLE_HEIGHT = 2;
const FLAG_WIDTH = 0.5;
const FLAG_HEIGHT = 0.3;
const WAVE_SPEED = 2;
const WAVE_AMPLITUDE = 0.1;
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** Four small pole-and-banner markers at the field corners, each waving on its own phase. */
export class CornerFlags {
  readonly group = new THREE.Group();

  private readonly poleGeometry = new THREE.CylinderGeometry(0.03, 0.03, POLE_HEIGHT, 6);
  private readonly flagGeometry = new THREE.PlaneGeometry(FLAG_WIDTH, FLAG_HEIGHT);
  private readonly poleMaterial = new THREE.MeshStandardMaterial({ color: '#f4f1e6', roughness: 0.5 });
  private readonly flagMaterial = new THREE.MeshStandardMaterial({
    color: '#c8433a',
    side: THREE.DoubleSide,
    emissive: '#3a0f0f',
    emissiveIntensity: 0.15,
    roughness: 0.6,
  });
  private readonly poles: THREE.InstancedMesh;
  private readonly flags: THREE.InstancedMesh;
  private readonly corners: ReadonlyArray<readonly [number, number]>;
  private readonly phases: number[];
  private readonly flagMatrix = new THREE.Matrix4();
  private readonly flagPosition = new THREE.Vector3();
  private readonly flagQuaternion = new THREE.Quaternion();
  private readonly flagScale = new THREE.Vector3(1, 1, 1);

  constructor(corners: ReadonlyArray<readonly [number, number]>) {
    this.group.name = 'Home Field corner flags';
    this.corners = corners;
    this.phases = corners.map((_, index) => index * 1.3);

    // Instanced, like every other repeated decorative object in World.ts (fence, trees, rocks) -
    // 4 corners don't need their own draw calls. Shadows are skipped: at 512x512 over a 320+ unit
    // span, a 0.03-radius pole and a 0.5x0.3 flag both fall below one shadow-map texel anyway.
    this.poles = new THREE.InstancedMesh(this.poleGeometry, this.poleMaterial, corners.length);
    this.flags = new THREE.InstancedMesh(this.flagGeometry, this.flagMaterial, corners.length);
    this.poles.castShadow = false;
    this.flags.castShadow = false;
    this.poles.receiveShadow = true;
    this.flags.receiveShadow = true;

    const matrix = new THREE.Matrix4();
    corners.forEach(([x, z], index) => {
      matrix.makeTranslation(x, POLE_HEIGHT / 2, z);
      this.poles.setMatrixAt(index, matrix);
      matrix.makeTranslation(x + FLAG_WIDTH / 2, POLE_HEIGHT - FLAG_HEIGHT / 2 - 0.15, z);
      this.flags.setMatrixAt(index, matrix);
    });
    this.poles.instanceMatrix.needsUpdate = true;
    this.flags.instanceMatrix.needsUpdate = true;
    this.poles.computeBoundingSphere();
    this.flags.computeBoundingSphere();

    this.group.add(this.poles, this.flags);
  }

  update(elapsed: number): void {
    for (let index = 0; index < this.corners.length; index += 1) {
      const [x, z] = this.corners[index]!;
      const wave = Math.sin(elapsed * WAVE_SPEED + this.phases[index]!) * WAVE_AMPLITUDE;
      this.flagPosition.set(x + FLAG_WIDTH / 2, POLE_HEIGHT - FLAG_HEIGHT / 2 - 0.15, z);
      this.flagQuaternion.setFromAxisAngle(Z_AXIS, wave);
      this.flagMatrix.compose(this.flagPosition, this.flagQuaternion, this.flagScale);
      this.flags.setMatrixAt(index, this.flagMatrix);
    }
    this.flags.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.poleGeometry.dispose();
    this.flagGeometry.dispose();
    this.poleMaterial.dispose();
    this.flagMaterial.dispose();
    this.group.removeFromParent();
  }
}
