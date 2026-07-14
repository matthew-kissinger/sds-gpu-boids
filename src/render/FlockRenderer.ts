import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Fn,
  If,
  attribute,
  cameraPosition,
  cos,
  dot,
  float,
  floor,
  hash,
  instanceIndex,
  max,
  mix,
  mod,
  normalLocal,
  oneMinus,
  positionLocal,
  pow,
  saturate,
  sin,
  smoothstep,
  step,
  time,
  triNoise3D,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { MAX_SPEED } from '../gpu/constants';
import { GpuBoidSystem } from '../gpu';

const WOOL = new THREE.Color('#f7f2df');
const FACE = new THREE.Color('#38322d');
const HOOF = new THREE.Color('#24211f');
const EYE = new THREE.Color('#fbfaf2');
const PUPIL = new THREE.Color('#090908');
const NOSE = new THREE.Color('#d18a8d');

const HERO_LIGHT_DIRECTION = new THREE.Vector3(0.3, 1.0, 0.5).normalize();
const IDLE_SPEED_FLOOR = 0.16;
const MAX_SPEED_SQ = MAX_SPEED * MAX_SPEED;

/** Richness tiers: 2 = full (wool + 5-band toon + fresnel + SSS), 1 = mid (fresnel only, 3-band toon), 0 = cheap (flat toon, no rim). */
const FULL_RICHNESS_MAX_COUNT = 32_000;
const MID_RICHNESS_MAX_COUNT = 100_000;

type VertexIdSource = number | ((localIndex: number) => number);

export class FlockRenderer {
  readonly mesh: THREE.Mesh;

  private readonly detailedGeometry: THREE.InstancedBufferGeometry;
  private readonly crowdGeometry: THREE.InstancedBufferGeometry;
  private geometry: THREE.InstancedBufferGeometry;
  private readonly material = new THREE.NodeMaterial();
  private readonly scale = uniform(0.82);
  private readonly richness = uniform(2);

