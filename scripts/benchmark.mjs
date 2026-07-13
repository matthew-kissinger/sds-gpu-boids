#!/usr/bin/env node
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_COUNTS = [1000, 2000, 4000, 8000, 16000, 32000, 50000, 75000, 100000];
const DEFAULT_SCENARIOS = ['constant', 'field', 'herd'];

function parseArgs(argv) {
  const options = {
    url: 'http://127.0.0.1:4190',
    counts: DEFAULT_COUNTS,
    scenarios: DEFAULT_SCENARIOS,
    duration: 60_000,
    warmup: 10_000,
    headed: false,
    repeats: 1,
    channel: 'chrome',
    out: `artifacts/benchmarks/benchmark-${new Date().toISOString().replaceAll(':', '-')}.json`,
    seed: 0x5eed1234,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [name, inlineValue] = argument.split('=', 2);
    const takeValue = () => inlineValue ?? argv[++index];

    if (name === '--url') options.url = takeValue();
    else if (name === '--counts') options.counts = parseNumberList(takeValue(), '--counts');
    else if (name === '--scenarios') options.scenarios = parseScenarioList(takeValue());
    else if (name === '--duration') options.duration = parseDuration(takeValue(), '--duration');
    else if (name === '--warmup') options.warmup = parseDuration(takeValue(), '--warmup');
    else if (name === '--out') options.out = takeValue();
    else if (name === '--seed') options.seed = parseInteger(takeValue(), '--seed');
    else if (name === '--repeats') options.repeats = parseInteger(takeValue(), '--repeats');
    else if (name === '--channel') options.channel = takeValue();
    else if (name === '--headed') options.headed = true;
    else if (name === '--help' || name === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (options.repeats < 1) throw new Error('--repeats must be at least 1');

  return options;
}

function parseNumberList(value, option) {
  const values = value.split(',').map((entry) => parseInteger(entry, option));
  const invalid = values.filter((entry) => !DEFAULT_COUNTS.includes(entry));
  if (values.length === 0 || invalid.length > 0) {
    throw new Error(`${option} accepts the configured ladder only; invalid: ${invalid.join(',')}`);
  }
  return [...new Set(values)];
}

function parseScenarioList(value) {
  const scenarios = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  const invalid = scenarios.filter((entry) => !DEFAULT_SCENARIOS.includes(entry));
  if (scenarios.length === 0 || invalid.length > 0) {
    throw new Error(`--scenarios accepts constant,field,herd; invalid: ${invalid.join(',')}`);
  }
  return [...new Set(scenarios)];
}

function parseDuration(value, option) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration < 0) throw new Error(`${option} must be a non-negative number of milliseconds`);
  return duration;
}

function parseInteger(value, option) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${option} must be an integer`);
  return number;
}

function printHelp() {
  console.log(`GPU Boids benchmark

Usage:
  node scripts/benchmark.mjs [options]

