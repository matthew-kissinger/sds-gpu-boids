import * as THREE from 'three/webgpu';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import {
  createHomeFieldLoader,
  loadHomeFieldModel,
  type HomeFieldModelKey,
} from '../assets/HomeFieldAssets';
import { createGroundMaterial } from '../render/GroundMaterial';
import type { CollisionSegment } from './Collision';
import { CornerFlags } from './CornerFlags';

const SHADOW_CAMERA_MARGIN = 1.15;
const SUN_DISTANCE = 260;

export type GoalDefinition = {
  center: THREE.Vector2;
  radius: number;
};

export type GateDefinition = {
  position: THREE.Vector2;
  width: number;
};

export type PenDefinition = {
  halfWidth: number;
  depth: number;
};

type TreePlacement = {
  x: number;
  z: number;
  type: 'tree1' | 'tree2';
  scale: number;
  rotationY: number;
};

type PlacementManifest = { trees: TreePlacement[] };

type PropPlacement = {
  key: HomeFieldModelKey;
  x: number;
  z: number;
  rotation: number;
  height?: number;
};

const PROP_PLACEMENTS: PropPlacement[] = [
  { key: 'utilityShed', x: 0.72, z: 0.72, rotation: -0.6, height: 5.2 },
  { key: 'hayBalesA', x: 0.78, z: 0.66, rotation: 0.25, height: 1.7 },
  { key: 'hayBalesB', x: 0.82, z: 0.71, rotation: -0.45, height: 1.45 },
  { key: 'troughBucket', x: 0.86, z: 0.78, rotation: 0.15, height: 1.25 },
  { key: 'crateStack', x: 0.73, z: 0.81, rotation: 0.45, height: 2.2 },
  { key: 'barrelRope', x: 0.79, z: 0.83, rotation: -0.35, height: 1.25 },
  { key: 'logPileStump', x: 0.88, z: 0.68, rotation: 0.65, height: 1.25 },
  { key: 'signpost', x: 0.66, z: 0.82, rotation: Math.PI * 0.72, height: 3.2 },
  { key: 'stoneMarker', x: 0.68, z: 0.64, rotation: 0.25, height: 1.7 },
  { key: 'wildflowerA', x: 0.64, z: 0.61, rotation: -0.45, height: 0.9 },
  { key: 'wildflowerB', x: 0.69, z: 0.6, rotation: 0.5, height: 0.9 },
];

export class World {
  readonly group = new THREE.Group();
  readonly goal: GoalDefinition = {
    center: new THREE.Vector2(),
    radius: 38,
  };
  readonly gate: GateDefinition = {
    position: new THREE.Vector2(),
    width: 22,
  };
  readonly pen: PenDefinition = {
    halfWidth: 60,
    depth: 60,
  };