  constructor(private readonly boids: GpuBoidSystem) {
    this.detailedGeometry = this.createProductionSheepGeometry(false);
    this.crowdGeometry = this.createProductionSheepGeometry(true);
    this.geometry = boids.count >= 32_000 ? this.crowdGeometry : this.detailedGeometry;

    const nodes = boids.getRenderNodes();
    const vertexId = attribute<'float'>('vertexId', 'float');
    const bodyMask = float(1).sub(step(50, vertexId));
    const headMask = step(50, vertexId).mul(float(1).sub(step(100, vertexId)));
    const legMask = step(100, vertexId).mul(float(1).sub(step(140, vertexId)));

    const speedSq = nodes.velocity.x.mul(nodes.velocity.x).add(nodes.velocity.z.mul(nodes.velocity.z));
    const safeLength = speedSq.max(float(0.0001)).sqrt();
    const instantaneousForward = vec2(nodes.velocity.x.div(safeLength), nodes.velocity.z.div(safeLength));
    const cachedForward = vec2(cos(nodes.cachedYaw), sin(nodes.cachedYaw));
    const forward = mix(cachedForward, instantaneousForward, nodes.state);

    const speedFactor = max(speedSq.min(MAX_SPEED_SQ).div(MAX_SPEED_SQ), IDLE_SPEED_FLOOR);
    const animPhase = hash(instanceIndex).mul(6.283);
    const gaitTime = time.add(animPhase);

    const legIndex = floor(vertexId.sub(100).div(10));
    const legPhase = step(2, legIndex).mul(Math.PI);
    const sidePhase = mod(legIndex, 2).mul(1.57);
    const legWave = sin(gaitTime.mul(3).add(legPhase).add(sidePhase));
    const legOffset = vec3(
      float(0),
      max(legWave, float(0)).mul(speedFactor).mul(0.22),
      legWave.mul(speedFactor).mul(0.4),
    ).mul(legMask);

    // Real branch, not multiply-by-zero: triNoise3D runs a 3-iteration loop per vertex,
    // and at hundreds of thousands of instances that cost is only worth paying on the
    // richness===2 tier. A uniform-driven If() is free for threads that skip it.
    const woolDisplacement = Fn(() => {
      const displacement = float(0).toVar();
      If(this.richness.greaterThanEqual(2), () => {
        const woolNoise = triNoise3D(nodes.position.mul(0.6), float(1), time);
        displacement.assign(woolNoise.sub(0.5).mul(0.05));
      });
      return displacement;
    })();
    const bodyBounce = sin(gaitTime.mul(2.5)).mul(speedFactor).mul(0.05);
    const breathing = sin(time.mul(1.8).add(animPhase)).mul(0.015);
    const bodyOffset = vec3(float(0), bodyBounce.add(breathing), float(0))
      .add(normalLocal.mul(woolDisplacement))
      .mul(bodyMask);

    const headBob = sin(gaitTime.add(0.5).mul(2)).mul(speedFactor).mul(0.05);
    const headOffset = vec3(float(0), headBob, float(0)).mul(headMask);

    const retiredScale = float(0.16).add(nodes.state.mul(0.84));
    const displacedLocal = positionLocal.add(legOffset).add(bodyOffset).add(headOffset);
    const scaledLocal = displacedLocal.mul(this.scale).mul(retiredScale);
    const rotatedLocal = vec3(
      scaledLocal.x.mul(forward.y).add(scaledLocal.z.mul(forward.x)),
      scaledLocal.y,
      scaledLocal.z.mul(forward.y).sub(scaledLocal.x.mul(forward.x)),
    );
    const worldPosition = rotatedLocal.add(nodes.position);
    this.material.positionNode = worldPosition;

    const rotatedNormal = vec3(
      normalLocal.x.mul(forward.y).add(normalLocal.z.mul(forward.x)),
      normalLocal.y,
      normalLocal.z.mul(forward.y).sub(normalLocal.x.mul(forward.x)),
    ).normalize();
    const heroLight = vec3(HERO_LIGHT_DIRECTION.x, HERO_LIGHT_DIRECTION.y, HERO_LIGHT_DIRECTION.z);
    const nDotL = dot(rotatedNormal, heroLight);
    const toonSteps = mix(float(3), float(5), step(1.5, this.richness));
    const toon = floor(smoothstep(-0.15, 0.15, nDotL).mul(0.55).add(0.45).mul(toonSteps)).div(toonSteps);

    // Fragment cost scales with screen coverage, not instance count, and at 100k+ sheep
    // that coverage is large - real If() branches so the cheap tier skips the pow() calls
    // entirely instead of computing and discarding them.
    const viewDirection = cameraPosition.sub(worldPosition).normalize();
    const fresnel = Fn(() => {
      const value = float(0).toVar();
      If(this.richness.greaterThanEqual(1), () => {
        value.assign(
          pow(oneMinus(saturate(dot(rotatedNormal, viewDirection))), float(2.8)).mul(0.35).mul(bodyMask),
        );
      });
      return value;
    })();

    const backlight = Fn(() => {
      const value = float(0).toVar();
      If(this.richness.greaterThanEqual(2), () => {
        const facing = max(dot(viewDirection.negate(), heroLight.negate()), float(0));
        value.assign(pow(facing, float(3)).mul(0.12).mul(bodyMask));
      });
      return value;
    })();

    const vertexColor = attribute<'vec3'>('color', 'vec3');
    this.material.colorNode = vertexColor
      .mul(toon)
      .add(fresnel)
      .add(backlight.mul(vec3(1, 1, 0.96)));

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.geometry.instanceCount = boids.count;
    this.mesh.frustumCulled = false;
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
    // A shadow-caster pass re-runs the full instanced vertex shader a second time; at
    // crowd-tier counts (32k+) that duplicated cost is not worth an effectively-illegible
    // mass of individual sheep shadows, so only the smaller-flock tiers cast shadows.
    this.mesh.castShadow = this.boids.count < FULL_RICHNESS_MAX_COUNT;
    this.geometry.instanceCount = this.boids.count;
    this.scale.value = this.boids.count >= 75_000 ? 0.52 : this.boids.count >= 32_000 ? 0.7 : 1.12;
    this.richness.value = this.boids.count >= MID_RICHNESS_MAX_COUNT
      ? 0
      : this.boids.count >= FULL_RICHNESS_MAX_COUNT
        ? 1
        : 2;
  }