Options:
  --url URL                 Production preview URL (default http://127.0.0.1:4190)
  --counts LIST             Comma-separated boid counts
  --scenarios LIST          constant,field,herd
  --duration MS             Measured duration per case (default 60000)
  --warmup MS               Warmup per case (default 10000)
  --seed INTEGER            Initialization seed
  --repeats INTEGER         Repeat every case (default 1)
  --out FILE                JSON report path
  --channel NAME            Playwright browser channel (default chrome)
  --headed                  Show the browser
  --help                    Show this help

Examples:
  node scripts/benchmark.mjs --counts 1000,16000 --duration 5000 --warmup 1000
  node scripts/benchmark.mjs --headed --scenarios herd --counts 50000,100000
`);
}

function percentile(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

function summarizeFrameIntervals(values) {
  if (values.length === 0) {
    return { sampleCount: 0, meanMs: null, p50Ms: null, p95Ms: null, p99Ms: null, medianFps: null, longFrames: 0 };
  }

  const meanMs = values.reduce((sum, value) => sum + value, 0) / values.length;
  const p50Ms = percentile(values, 0.5);
  const p95Ms = percentile(values, 0.95);
  const p99Ms = percentile(values, 0.99);
  return {
    sampleCount: values.length,
    meanMs,
    p50Ms,
    p95Ms,
    p99Ms,
    medianFps: p50Ms === null || p50Ms === 0 ? null : 1000 / p50Ms,
    longFrames: values.filter((value) => value > 50).length,
  };
}

function classify(frame) {
  if (frame.p95Ms === null || frame.p99Ms === null) return 'unmeasured';
  if (frame.p95Ms <= 16.7 && frame.p99Ms <= 25) return '60-hz-pass';
  if (frame.p95Ms <= 33.3 && frame.p99Ms <= 50) return '30-hz-pass';
  return 'below-30-hz';
}

function assessValidity(samples, duration) {
  const before = samples.before;
  const after = samples.after;
  const invalidIndices = Number(after?.boids?.invalidIndices ?? 0);
  const truncatedBoids = Number(after?.boids?.truncatedBoids ?? 0);
  const droppedBefore = Number(before?.performance?.droppedSteps ?? 0);
  const droppedAfter = Number(after?.performance?.droppedSteps ?? 0);
  const droppedStepDelta = Math.max(0, droppedAfter - droppedBefore);
  const simulationBefore = Number(before?.simulationElapsed ?? 0);
  const simulationAfter = Number(after?.simulationElapsed ?? 0);
  const simulationAdvanceSeconds = Math.max(0, simulationAfter - simulationBefore);
  const expectedAdvanceSeconds = duration / 1000;
  const realTimeRatio = expectedAdvanceSeconds > 0
    ? simulationAdvanceSeconds / expectedAdvanceSeconds
    : null;

  let validity = 'exact-neighborhood';
  if (invalidIndices > 0) validity = 'invalid-indices';
  else if (realTimeRatio !== null && realTimeRatio < 0.95) validity = 'simulation-lag';
  else if (droppedStepDelta > 0) validity = 'dropped-steps';
  else if (truncatedBoids > 0) validity = 'candidate-capped';

  return {
    validity,
    invalidIndices,
    truncatedBoids,
    droppedStepDelta,
    simulationAdvanceSeconds,
    expectedAdvanceSeconds,
    realTimeRatio,
  };
}

function extractTimestampQueryEvidence(diagnostics) {
  const timing = diagnostics?.timing ?? diagnostics?.performance ?? diagnostics?.timings;
  if (!timing || typeof timing !== 'object') return null;

  const source = timing.gpuSource ?? timing.gpu?.source ?? timing.source;
  const supported = timing.gpuTimestampSupported ?? timing.gpu?.supported;
  if (source !== 'timestamp-query' || supported !== true) return null;

  return {
    source: 'timestamp-query',
    computeMs: timing.gpuComputeMs ?? timing.gpu?.computeMs ?? null,
    renderMs: timing.gpuRenderMs ?? timing.gpu?.renderMs ?? null,
    totalMs: timing.gpuTotalMs ?? timing.gpu?.totalMs ?? null,
  };
}

function extractCpuSubmissionEvidence(diagnostics) {
  const timing = diagnostics?.timing ?? diagnostics?.performance ?? diagnostics?.timings;
  if (!timing || typeof timing !== 'object') return null;
  const compute = timing.cpuSubmitMs
    ?? timing.cpuComputeSubmissionMs
    ?? timing.computeSubmitMs
    ?? timing.computeSubmitP95Ms
    ?? timing.cpu?.submitMs;
  const render = timing.cpuRenderSubmissionMs
    ?? timing.renderSubmitMs
    ?? timing.renderSubmitP95Ms
    ?? timing.cpu?.renderSubmitMs;
  if (!Number.isFinite(compute) && !Number.isFinite(render)) return null;
  return {
    source: 'performance.now',
    statistic: timing.computeSubmitP95Ms === compute || timing.renderSubmitP95Ms === render ? 'p95' : 'latest',
    computeMilliseconds: Number.isFinite(compute) ? compute : null,
    renderMilliseconds: Number.isFinite(render) ? render : null,
  };
}

async function waitForRuntime(page) {
  await page.waitForFunction(() => {
    const diagnostics = window.__THREE_GAME_DIAGNOSTICS__;
    const overlay = document.querySelector('#game-overlay');
    return Boolean(diagnostics?.status)
      || diagnostics?.error
      || overlay?.getAttribute('data-state') === 'error';
  }, null, { timeout: 45_000 });

  return page.evaluate(() => {
    const diagnostics = window.__THREE_GAME_DIAGNOSTICS__ ?? null;
    const overlay = document.querySelector('#game-overlay');
    const status = diagnostics?.status ?? null;
    return {
      ready: Boolean(status && status !== 'error' && !diagnostics?.error),
      status,
      error: diagnostics?.error ?? null,
      overlayState: overlay?.getAttribute('data-state') ?? null,
      overlayText: overlay?.textContent?.trim() ?? null,
      adapterText: document.querySelector('#adapter-line')?.textContent?.trim() ?? null,
      diagnostics,
    };
  });
}

async function sampleFrames(page, warmup, duration) {
  return page.evaluate(async ({ warmupMs, durationMs }) => {
    const runFrames = (targetMs, collect) => new Promise((resolve) => {
      const intervals = [];
      let start = -1;
      let previous = -1;

      const tick = (timestamp) => {
        if (start < 0) {
          start = timestamp;
          previous = timestamp;
        } else {
          const interval = timestamp - previous;
          previous = timestamp;
          if (collect && interval > 0 && Number.isFinite(interval)) intervals.push(interval);
        }

        if (timestamp - start >= targetMs) resolve(intervals);
        else requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);
    });

    if (warmupMs > 0) await runFrames(warmupMs, false);
    const before = structuredClone(window.__THREE_GAME_DIAGNOSTICS__ ?? null);
    const intervals = durationMs > 0 ? await runFrames(durationMs, true) : [];
    const after = structuredClone(window.__THREE_GAME_DIAGNOSTICS__ ?? null);
    return { intervals, before, after };
  }, { warmupMs: warmup, durationMs: duration });
}

async function runCase(browser, options, count, scenario, repeat) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const target = new URL(options.url);
  target.searchParams.set('benchmark', '1');
  target.searchParams.set('bench', '1');
  target.searchParams.set('count', String(count));
  target.searchParams.set('scenario', scenario);
  target.searchParams.set('seed', String(options.seed));

  const startedAt = new Date().toISOString();
  try {
    await page.goto(target.toString(), { waitUntil: 'networkidle', timeout: 45_000 });
    const runtime = await waitForRuntime(page);
    const browserDetails = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      webgpuExposed: 'gpu' in navigator,
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    }));

    if (!runtime.ready) {
      return {
        count,
        scenario,
        repeat,
        status: 'unsupported-or-error',
        startedAt,
        browser: browserDetails,
        runtime,
        consoleErrors,
        pageErrors,
      };
    }

    const samples = await sampleFrames(page, options.warmup, options.duration);
    const frameIntervals = summarizeFrameIntervals(samples.intervals);
    const timingClassification = classify(frameIntervals);
    const semantic = assessValidity(samples, options.duration);
    return {
      count,
      scenario,
      repeat,
      status: 'measured',
      classification: semantic.validity === 'exact-neighborhood'
        ? timingClassification
        : `${timingClassification}-${semantic.validity}`,
      timingClassification,
      semantic,
      startedAt,
      browser: browserDetails,
      warmupMs: options.warmup,
      measuredDurationMs: options.duration,
      frameIntervalSource: 'window.requestAnimationFrame timestamps',
      frameIntervals,
      gpuTimestamp: extractTimestampQueryEvidence(samples.after),
      cpuSubmission: extractCpuSubmissionEvidence(samples.after),
      diagnosticsBefore: samples.before,
      diagnosticsAfter: samples.after,
      consoleErrors,
      pageErrors,
    };
  } catch (error) {
    return {
      count,
      scenario,
      repeat,
      status: 'runner-error',
      startedAt,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      consoleErrors,
      pageErrors,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({
    channel: options.channel,
    headless: !options.headed,
    args: ['--enable-unsafe-webgpu'],
  });
  const browserVersion = browser.version();
  const results = [];

  try {
    for (let repeat = 1; repeat <= options.repeats; repeat += 1) {
      for (const scenario of options.scenarios) {
        for (const count of options.counts) {
          process.stdout.write(`Running ${scenario} at ${count.toLocaleString()} boids (${repeat}/${options.repeats})... `);
          const result = await runCase(browser, options, count, scenario, repeat);
          results.push(result);
          console.log(result.classification ?? result.status);
        }
      }
    }
  } finally {
    await browser.close();
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    browserVersion,
    command: process.argv,
    methodology: {
      buildExpectation: 'production preview',
      viewport: '1280x720',
      deviceScaleFactor: 1,
      seed: options.seed,
      counts: options.counts,
      scenarios: options.scenarios,
      warmupMs: options.warmup,
      measuredDurationMs: options.duration,
      repeats: options.repeats,
      percentileMethod: 'nearest-rank',
      frameTiming: 'requestAnimationFrame delivery interval; this is not GPU execution time',
      gpuTiming: 'reported only when diagnostics identify timestamp-query as the source',
      passThresholds: {
        '60-hz-pass': { p95MsAtMost: 16.7, p99MsAtMost: 25 },
        '30-hz-pass': { p95MsAtMost: 33.3, p99MsAtMost: 50 },
      },
    },
    results,
  };

  await mkdir(path.dirname(options.out), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${path.resolve(options.out)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