  private readonly loader = createHomeFieldLoader();
  private readonly floor = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), createGroundMaterial());
  private readonly goalFill = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: '#d7b35b', transparent: true, opacity: 0.1, depthWrite: false }),
  );
  private readonly goalRing = new THREE.Mesh(
    new THREE.RingGeometry(0.965, 1, 96),
    new THREE.MeshBasicMaterial({ color: '#f3d487', transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  );
  private readonly goalBeacon = new THREE.Mesh(
    new THREE.CylinderGeometry(4.5, 11, 72, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: '#f6d984',
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  private readonly goalCrown = new THREE.Mesh(
    new THREE.TorusGeometry(8, 0.5, 6, 32),
    new THREE.MeshBasicMaterial({ color: '#ffe5a0', transparent: true, opacity: 0.62, depthWrite: false }),
  );
  private readonly assetLayer = new THREE.Group();
  private readonly perimeterLayer = new THREE.Group();
  private readonly disposableRoots: THREE.Object3D[] = [];
  private readonly ambientLight = new THREE.HemisphereLight('#eef3ff', '#3c5a34', 0.9);
  private readonly sunLight = new THREE.DirectionalLight('#fff3c4', 2.6);
  private readonly fillLight = new THREE.DirectionalLight('#ffd8a8', 0.9);
  private readonly cornerFlags: CornerFlags;
  private readonly collisionSegments: CollisionSegment[] = [];
  private extent = 140;
  private assetsReady = false;

  constructor(scene: THREE.Scene, sunDirection: THREE.Vector3) {
    this.group.name = 'Home Field - GPU edition';
    this.assetLayer.name = 'Home Field authored assets';
    this.perimeterLayer.name = 'Home Field fence and corral';

    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.04;
    this.floor.receiveShadow = true;
    this.group.add(this.floor);

    this.goalFill.rotation.x = -Math.PI / 2;
    this.goalFill.position.y = 0.025;
    this.goalRing.rotation.x = -Math.PI / 2;
    this.goalRing.position.y = 0.045;
    this.goalCrown.rotation.x = Math.PI / 2;
    this.group.add(this.goalFill, this.goalRing, this.goalBeacon, this.goalCrown, this.assetLayer, this.perimeterLayer);

    this.sunLight.position.copy(sunDirection).multiplyScalar(SUN_DISTANCE);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(512, 512);
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.6;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = SUN_DISTANCE * 2.2;

    const fillDirection = new THREE.Vector3(-sunDirection.x, 0.35, -sunDirection.z).normalize();
    this.fillLight.position.copy(fillDirection).multiplyScalar(SUN_DISTANCE * 0.6);
    this.fillLight.castShadow = false;

    this.group.add(this.ambientLight, this.sunLight, this.fillLight);

    this.cornerFlags = new CornerFlags([
      [-this.extent, -this.extent],
      [this.extent, -this.extent],
      [-this.extent, this.extent],
      [this.extent, this.extent],
    ]);
    this.group.add(this.cornerFlags.group);

    scene.add(this.group);
    this.configure(this.extent);
  }

  get fenceCollisionSegments(): readonly CollisionSegment[] {
    return this.collisionSegments;
  }

  async loadAssets(): Promise<void> {
    const keys: HomeFieldModelKey[] = [
      'farmhouse', 'fence', 'gate', 'tree1', 'tree2', 'rock1', 'rock2', 'rock3',
      ...PROP_PLACEMENTS.map((placement) => placement.key),
    ];
    const uniqueKeys = Array.from(new Set(keys));
    const entries = await Promise.all(uniqueKeys.map(async (key) => [key, await loadHomeFieldModel(this.loader, key)] as const));
    const models = new Map<HomeFieldModelKey, GLTF>(entries);
    const manifest = await fetch(`${import.meta.env.BASE_URL}placement/field.json`).then((response) => {
      if (!response.ok) throw new Error(`Home Field placement manifest failed: ${response.status}`);
      return response.json() as Promise<PlacementManifest>;
    });

    this.addFarmstead(models);
    this.addTreeLine(models, manifest.trees);
    this.addRockClusters(models);
    this.addFenceAndCorral(models.get('fence'), models.get('gate'));
    this.assetsReady = true;
  }

  configure(extent: number): void {
    this.extent = extent;
    const terrainSpan = extent * 3.5;
    this.floor.scale.set(terrainSpan, terrainSpan, 1);

    const shadowExtent = extent * SHADOW_CAMERA_MARGIN;
    const shadowCamera = this.sunLight.shadow.camera;
    shadowCamera.left = -shadowExtent;
    shadowCamera.right = shadowExtent;
    shadowCamera.top = shadowExtent;
    shadowCamera.bottom = -shadowExtent;
    shadowCamera.updateProjectionMatrix();

    this.gate.width = Math.max(16, extent * 0.1);
    this.gate.position.set(0, extent);
    this.pen.halfWidth = Math.max(32, extent * 0.22);
    this.pen.depth = Math.max(34, extent * 0.24);
    this.goal.radius = this.pen.halfWidth;
    this.goal.center.set(0, extent + this.pen.depth * 0.5);
    this.goalFill.position.set(this.goal.center.x, 0.025, this.goal.center.y);
    this.goalRing.position.set(this.gate.position.x, 0.045, this.gate.position.y);
    this.goalBeacon.position.set(this.gate.position.x, 36, this.gate.position.y + 4);
    this.goalCrown.position.set(this.gate.position.x, 48, this.gate.position.y + 4);
    this.goalFill.scale.set(this.pen.halfWidth * 2, this.pen.depth, 1);
    this.goalRing.scale.setScalar(this.gate.width * 0.62);
  }

  update(elapsed: number, holdProgress: number): void {
    this.cornerFlags.update(elapsed);
    const pulse = 1 + Math.sin(elapsed * 2.1) * 0.012 + holdProgress * 0.035;
    this.goalRing.scale.setScalar(this.gate.width * 0.62 * pulse);
    const material = this.goalRing.material as THREE.MeshBasicMaterial;
    material.opacity = 0.48 + holdProgress * 0.42;
    this.goalCrown.rotation.z = elapsed * 0.24;
    this.goalCrown.scale.setScalar(1 + Math.sin(elapsed * 1.7) * 0.08);
    (this.goalBeacon.material as THREE.MeshBasicMaterial).opacity = 0.065 + holdProgress * 0.08;
  }

  get loaded(): boolean {
    return this.assetsReady;
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.cornerFlags.dispose();
    this.loader.dracoLoader?.dispose();
    this.group.removeFromParent();
  }

  private addFarmstead(models: Map<HomeFieldModelKey, GLTF>): void {
    const farmX = this.extent + 90;
    const farmZ = this.extent + 30;
    const farmhouse = models.get('farmhouse');
    if (farmhouse) {
      const house = farmhouse.scene.clone(true);
      house.position.set(farmX, 0, farmZ);
      house.rotation.y = Math.PI * 1.25;
      this.prepareStaticModel(house);
      this.assetLayer.add(house);
      this.disposableRoots.push(house);
    }

    for (const placement of PROP_PLACEMENTS) {
      const gltf = models.get(placement.key);
      if (!gltf) continue;
      const prop = gltf.scene.clone(true);
      this.fitToGroundHeight(prop, placement.height ?? 1);
      prop.position.set(
        farmX + (placement.x - 0.78) * 180,
        0,
        farmZ + (placement.z - 0.72) * 160,
      );
      prop.rotation.y = placement.rotation;
      this.prepareStaticModel(prop);
      this.assetLayer.add(prop);
      this.disposableRoots.push(prop);
    }
  }

  private addTreeLine(models: Map<HomeFieldModelKey, GLTF>, source: TreePlacement[]): void {
    const scaleFactor = this.extent / 100;
    for (const type of ['tree1', 'tree2'] as const) {
      const gltf = models.get(type);
      if (!gltf) continue;
      const placements = source.filter((placement) => {
        if (placement.type !== type) return false;
        const x = placement.x * scaleFactor;
        const z = placement.z * scaleFactor;
        const insideField = Math.abs(x) <= this.extent + 6 && Math.abs(z) <= this.extent + 6;
        const blocksPen = Math.abs(x) < this.pen.halfWidth + 28
          && z > this.extent - 18
          && z < this.extent + this.pen.depth + 30;
        return !insideField && !blocksPen;
      });
      this.addInstancedGltf(gltf, placements.map((placement) => {
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3(placement.x * scaleFactor, 0, placement.z * scaleFactor);
        const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.rotationY);
        const size = placement.scale * 0.78;
        matrix.compose(position, rotation, new THREE.Vector3(size, size, size));
        return matrix;
      }), `treeline-${type}`);
    }
  }

  private addRockClusters(models: Map<HomeFieldModelKey, GLTF>): void {
    const placements: Array<{ key: 'rock1' | 'rock2' | 'rock3'; angle: number; radius: number; scale: number }> = [];
    for (let index = 0; index < 34; index += 1) {
      placements.push({
        key: (`rock${(index % 3) + 1}`) as 'rock1' | 'rock2' | 'rock3',
        angle: index * 2.399,
        radius: this.extent * (1.08 + ((index * 17) % 31) / 100),
        scale: 4 + (index % 5) * 0.8,
      });
    }
    for (const key of ['rock1', 'rock2', 'rock3'] as const) {
      const gltf = models.get(key);
      if (!gltf) continue;
      gltf.scene.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(gltf.scene);
      const nativeHeight = Math.max(0.0001, bounds.max.y - bounds.min.y);
      const normalization = 0.2 / nativeHeight;
      this.addInstancedGltf(gltf, placements.filter((entry) => entry.key === key).map((entry) => {
        const finalScale = normalization * entry.scale;
        const position = new THREE.Vector3(
          Math.cos(entry.angle) * entry.radius,
          -bounds.min.y * finalScale,
          Math.sin(entry.angle) * entry.radius,
        );
        const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), entry.angle * 1.7);
        return new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(finalScale, finalScale, finalScale));
      }), `rock-ring-${key}`);
    }
  }

  private addFenceAndCorral(fence: GLTF | undefined, gate: GLTF | undefined): void {
    if (!fence) return;
    fence.scene.updateMatrixWorld(true);
    const post = this.findMesh(fence.scene, 'Mesh_Fence_Post_Runtime');
    const rail = this.findMesh(fence.scene, 'Mesh_Fence_Rail_Runtime');
    if (!post || !rail) return;

    const spacing = 5;
    const postMatrices: THREE.Matrix4[] = [];
    const railMatrices: THREE.Matrix4[] = [];
    const addFenceLine = (start: THREE.Vector3, end: THREE.Vector3): void => {
      this.collisionSegments.push({ x1: start.x, z1: start.z, x2: end.x, z2: end.z });
      const distance = start.distanceTo(end);
      const count = Math.max(1, Math.ceil(distance / spacing));
      const direction = end.clone().sub(start);
      const angle = -Math.atan2(direction.z, direction.x);
      for (let index = 0; index <= count; index += 1) {
        const t = index / count;
        const position = start.clone().lerp(end, t);
        postMatrices.push(new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle), new THREE.Vector3(1, 1, 1)));
        if (index < count) {
          const next = start.clone().lerp(end, (index + 1) / count);
          const center = position.clone().lerp(next, 0.5);
          const length = position.distanceTo(next);
          for (const y of [0.5, 1.2, 1.9]) {
            railMatrices.push(new THREE.Matrix4().compose(new THREE.Vector3(center.x, y, center.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle), new THREE.Vector3(length, 1, 1)));
          }
        }
      }
    };

    const e = this.extent;
    const halfGate = this.gate.width * 0.5;
    const halfPen = this.pen.halfWidth;
    const penBack = e + this.pen.depth;
    addFenceLine(new THREE.Vector3(-e, 0, -e), new THREE.Vector3(e, 0, -e));
    addFenceLine(new THREE.Vector3(-e, 0, -e), new THREE.Vector3(-e, 0, e));
    addFenceLine(new THREE.Vector3(e, 0, -e), new THREE.Vector3(e, 0, e));
    addFenceLine(new THREE.Vector3(-e, 0, e), new THREE.Vector3(-halfGate, 0, e));
    addFenceLine(new THREE.Vector3(halfGate, 0, e), new THREE.Vector3(e, 0, e));
    addFenceLine(new THREE.Vector3(-halfPen, 0, e), new THREE.Vector3(-halfPen, 0, penBack));
    addFenceLine(new THREE.Vector3(halfPen, 0, e), new THREE.Vector3(halfPen, 0, penBack));
    addFenceLine(new THREE.Vector3(-halfPen, 0, penBack), new THREE.Vector3(halfPen, 0, penBack));

    this.addInstancedMesh(post, postMatrices, 'field-fence-posts');
    this.addInstancedMesh(rail, railMatrices, 'field-fence-rails');

    if (gate) {
      const source = gate.scene.getObjectByName('Gate_Assembly') ?? gate.scene;
      const gateRoot = source.clone(true);
      gateRoot.position.set(this.gate.position.x, 0, this.gate.position.y);
      gateRoot.scale.setScalar(this.gate.width / 8);
      this.prepareStaticModel(gateRoot);
      this.perimeterLayer.add(gateRoot);
      this.disposableRoots.push(gateRoot);
    }
  }

  private addInstancedGltf(gltf: GLTF, matrices: THREE.Matrix4[], name: string): void {
    gltf.scene.updateMatrixWorld(true);
    let primitive = 0;
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const mesh = new THREE.InstancedMesh(object.geometry, object.material, matrices.length);
      mesh.name = `${name}-${primitive++}`;
      const combined = new THREE.Matrix4();
      for (let index = 0; index < matrices.length; index += 1) {
        combined.multiplyMatrices(matrices[index]!, object.matrixWorld);
        mesh.setMatrixAt(index, combined);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.assetLayer.add(mesh);
    });
  }

  private addInstancedMesh(source: THREE.Mesh, matrices: THREE.Matrix4[], name: string): void {
    const mesh = new THREE.InstancedMesh(source.geometry, source.material, matrices.length);
    mesh.name = name;
    const combined = new THREE.Matrix4();
    for (let index = 0; index < matrices.length; index += 1) {
      combined.multiplyMatrices(matrices[index]!, source.matrixWorld);
      mesh.setMatrixAt(index, combined);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.perimeterLayer.add(mesh);
  }

  private findMesh(root: THREE.Object3D, name: string): THREE.Mesh | null {
    let result: THREE.Mesh | null = null;
    root.traverse((object) => {
      if (!result && object instanceof THREE.Mesh && object.name === name) result = object;
    });
    return result;
  }

  private fitToGroundHeight(root: THREE.Object3D, height: number): void {
    let box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    if (size.y > 0) root.scale.multiplyScalar(height / size.y);
    box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -box.min.y, -center.z);
  }

  private prepareStaticModel(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = false;
      object.receiveShadow = true;
    });
  }

}
