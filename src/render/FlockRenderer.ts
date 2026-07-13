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

const WOOL = new THREE.Color('#f7f2df');
const FACE = new THREE.Color('#38322d');
const HOOF = new THREE.Color('#24211f');
const EYE = new THREE.Color('#fbfaf2');
const PUPIL = new THREE.Color('#090908');
const NOSE = new THREE.Color('#d18a8d');

export class FlockRenderer {
  readonly mesh: THREE.Mesh;

  private readonly detailedGeometry: THREE.InstancedBufferGeometry;
  private readonly crowdGeometry: THREE.InstancedBufferGeometry;
  private geometry: THREE.InstancedBufferGeometry;
  private readonly material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.92,
    metalness: 0,
  });
  private readonly scale = uniform(0.82);

  constructor(private readonly boids: GpuBoidSystem) {
    this.detailedGeometry = this.createProductionSheepGeometry(false);
    this.crowdGeometry = this.createProductionSheepGeometry(true);
    this.geometry = boids.count >= 32_000 ? this.crowdGeometry : this.detailedGeometry;

    const nodes = boids.getRenderNodes();
    const speedSq = nodes.velocity.x.mul(nodes.velocity.x).add(nodes.velocity.z.mul(nodes.velocity.z));
    const safeLength = speedSq.max(float(0.0001)).sqrt();
    const forward = vec2(nodes.velocity.x.div(safeLength), nodes.velocity.z.div(safeLength));
    const phase = time.mul(7).add(hash(instanceIndex).mul(6.283));
    const bob = phase.sin().abs().mul(speedSq.min(16).div(16)).mul(0.08);
    const retiredScale = float(0.16).add(nodes.state.mul(0.84));
    const local = positionLocal.mul(this.scale).mul(retiredScale);
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
    this.mesh.name = 'Production-style GPU-instanced Home Field sheep';
    this.syncCount();
  }

  get trianglesPerSheep(): number {
    return (this.geometry.index?.count ?? this.geometry.getAttribute('position').count) / 3;
  }

  syncCount(): void {
    const nextGeometry = this.boids.count >= 32_000 ? this.crowdGeometry : this.detailedGeometry;
    if (nextGeometry !== this.geometry) {
      this.geometry.instanceCount = 0;
      this.geometry = nextGeometry;
      this.mesh.geometry = nextGeometry;
    }
    this.geometry.instanceCount = this.boids.count;
    this.scale.value = this.boids.count >= 75_000 ? 0.46 : this.boids.count >= 32_000 ? 0.62 : 0.9;
  }

  dispose(): void {
    this.detailedGeometry.dispose();
    this.crowdGeometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }

  private createProductionSheepGeometry(crowdLod: boolean): THREE.InstancedBufferGeometry {
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

    const body = new THREE.SphereGeometry(1, crowdLod ? 6 : 12, crowdLod ? 4 : 8);
    body.scale(1, 0.9, 1.1);
    body.translate(0, 0.875, 0);
    add(body, WOOL);

    const head = new THREE.SphereGeometry(0.45, crowdLod ? 6 : 10, crowdLod ? 4 : 6);
    head.scale(0.85, 0.9, 1);
    head.translate(0, 0.88, 0.85);
    add(head, FACE);

    const legSource = new THREE.CylinderGeometry(0.11, 0.13, 0.55, crowdLod ? 3 : 6);
    for (const [x, z] of [[-0.32, 0.42], [0.32, 0.42], [-0.32, -0.42], [0.32, -0.42]] as const) {
      const leg = legSource.clone();
      leg.translate(x, 0.275, z);
      add(leg, HOOF);
    }
    legSource.dispose();

    for (const side of [-1, 1]) {
      const eye = crowdLod
        ? new THREE.TetrahedronGeometry(0.08, 0)
        : new THREE.SphereGeometry(0.08, 6, 4);
      eye.scale(1, 1.1, 0.45);
      eye.translate(side * 0.14, 0.94, 1.28);
      add(eye, EYE);

      const pupil = crowdLod
        ? new THREE.TetrahedronGeometry(0.04, 0)
        : new THREE.SphereGeometry(0.04, 5, 3);
      pupil.scale(1, 1.1, 0.5);
      pupil.translate(side * 0.14, 0.94, 1.305);
      add(pupil, PUPIL);

      if (!crowdLod) {
        const shine = new THREE.SphereGeometry(0.018, 4, 3);
        shine.translate(side * 0.155, 0.965, 1.325);
        add(shine, EYE);
      }
    }

    const nose = crowdLod
      ? new THREE.TetrahedronGeometry(0.055, 0)
      : new THREE.SphereGeometry(0.05, 6, 4);
    nose.scale(1.2, 0.75, 0.4);
    nose.translate(0, 0.8, 1.3);
    add(nose, NOSE);

    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!merged) throw new Error('Could not build the production-style sheep geometry.');
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(merged.index);
    for (const [name, value] of Object.entries(merged.attributes)) geometry.setAttribute(name, value);
    merged.dispose();
    geometry.instanceCount = 0;
    geometry.computeBoundingSphere();
    return geometry;
  }
}
