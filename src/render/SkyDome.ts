import * as THREE from 'three/webgpu';
import { dot, float, max, mix, normalWorldGeometry, pow, smoothstep, uniform } from 'three/tsl';

const SUN_ELEVATION = THREE.MathUtils.degToRad(70);
const SUN_AZIMUTH = THREE.MathUtils.degToRad(45);

export type SkyDome = {
  node: any;
  sunDirection: THREE.Vector3;
};

export function sunDirectionFromAngles(elevation: number, azimuth: number): THREE.Vector3 {
  return new THREE.Vector3(
    Math.cos(elevation) * Math.cos(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.sin(azimuth),
  ).normalize();
}

export function createSkyDome(): SkyDome {
  const sunDirection = sunDirectionFromAngles(SUN_ELEVATION, SUN_AZIMUTH);

  const horizonColor = uniform(new THREE.Color('#cfd9e8'));
  const zenithColor = uniform(new THREE.Color('#3f6fb8'));
  const sunColor = uniform(new THREE.Color('#fff6e0'));
  const sunDirectionUniform = uniform(sunDirection.clone());

  const heightFactor = smoothstep(float(-0.1), float(0.75), normalWorldGeometry.y);
  const skyColor = mix(horizonColor, zenithColor, heightFactor);

  const sunAmount = max(dot(normalWorldGeometry, sunDirectionUniform), float(0));
  const sunDisc = smoothstep(float(0.9985), float(0.9997), sunAmount);
  const sunGlow = pow(sunAmount, float(8)).mul(0.35);
  const node = skyColor.add(sunColor.mul(sunDisc.add(sunGlow)));

  return { node, sunDirection };
}
