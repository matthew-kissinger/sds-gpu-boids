import { Fn, float, fract, sin, dot, floor, mix, smoothstep, vec2 } from 'three/tsl';

export const hash21 = Fn(([point]: [any]) => {
  const p = vec2(point).toVar();
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453123));
});

export const valueNoise2D = Fn(([point]: [any]) => {
  const p = vec2(point).toVar();
  const cell = floor(p).toVar();
  const local = fract(p).toVar();
  const bottomLeft = hash21(cell);
  const bottomRight = hash21(cell.add(vec2(1, 0)));
  const topLeft = hash21(cell.add(vec2(0, 1)));
  const topRight = hash21(cell.add(vec2(1, 1)));
  const fade = smoothstep(float(0), float(1), local);
  return mix(mix(bottomLeft, bottomRight, fade.x), mix(topLeft, topRight, fade.x), fade.y);
});

export function fbm2D(point: any, octaves = 4): any {
  let value: any = float(0);
  let amplitude = 0.5;
  let frequency = point;
  for (let index = 0; index < octaves; index += 1) {
    value = value.add(valueNoise2D(frequency).mul(amplitude));
    frequency = frequency.mul(2);
    amplitude *= 0.5;
  }
  return value;
}
