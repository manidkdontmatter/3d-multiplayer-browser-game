import { chromium } from "playwright";

const URL = "http://127.0.0.1:5173?e2e=1&server=ws://127.0.0.1:9001&e2eSimOnly=0";
const SAMPLE_DURATION_MS = Math.max(1000, Number(process.env.HEADLESS_FPS_DURATION_MS ?? 10000));
const SAMPLE_POLL_MS = Math.max(50, Number(process.env.HEADLESS_FPS_POLL_MS ?? 250));
const ARGS = [
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion,BackForwardCache"
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readState(page) {
  return page.evaluate(() => {
    if (typeof window.render_game_state === "function") {
      return window.render_game_state("minimal");
    }
    const text = window.render_game_to_text?.();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  });
}

function stats(samples) {
  if (samples.length === 0) {
    return { count: 0, avg: 0, min: 0, max: 0, p50: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((a, b) => a + b, 0);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  return {
    count: samples.length,
    avg: Number((sum / samples.length).toFixed(2)),
    min: Number(sorted[0].toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
    p50: Number(p50.toFixed(2))
  };
}

async function waitConnected(page, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await readState(page);
    if (state?.mode === "connected") {
      return true;
    }
    await sleep(200);
  }
  return false;
}

async function measureRafFps(page) {
  return page.evaluate(async (durationMs) => {
    const now = performance.now();
    const endAt = now + durationMs;
    let frames = 0;
    const startedAt = now;
    const endedAt = await new Promise((resolve) => {
      const tick = (t) => {
        frames += 1;
        if (t >= endAt) {
          resolve(t);
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const elapsedSeconds = Math.max(0.001, (endedAt - startedAt) / 1000);
    return frames / elapsedSeconds;
  }, SAMPLE_DURATION_MS);
}

async function runScenario(name, clientCount) {
  const browsers = [];
  const pages = [];
  try {
    for (let i = 0; i < clientCount; i += 1) {
      const browser = await chromium.launch({ headless: true, args: ARGS });
      const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
      browsers.push(browser);
      pages.push(page);
    }

    for (const page of pages) {
      await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.mouse.click(400, 225);
    }

    for (const page of pages) {
      const ok = await waitConnected(page);
      if (!ok) {
        throw new Error(`${name}: failed to connect`);
      }
    }

    await sleep(1500);

    const perPageSamples = Array.from({ length: clientCount }, () => []);
    const start = Date.now();
    while (Date.now() - start < SAMPLE_DURATION_MS) {
      for (let i = 0; i < pages.length; i += 1) {
        const state = await readState(pages[i]);
        const fps = Number(state?.perf?.fps);
        if (Number.isFinite(fps) && fps > 0) {
          perPageSamples[i].push(fps);
        }
      }
      await sleep(SAMPLE_POLL_MS);
    }

    const rafFpsByPage = await Promise.all(pages.map((page) => measureRafFps(page)));
    const pageStats = perPageSamples.map((samples, i) => ({
      page: i + 1,
      ...stats(samples),
      rafAvgFps: Number((rafFpsByPage[i] ?? 0).toFixed(2))
    }));
    const allSamples = perPageSamples.flat();
    const rafAggregate = stats(rafFpsByPage);
    return {
      name,
      clientCount,
      aggregate: stats(allSamples),
      rafAggregate,
      pages: pageStats
    };
  } finally {
    for (const browser of browsers) {
      await browser.close();
    }
  }
}

const single = await runScenario("single-headless-client", 1);
const dual = await runScenario("dual-headless-clients", 2);
console.log(JSON.stringify({ single, dual }, null, 2));