  dispose(): void {
    this.detailedGeometry.dispose();
    this.crowdGeometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }

  private createProductionSheepGeometry(crowdLod: boolean): THREE.InstancedBufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const add = (geometry: THREE.BufferGeometry, color: THREE.Color, vertexId: VertexIdSource): void => {
      const compatible = geometry.index ? geometry.toNonIndexed() : geometry;
      if (compatible !== geometry) geometry.dispose();
      const vertexCount = compatible.getAttribute('position').count;
      const colors = new Float32Array(vertexCount * 3);
      const vertexIds = new Float32Array(vertexCount);
      for (let index = 0; index < vertexCount; index += 1) {
        colors[index * 3] = color.r;
        colors[index * 3 + 1] = color.g;
        colors[index * 3 + 2] = color.b;
        vertexIds[index] = typeof vertexId === 'function' ? vertexId(index) : vertexId;
      }
      compatible.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      compatible.setAttribute('vertexId', new THREE.BufferAttribute(vertexIds, 1));
      parts.push(compatible);
    };
    const headId: VertexIdSource = (index) => 50 + Math.min(index, 49);

    const body = new THREE.SphereGeometry(1, crowdLod ? 6 : 12, crowdLod ? 4 : 8);
    body.scale(1, 0.9, 1.1);
    body.translate(0, 0.875, 0);
    add(body, WOOL, (index) => Math.min(index, 49));

    const head = new THREE.SphereGeometry(0.45, crowdLod ? 6 : 10, crowdLod ? 4 : 6);
    head.scale(0.85, 0.9, 1);
    head.translate(0, 0.88, 0.85);
    add(head, FACE, headId);

    const legSource = new THREE.CylinderGeometry(0.11, 0.13, 0.55, crowdLod ? 3 : 6);
    const legPositions = [[-0.32, 0.42], [0.32, 0.42], [-0.32, -0.42], [0.32, -0.42]] as const;
    legPositions.forEach(([x, z], legIndex) => {
      const leg = legSource.clone();
      leg.translate(x, 0.275, z);
      add(leg, HOOF, 100 + legIndex * 10);
    });
    legSource.dispose();

    for (const side of [-1, 1]) {
      const eye = crowdLod
        ? new THREE.TetrahedronGeometry(0.08, 0)
        : new THREE.SphereGeometry(0.08, 6, 4);
      eye.scale(1, 1.1, 0.45);
      eye.translate(side * 0.14, 0.94, 1.28);
      add(eye, EYE, headId);

      const pupil = crowdLod
        ? new THREE.TetrahedronGeometry(0.04, 0)
        : new THREE.SphereGeometry(0.04, 5, 3);
      pupil.scale(1, 1.1, 0.5);
      pupil.translate(side * 0.14, 0.94, 1.305);
      add(pupil, PUPIL, headId);

      if (!crowdLod) {
        const shine = new THREE.SphereGeometry(0.018, 4, 3);
        shine.translate(side * 0.155, 0.965, 1.325);
        add(shine, EYE, headId);
      }
    }

    const nose = crowdLod
      ? new THREE.TetrahedronGeometry(0.055, 0)
      : new THREE.SphereGeometry(0.05, 6, 4);
    nose.scale(1.2, 0.75, 0.4);
    nose.translate(0, 0.8, 1.3);
    add(nose, NOSE, headId);

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
