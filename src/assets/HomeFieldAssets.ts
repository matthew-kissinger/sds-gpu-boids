import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_ROOT = `${import.meta.env.BASE_URL}assets/models`;

export const HOME_FIELD_MODELS = {
  dog: `${MODEL_ROOT}/Jep.glb`,
  farmhouse: `${MODEL_ROOT}/Farm-house.glb`,
  fence: `${MODEL_ROOT}/Fence_Kit-v1.0.0.glb`,
  gate: `${MODEL_ROOT}/Gate_Assembly-v1.0.0.glb`,
  tree1: `${MODEL_ROOT}/trees/tree1_lod1.glb`,
  tree2: `${MODEL_ROOT}/trees/tree2_lod1.glb`,
  rock1: `${MODEL_ROOT}/rocks/rock1.glb`,
  rock2: `${MODEL_ROOT}/rocks/rock2.glb`,
  rock3: `${MODEL_ROOT}/rocks/rock3.glb`,
  utilityShed: `${MODEL_ROOT}/homestead/utility-shed.glb`,
  hayBalesA: `${MODEL_ROOT}/homestead/hay-bales-a.glb`,
  hayBalesB: `${MODEL_ROOT}/homestead/hay-bales-b.glb`,
  troughBucket: `${MODEL_ROOT}/homestead/trough-bucket.glb`,
  crateStack: `${MODEL_ROOT}/homestead/crate-stack.glb`,
  barrelRope: `${MODEL_ROOT}/homestead/barrel-rope.glb`,
  logPileStump: `${MODEL_ROOT}/homestead/log-pile-stump.glb`,
  signpost: `${MODEL_ROOT}/homestead/signpost.glb`,
  stoneMarker: `${MODEL_ROOT}/homestead/stone-marker.glb`,
  wildflowerA: `${MODEL_ROOT}/homestead/wildflower-a.glb`,
  wildflowerB: `${MODEL_ROOT}/homestead/wildflower-b.glb`,
} as const;

export type HomeFieldModelKey = keyof typeof HOME_FIELD_MODELS;

export function createHomeFieldLoader(): GLTFLoader {
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${import.meta.env.BASE_URL}assets/draco/`);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

export async function loadHomeFieldModel(loader: GLTFLoader, key: HomeFieldModelKey): Promise<GLTF> {
  return loader.loadAsync(HOME_FIELD_MODELS[key]);
}
