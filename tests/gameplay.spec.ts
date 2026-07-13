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

test('goal demo advances objective reduction through the win state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Objective reduction is covered once in the desktop project.');
  const live = await openLiveRuntime(page, '/?count=1000&scenario=goal&goalDemo=1');
  test.skip(!live, 'This browser exercised the explicit unsupported-WebGPU path.');

  await expect.poll(async () => (await diagnostics(page))?.objective?.goalPercent ?? 0, { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect.poll(async () => (await diagnostics(page))?.status, { timeout: 30_000 }).toBe('won');
  await expect(page.locator('#game-overlay')).toHaveAttribute('data-state', 'won');
});
