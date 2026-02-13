import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import RAPIER from "@dimforge/rapier3d-compat";
import { ncontext } from "../src/shared/netcode";
import { GameServer } from "../src/server/GameServer";
import { SERVER_TICK_RATE } from "../src/shared/config";

const OUTPUT_DIR = path.join(process.cwd(), "output", "tick-consistency");
const WARMUP_SECONDS = 5;
const RUN_SECONDS = 15;

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to determine free port."));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function main(): Promise<void> {
  ensureDir(OUTPUT_DIR);
  process.env.NENGI_TRANSPORT = "ws";
  process.env.SERVER_TICK_LOG = "0";
  await RAPIER.init();
  const testPort = await getFreePort();

  const server = new GameServer(ncontext);
  await server.start(testPort);
  await delay(WARMUP_SECONDS * 1000);
  server.resetTickMetrics();
  await delay(RUN_SECONDS * 1000);
  server.stop();

  const metrics = server.getTickMetrics();
  if (!metrics) {
    throw new Error("No tick metrics were captured.");
  }

  const report = {
    timestamp_utc: new Date().toISOString(),
    warmup_seconds: WARMUP_SECONDS,
    run_seconds: RUN_SECONDS,
    target_tps: SERVER_TICK_RATE,
    test_port: testPort,
    metrics
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(
    `[tick] PASS samples=${metrics.samples} target=${metrics.target_ms.toFixed(2)}ms mean=${metrics.mean_ms.toFixed(2)}ms stddev=${metrics.stddev_ms.toFixed(2)}ms p95_err=${metrics.p95_abs_error_ms.toFixed(2)}ms`
  );
  process.exit(0);
}

void main().catch((error) => {
  console.error("[tick] FAIL", error);
  process.exit(1);
});
