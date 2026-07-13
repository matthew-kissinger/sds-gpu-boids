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
    visualPosition?: { x?: number; y?: number; z?: number };
    forward?: { x?: number; z?: number };
    rotationY?: number;
    barkStrength?: number;
    barkSequence?: number;
  };
  camera?: {
    mode?: 'follow' | 'orbit' | 'classic';
    distance?: number;
    yaw?: number;
    pitch?: number;
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

test('dog movement stays screen-relative and turns smoothly', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Keyboard camera-relative regression runs in the desktop project.');
  const live = await openLiveRuntime(page, '/?count=1000&scenario=field');
  test.skip(!live, 'This browser exercised the explicit unsupported-WebGPU path.');

  await page.keyboard.press('KeyC');
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyE');
  const before = position(await diagnostics(page));
  const yaw = (await diagnostics(page))?.camera?.yaw ?? 0;

  await page.keyboard.down('KeyA');
  const rotations = await page.evaluate(async () => {
    const values: number[] = [];
    for (let index = 0; index < 50; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const runtimeWindow = window as typeof window & { __THREE_GAME_DIAGNOSTICS__?: Diagnostics };
      values.push(runtimeWindow.__THREE_GAME_DIAGNOSTICS__?.dog?.rotationY ?? 0);
    }
    return values;
  });
  await page.keyboard.up('KeyA');
  const after = position(await diagnostics(page));
  const displacementX = after.x - before.x;
  const displacementZ = after.z - before.z;
  const screenRightX = Math.cos(yaw);
  const screenRightZ = -Math.sin(yaw);
  expect(displacementX * screenRightX + displacementZ * screenRightZ).toBeLessThan(-0.5);

  const turnSteps = rotations.slice(1).map((rotation, index) => Math.abs(Math.atan2(
    Math.sin(rotation - rotations[index]!),
    Math.cos(rotation - rotations[index]!),
  )));
  expect(Math.max(...turnSteps)).toBeLessThan(0.22);

});

test('up down left and right follow the active camera axes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Keyboard camera-axis coverage runs in desktop Chrome.');
  test.setTimeout(60_000);

  const measure = async (key: 'KeyW' | 'KeyS' | 'KeyA' | 'KeyD') => {
    const live = await openLiveRuntime(page, '/?count=1000&scenario=field');
    test.skip(!live, 'This browser exercised the explicit unsupported-WebGPU path.');
    await page.keyboard.press('KeyC');
    await page.keyboard.down('KeyE');
    await page.waitForTimeout(700);
    await page.keyboard.up('KeyE');
    const start = position(await diagnostics(page));
    const yaw = (await diagnostics(page))?.camera?.yaw ?? 0;
    await page.keyboard.down(key);
    await page.waitForTimeout(450);
    await page.keyboard.up(key);
    const end = position(await diagnostics(page));
    return {
      forward: (end.x - start.x) * Math.sin(yaw) + (end.z - start.z) * Math.cos(yaw),
      right: (end.x - start.x) * Math.cos(yaw) - (end.z - start.z) * Math.sin(yaw),
    };
  };

  expect((await measure('KeyW')).forward).toBeGreaterThan(0.5);
  expect((await measure('KeyS')).forward).toBeLessThan(-0.5);
  expect((await measure('KeyA')).right).toBeLessThan(-0.5);
  expect((await measure('KeyD')).right).toBeGreaterThan(0.5);
});

test('camera supports zoom, orbit look, and view cycling', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Mouse and keyboard camera regression runs in desktop Chrome.');
  const live = await openLiveRuntime(page, '/?count=1000&scenario=field');
  test.skip(!live, 'This browser exercised the explicit unsupported-WebGPU path.');

  const canvas = page.locator('canvas');
  const initial = await diagnostics(page);
  await canvas.hover();
  await page.mouse.wheel(0, -600);
  await expect.poll(async () => (await diagnostics(page))?.camera?.distance ?? 100)
    .toBeLessThan(initial?.camera?.distance ?? 100);

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35, { steps: 5 });
    await page.mouse.up();
  }
  await expect.poll(async () => (await diagnostics(page))?.camera?.mode).toBe('orbit');
  expect(Math.abs((await diagnostics(page))?.camera?.yaw ?? 0)).toBeGreaterThan(0.1);

  await page.keyboard.press('KeyC');
  await expect.poll(async () => (await diagnostics(page))?.camera?.mode).toBe('classic');
  await page.keyboard.press('KeyC');
  await expect.poll(async () => (await diagnostics(page))?.camera?.mode).toBe('follow');
});
