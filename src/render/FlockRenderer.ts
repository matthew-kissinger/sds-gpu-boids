import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  attribute,
  float,
  hash,
  instanceIndex,
  positionLocal,
  time,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { GpuBoidSystem } from '../gpu';

const WHITE = new THREE.Color('#f2ead2');
const WOOL_SHADOW = new THREE.Color('#c9b991');
const FACE = new THREE.Color('#302923');
const HOOF = new THREE.Color('#191817');
const EYE = new THREE.Color('#fdf9e9');
const NOSE = new THREE.Color('#c97c7e');

export class FlockRenderer {
  readonly mesh: THREE.Mesh;
  readonly trianglesPerSheep: number;

  private readonly geometry = this.createSheepGeometry();
  private readonly material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.92,
    metalness: 0,
  });
  private readonly scale = uniform(0.82);

  constructor(private readonly boids: GpuBoidSystem) {
    const nodes = boids.getRenderNodes();
    const speedSq = nodes.velocity.x.mul(nodes.velocity.x).add(nodes.velocity.z.mul(nodes.velocity.z));
    const safeLength = speedSq.max(float(0.0001)).sqrt();
    const forward = vec2(nodes.velocity.x.div(safeLength), nodes.velocity.z.div(safeLength));
    const phase = time.mul(7).add(hash(instanceIndex).mul(6.283));
    const bob = phase.sin().abs().mul(speedSq.min(16).div(16)).mul(0.08);
    const local = positionLocal.mul(this.scale);
    const rotated = vec3(
      local.x.mul(forward.y).add(local.z.mul(forward.x)),
      local.y.add(bob),
      local.z.mul(forward.y).sub(local.x.mul(forward.x)),
    );
    this.material.positionNode = rotated.add(nodes.position);
    this.material.colorNode = attribute('color', 'vec3');

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.geometry.instanceCount = boids.count;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.name = '100k GPU-instanced Home Field sheep';
    this.trianglesPerSheep = (this.geometry.index?.count ?? this.geometry.getAttribute('position').count) / 3;
  }

  syncCount(): void {
    this.geometry.instanceCount = this.boids.count;
    this.scale.value = this.boids.count >= 75_000 ? 0.42 : this.boids.count >= 32_000 ? 0.58 : 0.88;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }

  private createSheepGeometry(): THREE.InstancedBufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const add = (geometry: THREE.BufferGeometry, color: THREE.Color): void => {
      const compatible = geometry.index ? geometry.toNonIndexed() : geometry;
      if (compatible !== geometry) geometry.dispose();
      const colors = new Float32Array(compatible.getAttribute('position').count * 3);
      for (let index = 0; index < colors.length; index += 3) {
        colors[index] = color.r;
        colors[index + 1] = color.g;
        colors[index + 2] = color.b;
      }
      compatible.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      parts.push(compatible);
    };

    const body = new THREE.IcosahedronGeometry(0.78, 0);
    body.scale(1, 0.82, 1.18);
    body.translate(0, 0.88, 0.05);
    add(body, WHITE);

    const woolPatch = new THREE.IcosahedronGeometry(0.55, 0);
    woolPatch.scale(1.15, 0.75, 1.25);
    woolPatch.translate(0, 1.05, 0.18);
    add(woolPatch, WOOL_SHADOW);

    const head = new THREE.IcosahedronGeometry(0.38, 0);
    head.scale(0.8, 0.95, 1.05);
    head.translate(0, 0.92, -0.93);
    add(head, FACE);

    const legGeometry = new THREE.ConeGeometry(0.11, 0.55, 3);
    for (const [x, z] of [[-0.34, -0.35], [0.34, -0.35], [-0.34, 0.43], [0.34, 0.43]] as const) {
      const leg = legGeometry.clone();
      leg.translate(x, 0.29, z);
      add(leg, HOOF);
    }
    legGeometry.dispose();

    const earGeometry = new THREE.ConeGeometry(0.14, 0.34, 3);
    for (const side of [-1, 1]) {
      const ear = earGeometry.clone();
      ear.rotateZ(side * 1.05);
      ear.translate(side * 0.31, 1.15, -0.88);
      add(ear, FACE);
    }
    earGeometry.dispose();

    for (const side of [-1, 1]) {
      const eye = new THREE.OctahedronGeometry(0.075, 0);
      eye.scale(1, 1.1, 0.4);
      eye.translate(side * 0.13, 1.01, -1.27);
      add(eye, EYE);
    }

    const nose = new THREE.OctahedronGeometry(0.065, 0);
    nose.scale(1.2, 0.75, 0.45);
    nose.translate(0, 0.82, -1.31);
    add(nose, NOSE);

    const tail = new THREE.ConeGeometry(0.12, 0.48, 5);
    tail.rotateX(-1.05);
    tail.translate(0, 1.1, 0.92);
    add(tail, WHITE);

    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!merged) throw new Error('Could not build the Home Field sheep geometry.');
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(merged.index);
    for (const [name, value] of Object.entries(merged.attributes)) geometry.setAttribute(name, value);
    merged.dispose();
    geometry.instanceCount = 0;
    geometry.computeBoundingSphere();
    return geometry;
  }
}
