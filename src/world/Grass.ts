import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  attribute,
  clamp,
  float,
  hash,
  instanceIndex,
  max,
  mix,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  time,
  transformNormalToView,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { createMulberry32 } from '../gpu/random';

const BASE_COLOR = new THREE.Color('#5a7a3e');
const MID_COLOR = new THREE.Color('#8aa860');
const TIP_COLOR = new THREE.Color('#c4d68c');

const CLUMP_COUNT = 6_000;
const BLADE_WIDTH = 0.5;
const BLADE_HEIGHT = 0.85;
const PUSH_RADIUS = 1.7;

/**
 * A sparse cross-billboard grass layer: two crossed quads per clump instead of sds's 5-blade
 * clumps, dog-only interaction instead of per-sheep (100k sheep makes per-entity interaction
 * a non-starter regardless of fidelity level), and a single sine sway instead of layered gusts.
 */
export class Grass {
  readonly mesh: THREE.InstancedMesh;

  private readonly dogPosition = uniform(new THREE.Vector2(0, 0));

  constructor(extent: number, seed = 1) {
    const geometry = this.createClumpGeometry();
    const material = new THREE.MeshStandardNodeMaterial({
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    // Cross-quads carry real geometric normals, so under directional lighting roughly half of
    // any randomly-rotated population would face away from the sun and render near-black -
    // the standard fix for foliage cards is to fake the shading normal as straight up so every
    // blade lights consistently regardless of which way it happens to be rotated.
    material.normalNode = transformNormalToView(vec3(0, 1, 0));

    const heightFactor = attribute<'float'>('heightFactor', 'float');
    const windPower = heightFactor.mul(heightFactor);
    const clumpPhase = hash(instanceIndex).mul(6.283);
    const windDirection = vec2(0.7, 0.3);
    const sway = sin(time.mul(1.4).add(clumpPhase)).mul(0.12).mul(windPower);
    const windOffset = vec3(windDirection.x.mul(sway), float(0), windDirection.y.mul(sway));

    const worldXZ = vec2(positionWorld.x, positionWorld.z);
    const toClump = worldXZ.sub(this.dogPosition);
    const distance = max(toClump.length(), float(0.001));
    const pushFalloff = clamp(float(1).sub(distance.div(PUSH_RADIUS)), float(0), float(1));
    const push = vec3(toClump.x, float(0), toClump.y)
      .div(distance)
      .mul(pushFalloff.mul(pushFalloff))
      .mul(0.6)
      .mul(windPower);

    material.positionNode = positionLocal.add(windOffset).add(push);
    const lowBand = mix(BASE_COLOR, MID_COLOR, smoothstep(float(0), float(0.5), heightFactor));
    material.colorNode = mix(lowBand, vec3(TIP_COLOR.r, TIP_COLOR.g, TIP_COLOR.b), smoothstep(float(0.5), float(1), heightFactor));

    this.mesh = new THREE.InstancedMesh(geometry, material, CLUMP_COUNT);
    this.mesh.name = 'Home Field grass';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.scatter(extent, seed);
  }

  setDog(position: Readonly<THREE.Vector2>): void {
    this.dogPosition.value.copy(position);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }

  private scatter(extent: number, seed: number): void {
    const random = createMulberry32(seed);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const radius = Math.min(extent * 1.05, 150);

    for (let index = 0; index < CLUMP_COUNT; index += 1) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * radius;
      position.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
      quaternion.setFromAxisAngle(up, random() * Math.PI * 2);
      const clumpScale = 0.7 + random() * 0.7;
      scale.set(clumpScale, clumpScale * (0.8 + random() * 0.4), clumpScale);
      matrix.compose(position, quaternion, scale);
      this.mesh.setMatrixAt(index, matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
  }

  private createClumpGeometry(): THREE.BufferGeometry {
    const planeA = new THREE.PlaneGeometry(BLADE_WIDTH, BLADE_HEIGHT);
    planeA.translate(0, BLADE_HEIGHT / 2, 0);
    const planeB = planeA.clone();
    planeB.rotateY(Math.PI / 2);

    const merged = mergeGeometries([planeA, planeB], false);
    planeA.dispose();
    planeB.dispose();
    if (!merged) throw new Error('Could not build the grass clump geometry.');

    const positionAttribute = merged.getAttribute('position');
    const heights = new Float32Array(positionAttribute.count);
    for (let index = 0; index < positionAttribute.count; index += 1) {
      heights[index] = THREE.MathUtils.clamp(positionAttribute.getY(index) / BLADE_HEIGHT, 0, 1);
    }
    // heightFactor varies per-vertex within the shared clump shape, not per-instance, so this
    // stays a plain BufferGeometry - THREE.InstancedMesh already manages the per-clump
    // transforms via instanceMatrix. InstancedBufferGeometry defaults instanceCount to
    // Infinity for its own (unused here) per-instance-attribute path, which crashes
    // drawIndexed() when paired with InstancedMesh instead of being set explicitly.
    merged.setAttribute('heightFactor', new THREE.BufferAttribute(heights, 1));
    merged.computeBoundingSphere();
    return merged;
  }
}
