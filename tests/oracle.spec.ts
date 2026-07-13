import { expect, test } from '@playwright/test';
import { compareOneStepGpuOracle, type GpuOracleSample } from '../src/reference/boidsReference';

test('one WebGPU step matches the seeded CPU compact-grid oracle', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'The GPU oracle is adapter validation, not responsive UI coverage.');

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/?count=1000&scenario=field&seed=1592594996&deep=1&manual=1&dpr=1');
  await page.waitForFunction(() => Boolean(window.__GPU_BOID_ORACLE__));
  const sample = await page.evaluate(async () => {
    const readOracle = window.__GPU_BOID_ORACLE__;
    if (!readOracle) throw new Error('GPU oracle hook is unavailable.');
    const value = await readOracle(1000);
    return {
      ...value,
      positions: Array.from(value.positions),
      velocities: Array.from(value.velocities),
    };
  }) as GpuOracleSample;

  const comparison = compareOneStepGpuOracle(sample);
  const evidence = {
    count: comparison.count,
    maximumPositionError: comparison.maximumPositionError,
    maximumVelocityError: comparison.maximumVelocityError,
    rootMeanSquarePositionError: comparison.rootMeanSquarePositionError,
    rootMeanSquareVelocityError: comparison.rootMeanSquareVelocityError,
  };
  await testInfo.attach('gpu-cpu-oracle.json', {
    body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`),
    contentType: 'application/json',
  });
  console.log(`[gpu-cpu-oracle] ${JSON.stringify(evidence)}`);
  expect(sample.step).toBe(1);
  expect(comparison.maximumPositionError).toBeLessThan(0.001);
  expect(comparison.maximumVelocityError).toBeLessThan(0.01);
  expect(comparison.rootMeanSquarePositionError).toBeLessThan(0.0001);
  expect(comparison.rootMeanSquareVelocityError).toBeLessThan(0.001);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
