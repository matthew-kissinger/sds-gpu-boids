import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

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
    velocity?: { x?: number; y?: number; z?: number };
    barkStrength?: number;
    barkSequence?: number;
  };
};

type RuntimeState = {
  live: boolean;
  diagnostics: Diagnostics | null;
};

async function openRuntime(page: Page, path = '/?count=1000&scenario=field'): Promise<RuntimeState> {
  await page.goto(path);
  await page.waitForFunction(() => {
    const runtimeWindow = window as typeof window & { __THREE_GAME_DIAGNOSTICS__?: Diagnostics };
    const diagnostics = runtimeWindow.__THREE_GAME_DIAGNOSTICS__;
    const overlay = document.querySelector('#game-overlay');
    return Boolean(diagnostics?.status)
      || diagnostics?.error
      || overlay?.getAttribute('data-state') === 'error';
  });

  const diagnostics = await readDiagnostics(page);
  if (diagnostics?.status && diagnostics.status !== 'error' && !diagnostics.error) {
    return { live: true, diagnostics };
  }

  const overlay = page.locator('#game-overlay');
  await expect(overlay).toHaveAttribute('data-state', 'error');
  await expect(overlay).toContainText(/WebGPU|GPU|adapter|browser/i);
  return { live: false, diagnostics };
}

async function readDiagnostics(page: Page): Promise<Diagnostics | null> {
  return page.evaluate(() => {
    const runtimeWindow = window as typeof window & { __THREE_GAME_DIAGNOSTICS__?: Diagnostics };
    return structuredClone(runtimeWindow.__THREE_GAME_DIAGNOSTICS__ ?? null);
  });
}

async function sampleCanvas(page: Page) {
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  if (!box || box.width < 32 || box.height < 32) {
    return { ok: false, reason: 'canvas-too-small', box };
  }

  const buffer = await canvas.screenshot();
  const png = PNG.sync.read(buffer);
  let min = 255;
  let max = 0;
  let opaqueSamples = 0;
  const buckets = new Set<string>();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 4096));

  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const offset = pixel * 4;
    const red = png.data[offset];
    const green = png.data[offset + 1];
    const blue = png.data[offset + 2];
    const alpha = png.data[offset + 3];
    min = Math.min(min, red, green, blue);
    max = Math.max(max, red, green, blue);
    if (alpha > 0) opaqueSamples += 1;
    buckets.add(`${red >> 4},${green >> 4},${blue >> 4},${alpha >> 6}`);
  }

  const variance = max - min;
  return {
    ok: opaqueSamples > 256 && variance > 8 && buckets.size > 3,
    reason: 'sampled',
    box,
    variance,
    colorBuckets: buckets.size,
  };
}

function dogPosition(diagnostics: Diagnostics | null): { x: number; z: number } {
  return {
    x: diagnostics?.dog?.position?.x ?? 0,
    z: diagnostics?.dog?.position?.z ?? 0,
  };
}

test('shows an honest capability error or a live WebGPU game', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const runtime = await openRuntime(page);
  if (runtime.live) {
    await expect(page.locator('#game-canvas')).toBeVisible();
    await expect.poll(async () => (await readDiagnostics(page))?.config?.count).toBe(1000);

    const sample = await sampleCanvas(page);
    expect(sample, JSON.stringify(sample)).toMatchObject({ ok: true });
    const screenshot = await page.screenshot({ fullPage: true });
    await testInfo.attach(`${testInfo.project.name}-active-game`, {
      body: screenshot,
      contentType: 'image/png',
    });
  }

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('keyboard or touch movement and bark change live state', async ({ page }, testInfo) => {
  const runtime = await openRuntime(page);
  test.skip(!runtime.live, 'This browser exercised the explicit unsupported-WebGPU path.');

  const before = dogPosition(await readDiagnostics(page));
  const barkSequence = (await readDiagnostics(page))?.dog?.barkSequence ?? 0;

  if (testInfo.project.name.includes('mobile')) {
    const stick = page.locator('#touch-stick');
    const box = await stick.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.evaluate(({ centerX, centerY, targetY }) => {
        const stickElement = document.querySelector('#touch-stick');
        if (!stickElement) throw new Error('Missing touch stick');
        stickElement.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 7,
          pointerType: 'touch',
          clientX: centerX,
          clientY: centerY,
        }));
        stickElement.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 7,
          pointerType: 'touch',
          clientX: centerX,
          clientY: targetY,
        }));
      }, {
        centerX: box.x + box.width / 2,
        centerY: box.y + box.height / 2,
        targetY: box.y + box.height * 0.05,
      });
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const stickElement = document.querySelector('#touch-stick');
        if (!stickElement) throw new Error('Missing touch stick');
        stickElement.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 7,
          pointerType: 'touch',
        }));
      });
    }
    await page.locator('#bark-button').tap();
  } else {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(500);
    await page.keyboard.up('KeyW');
    await page.keyboard.press('Space');
  }

  await expect.poll(async () => {
    const after = dogPosition(await readDiagnostics(page));
    return Math.hypot(after.x - before.x, after.z - before.z);
  }).toBeGreaterThan(0.25);
  await expect.poll(async () => (await readDiagnostics(page))?.dog?.barkSequence ?? 0).toBeGreaterThan(barkSequence);
});
