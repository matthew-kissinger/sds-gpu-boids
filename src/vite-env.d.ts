/// <reference types="vite/client" />

import type { BoidOracleSample } from './gpu';

declare global {
  interface Window {
    __THREE_GAME_DIAGNOSTICS__?: Record<string, unknown>;
    render_game_to_text?: () => string;
    advanceTime?: (milliseconds: number) => void;
    __GPU_BOID_ORACLE__?: (count?: number) => Promise<BoidOracleSample>;
  }
}

export {};
