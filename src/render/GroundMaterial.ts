import * as THREE from 'three/webgpu';
import { float, floor, mix, positionWorld, smoothstep, uniform, vec2 } from 'three/tsl';
import { fbm2D, hash21 } from './shaderNoise';

export function createGroundMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.98, metalness: 0 });

  const baseColor1 = uniform(new THREE.Color('#3d5c2e'));
  const baseColor2 = uniform(new THREE.Color('#5a7a42'));
  const baseColor3 = uniform(new THREE.Color('#4a6838'));
  const dirtColor = uniform(new THREE.Color('#6b5d4a'));

  // 1 octave rather than sds's 4, and a raw hash instead of interpolated noise for the fine
  // grain term: this shader runs per ground fragment across most of the screen every frame
  // (measured as the single largest render-time cost in this file), and hash calls dominate
  // its cost. This keeps the patchy, multi-frequency look at a fraction of the sample count.
  const worldXZ = vec2(positionWorld.x, positionWorld.z);
  const patchNoise = fbm2D(worldXZ.mul(0.02), 1);
  const blendNoise = fbm2D(worldXZ.mul(0.05).add(100), 1);
  const grainNoise = hash21(floor(worldXZ.mul(0.1)));

  let shaded = mix(baseColor1, baseColor2, patchNoise);
  shaded = mix(shaded, baseColor3, blendNoise.mul(0.5));
  const dirtMask = smoothstep(float(0.55), float(0.7), patchNoise.mul(blendNoise));
  shaded = mix(shaded, dirtColor, dirtMask.mul(0.4));
  shaded = shaded.mul(float(0.9).add(grainNoise.mul(0.2)));
  const ambientOcclusion = float(0.85).add(patchNoise.mul(0.15));
  shaded = shaded.mul(ambientOcclusion);

  material.colorNode = shaded;
  return material;
}
