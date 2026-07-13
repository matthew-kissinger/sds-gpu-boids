import * as THREE from 'three/webgpu';
import {
  color,
  float,
  hash,
  instanceIndex,
  mix,
  positionLocal,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { GpuBoidSystem } from '../gpu';

export class FlockRenderer {
  readonly mesh: THREE.Mesh;

  private readonly geometry = this.createGeometry();
  private readonly material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.88,
    metalness: 0,
  });
  private readonly scale = uniform(0.46);

  constructor(private readonly boids: GpuBoidSystem) {
    const nodes = boids.getRenderNodes();
    const speedSq = nodes.velocity.x.mul(nodes.velocity.x).add(nodes.velocity.z.mul(nodes.velocity.z));
    const safeLength = speedSq.max(float(0.0001)).sqrt();
    const forward = vec2(nodes.velocity.x.div(safeLength), nodes.velocity.z.div(safeLength));
    const local = positionLocal.mul(this.scale);
    const rotated = vec3(
      local.x.mul(forward.y).add(local.z.mul(forward.x)),
      local.y,
      local.z.mul(forward.y).sub(local.x.mul(forward.x)),
    );
    this.material.positionNode = rotated.add(nodes.position);

    const variation = hash(instanceIndex).mul(0.34);
    const speedTint = speedSq.min(float(16)).div(16).mul(0.12);
    this.material.colorNode = mix(color('#f3edd8'), color('#d8c99c'), variation.add(speedTint));

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.geometry.instanceCount = boids.count;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.name = 'gpu-flock';
  }

  syncCount(): void {
    this.geometry.instanceCount = this.boids.count;
    this.scale.value = this.boids.count >= 75_000 ? 0.32 : this.boids.count >= 32_000 ? 0.38 : 0.46;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }

  private createGeometry(): THREE.InstancedBufferGeometry {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.instanceCount = 0;
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0.18, -0.72,
      -0.34, 0.08, 0.48,
      0.34, 0.08, 0.48,
      0, 0.52, -0.34,
      -0.29, 0.44, 0.42,
      0.29, 0.44, 0.42,
    ], 3));
    geometry.setIndex([
      0, 2, 1,
      3, 4, 5,
      0, 3, 5,
      0, 5, 2,
      0, 1, 4,
      0, 4, 3,
      1, 2, 5,
      1, 5, 4,
    ]);
    geometry.computeVertexNormals();
    return geometry;
  }
}
