import { expect, test, type Page } from '@playwright/test';

type Diagnostics = {
  status?: 'playing' | 'paused' | 'won' | 'error';
  error?: string | null;
  config?: {
    count?: number;
    scenario?: string;
  };
  objective?: {
    goalPercent?: number;
    holdProgress?: number;
  };
  dog?: {
    position?: { x?: number; y?: number; z?: number };
    barkStrength?: number;
    barkSequence?: number;
  };
  tuning?: {
    separationWeight?: number;
    dogStrength?: number;
    goalAttraction?: number;
    goalAssistEnabled?: boolean;
  };
};

async function openLiveRuntime(page: Page, path: string): Promise<boolean> {
  await page.goto(path);
  await page.waitForFunction(() => {
    const runtimeWindow = window as typeof window & { __THREE_GAME_DIAGNOSTICS__?: Diagnostics };
    const diagnostics = runtimeWindow.__THREE_GAME_DIAGNOSTICS__;
    const overlay = document.querySelector('#game-overlay');
    return Boolean(diagnostics?.status)
      || diagnostics?.error
      || overlay?.getAttribute('data-state') === 'error';
  });
  const state = await diagnostics(page);
  return Boolean(state?.status && state.status !== 'error' && !state.error);
}

async function diagnostics(page: Page): Promise<Diagnostics | null> {
  return page.evaluate(() => {
    const runtimeWindow = window as typeof window & { __THREE_GAME_DIAGNOSTICS__?: Diagnostics };
    return structuredClone(runtimeWindow.__THREE_GAME_DIAGNOSTICS__ ?? null);
  });
}

function position(value: Diagnostics | null): { x: number; z: number } {
  return {
    x: value?.dog?.position?.x ?? 0,
    z: value?.dog?.position?.z ?? 0,
  };
}

test('pause freezes dog motion and restart restores the initial state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Keyboard lifecycle test runs in the desktop project.');
  const live = await openLiveRuntime(page, '/?count=1000&scenario=field');
  test.skip(!live, 'This browser exercised the explicit unsupported-WebGPU path.');

  const initial = position(await diagnostics(page));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(450);
  await page.keyboard.up('KeyW');

  await page.keyboard.press('KeyP');
  await expect.poll(async () => (await diagnostics(page))?.status).toBe('paused');
  const paused = position(await diagnostics(page));
  await page.waitForTimeout(350);
  const stillPaused = position(await diagnostics(page));
  expect(Math.hypot(stillPaused.x - paused.x, stillPaused.z - paused.z)).toBeLessThan(0.02);

  await page.locator('#overlay-secondary').click();
  await expect.poll(async () => (await diagnostics(page))?.status).toBe('playing');
  await expect.poll(async () => {
    const restarted = position(await diagnostics(page));
    return Math.hypot(restarted.x - initial.x, restarted.z - initial.z);
  }).toBeLessThan(0.05);
});

test('count and scenario controls rebuild the simulation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Configuration controls are covered once in the desktop project.');
  const live = await openLiveRuntime(page, '/?count=1000&scenario=field');
  test.skip(!live, 'This browser exercised the explicit unsupported-WebGPU path.');

  await page.locator('#count-select').selectOption('4000');
  await expect.poll(async () => (await diagnostics(page))?.config?.count, { timeout: 15_000 }).toBe(4000);

  await page.locator('#scenario-select').selectOption('herd');
  await expect.poll(async () => (await diagnostics(page))?.config?.scenario, { timeout: 15_000 }).toBe('herd');
  await expect(page.locator('#boid-count')).toContainText(/4,?000/);
});

test('live tuning controls update GPU boid behavior without restarting', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'The desktop project covers the tuning drawer interaction.');
  const live = await openLiveRuntime(page, '/?count=1000&scenario=field');
  test.skip(!live, 'This browser exercised the explicit unsupported-WebGPU path.');

  const initialPosition = position(await diagnostics(page));
  await page.locator('#tuning-toggle').click();
  await expect(page.locator('#tuning-panel')).toBeVisible();
  await page.locator('input[data-tuning-key="separationWeight"]').fill('3.1');
  await page.locator('input[data-tuning-key="dogStrength"]').fill('52');
  await page.locator('input[data-tuning-key="goalAttraction"]').fill('1.25');
  await page.locator('input[data-tuning-key="goalAssistEnabled"]').check();

  await expect.poll(async () => (await diagnostics(page))?.tuning?.separationWeight).toBeCloseTo(3.1, 3);
  await expect.poll(async () => (await diagnostics(page))?.tuning?.dogStrength).toBeCloseTo(52, 3);
  await expect.poll(async () => (await diagnostics(page))?.tuning?.goalAttraction).toBeCloseTo(1.25, 3);
  await expect.poll(async () => (await diagnostics(page))?.tuning?.goalAssistEnabled).toBe(true);
  const finalPosition = position(await diagnostics(page));
  expect(Math.hypot(finalPosition.x - initialPosition.x, finalPosition.z - initialPosition.z)).toBeLessThan(0.05);
});

test('goal demo advances objective reduction through the win state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Objective reduction is covered once in the desktop project.');
  const live = await openLiveRuntime(page, '/?count=1000&scenario=goal&goalDemo=1');
  test.skip(!live, 'This browser exercised the explicit unsupported-WebGPU path.');

  await expect.poll(async () => (await diagnostics(page))?.objective?.goalPercent ?? 0, { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect.poll(async () => (await diagnostics(page))?.status, { timeout: 30_000 }).toBe('won');
  await expect(page.locator('#game-overlay')).toHaveAttribute('data-state', 'won');
});
