import * as THREE from 'three/webgpu';

export type CollisionSegment = {
  readonly x1: number;
  readonly z1: number;
  readonly x2: number;
  readonly z2: number;
};

const closestPoint = new THREE.Vector2();
const pushDirection = new THREE.Vector2();

function closestPointOnSegment(px: number, pz: number, segment: CollisionSegment): THREE.Vector2 {
  const dx = segment.x2 - segment.x1;
  const dz = segment.z2 - segment.z1;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-8) return closestPoint.set(segment.x1, segment.z1);
  const t = THREE.MathUtils.clamp(((px - segment.x1) * dx + (pz - segment.z1) * dz) / lengthSquared, 0, 1);
  return closestPoint.set(segment.x1 + dx * t, segment.z1 + dz * t);
}

/**
 * Pushes `position` (world X in .x, world Z in .y) out of each segment by `skinRadius`, in place.
 * Runs a couple of passes so corner/T-junctions (fence meeting fence) settle instead of only
 * resolving the last segment checked.
 */
export function resolveSegmentCollisions(
  position: THREE.Vector2,
  segments: readonly CollisionSegment[],
  skinRadius: number,
): void {
  for (let pass = 0; pass < 2; pass += 1) {
    for (const segment of segments) {
      const closest = closestPointOnSegment(position.x, position.y, segment);
      pushDirection.set(position.x - closest.x, position.y - closest.y);
      const distance = pushDirection.length();
      if (distance >= skinRadius || distance < 1e-6) continue;
      pushDirection.multiplyScalar(1 / distance);
      position.addScaledVector(pushDirection, skinRadius - distance);
    }
  }
}
