export const COUNT_LADDER = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 50_000, 75_000, 100_000] as const;

export type ScenarioId = 'constant' | 'field' | 'herd' | 'goal';

export type PrototypeConfig = {
  count: number;
  scenario: ScenarioId;
  seed: number;
  benchmark: boolean;
  goalDemo: boolean;
  deepDiagnostics: boolean;
  manualStep: boolean;
  maxDpr: number;
};

const SCENARIOS = new Set<ScenarioId>(['constant', 'field', 'herd', 'goal']);

function nearestCount(value: number): number {
  let best: number = COUNT_LADDER[0];
  let bestDistance = Math.abs(value - best);
  for (const count of COUNT_LADDER) {
    const distance = Math.abs(value - count);
    if (distance < bestDistance) {
      best = count;
      bestDistance = distance;
    }
  }
  return best;
}

export function readConfig(search = window.location.search): PrototypeConfig {
  const params = new URLSearchParams(search);
  const count = nearestCount(Number(params.get('count')) || 16_000);
  const rawScenario = params.get('scenario') as ScenarioId | null;
  const scenario = rawScenario && SCENARIOS.has(rawScenario) ? rawScenario : 'field';
  const seed = Math.max(1, Math.floor(Number(params.get('seed')) || 13_371));
  const benchmark = params.get('bench') === '1';
  const goalDemo = scenario === 'goal' && params.get('goalDemo') === '1';
  const deepDiagnostics = params.get('deep') === '1';
  const manualStep = deepDiagnostics && params.get('manual') === '1';
  const maxDpr = Math.max(0.75, Math.min(Number(params.get('dpr')) || (benchmark ? 1 : 1.5), 2));
  return { count, scenario, seed, benchmark, goalDemo, deepDiagnostics, manualStep, maxDpr };
}

export function worldExtentFor(count: number, scenario: ScenarioId): number {
  if (scenario === 'constant') {
    const targetDensity = 1.5;
    return Math.max(16, Math.sqrt(count / targetDensity) * 0.5);
  }
  if (scenario === 'goal') return 24;
  if (scenario === 'herd') return 32;
  return 46;
}
