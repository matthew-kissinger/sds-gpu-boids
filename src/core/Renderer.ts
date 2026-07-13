import * as THREE from 'three/webgpu';

export type WebGpuCapabilityReport = {
  available: boolean;
  adapterName: string;
  architecture: string;
  device: string;
  description: string;
  features: string[];
  limits: {
    maxBufferSize: number;
    maxStorageBufferBindingSize: number;
    maxStorageBuffersPerShaderStage: number;
    maxComputeInvocationsPerWorkgroup: number;
    maxComputeWorkgroupSizeX: number;
  } | null;
  timestampQuery: boolean;
};

export type RendererBundle = {
  renderer: THREE.WebGPURenderer;
  capability: WebGpuCapabilityReport;
};

function emptyReport(): WebGpuCapabilityReport {
  return {
    available: false,
    adapterName: 'Unavailable',
    architecture: '',
    device: '',
    description: '',
    features: [],
    limits: null,
    timestampQuery: false,
  };
}

export async function inspectWebGpu(): Promise<WebGpuCapabilityReport> {
  if (!navigator.gpu) return emptyReport();

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return emptyReport();

  const info = adapter.info;
  const features = [...adapter.features].map(String).sort();
  return {
    available: true,
    adapterName: info.description || info.device || info.architecture || 'WebGPU adapter',
    architecture: info.architecture || '',
    device: info.device || '',
    description: info.description || '',
    features,
    limits: {
      maxBufferSize: Number(adapter.limits.maxBufferSize),
      maxStorageBufferBindingSize: Number(adapter.limits.maxStorageBufferBindingSize),
      maxStorageBuffersPerShaderStage: Number(adapter.limits.maxStorageBuffersPerShaderStage),
      maxComputeInvocationsPerWorkgroup: Number(adapter.limits.maxComputeInvocationsPerWorkgroup),
      maxComputeWorkgroupSizeX: Number(adapter.limits.maxComputeWorkgroupSizeX),
    },
    timestampQuery: adapter.features.has('timestamp-query'),
  };
}

export async function createRenderer(
  canvas: HTMLCanvasElement,
  onDeviceLost: (info: unknown) => void,
): Promise<RendererBundle> {
  const capability = await inspectWebGpu();
  if (!capability.available) {
    throw new Error('WebGPU is unavailable. This prototype intentionally has no CPU or WebGL fallback.');
  }

  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    trackTimestamp: capability.timestampQuery,
  });
  renderer.onDeviceLost = onDeviceLost;
  await renderer.init();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = false;

  return { renderer, capability };
}

export function resizeRenderer(
  renderer: THREE.WebGPURenderer,
  camera: THREE.PerspectiveCamera,
  maxDpr = 1.5,
): boolean {
  const canvas = renderer.domElement;
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const bufferWidth = Math.floor(width * dpr);
  const bufferHeight = Math.floor(height * dpr);
  const needsResize = canvas.width !== bufferWidth || canvas.height !== bufferHeight;

  if (needsResize) {
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  return needsResize;
}
