// End-to-end orchestrator hardening suite for ticket security, map crash recovery, and persistence across restart.
import process from "node:process";
import net from "node:net";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";

const ROOT = process.cwd();
const ORCH_PORT = 9000;
const MAP_A_PORT = 9001;
const MAP_B_PORT = 9002;
const ORCH_URL = `http://127.0.0.1:${ORCH_PORT}`;
const INTERNAL_SECRET = `hardening-${randomBytes(8).toString("hex")}`;
const DB_PATH = `./data/hardening-e2e-${Date.now()}.sqlite`;
const START_TIMEOUT_MS = 25_000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isPortOpen(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function waitForPortOpen(host, port, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(host, port, 500)) {
      return;
    }
    await delay(120);
  }
  throw new Error(`Timed out waiting for ${label} on ${host}:${port}`);
}

function startProcess(name, command, args, envOverrides = {}) {
  const spawnConfig = {
    cwd: ROOT,
    env: { ...process.env, ...envOverrides },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  };

  const child = spawn(command, args, spawnConfig);

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${name}:err] ${chunk}`);
  });

  return child;
}

function stopProcessTree(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) {
      resolve();
      return;
    }

    if (process.platform === "win32") {
      execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], () => resolve());
    } else {
      child.kill("SIGTERM");
      resolve();
    }
  });
}

async function postJson(path, body, headers = {}) {
  const response = await fetch(`${ORCH_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  return { response, payload };
}

async function getJson(path) {
  const response = await fetch(`${ORCH_URL}${path}`);
  const payload = await response.json();
  return { response, payload };
}

async function waitForMapsReady(timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { payload } = await getJson("/health");
    const maps = Array.isArray(payload?.maps) ? payload.maps : [];
    const readyCount = maps.filter((map) => map?.ready === true).length;
    if (readyCount >= 2) {
      return maps;
    }
    await delay(180);
  }
  throw new Error("Timed out waiting for map processes to become ready.");
}

async function bootstrap(authKey) {
  const { response, payload } = await postJson("/bootstrap", { authKey });
  assert(response.ok, `/bootstrap failed with status ${response.status}`);
  assert(payload?.ok === true, `/bootstrap failed: ${payload?.error ?? "unknown_error"}`);
  assert(typeof payload.joinTicket === "string" && payload.joinTicket.length > 0, "Missing joinTicket.");
  return payload;
}

async function validateJoinTicket(joinTicket, mapInstanceId) {
  return postJson(
    "/orch/validate-join-ticket",
    { joinTicket, mapInstanceId },
    { "x-orch-secret": INTERNAL_SECRET }
  );
}

async function startOrchestrator() {
  const child = startProcess("orchestrator", process.execPath, ["--import", "tsx", "src/orchestrator/main.ts"], {
    ORCH_PORT: String(ORCH_PORT),
    MAP_A_PORT: String(MAP_A_PORT),
    MAP_B_PORT: String(MAP_B_PORT),
    ORCH_INTERNAL_RPC_SECRET: INTERNAL_SECRET,
    ORCH_ENABLE_DEBUG_ENDPOINTS: "1",
    ORCH_DATA_PATH: DB_PATH,
    ORCH_JOIN_TICKET_TTL_MS: "250",
    SERVER_AUTH_DISABLE_RATE_LIMIT: "1",
    SERVER_TICK_LOG: "0"
  });
  await waitForPortOpen("127.0.0.1", ORCH_PORT, START_TIMEOUT_MS, "orchestrator");
  await waitForPortOpen("127.0.0.1", MAP_A_PORT, START_TIMEOUT_MS, "map-a");
  await waitForPortOpen("127.0.0.1", MAP_B_PORT, START_TIMEOUT_MS, "map-b");
  await waitForMapsReady();
  return child;
}

function findMap(maps, instanceId) {
  return maps.find((entry) => entry?.instanceId === instanceId) ?? null;
}

async function runReplayDenialCheck() {
  const bootstrapPayload = await bootstrap("REPLAYKEY001");
  const first = await validateJoinTicket(bootstrapPayload.joinTicket, "map-a");
  assert(first.response.ok, "First join ticket validation should succeed.");
  assert(first.payload?.ok === true, "First join ticket validation payload should be ok.");

  const second = await validateJoinTicket(bootstrapPayload.joinTicket, "map-a");
  assert(second.response.status === 401, "Replay join ticket should be denied with 401.");
  assert(second.payload?.ok === false, "Replay join ticket should return ok=false.");
  assert(second.payload?.error === "ticket_already_consumed", `Unexpected replay error: ${second.payload?.error}`);
}

async function runExpiryDenialCheck() {
  const bootstrapPayload = await bootstrap("EXPIRYKEY001");
  await delay(700);
  const expired = await validateJoinTicket(bootstrapPayload.joinTicket, "map-a");
  assert(expired.response.status === 401, "Expired join ticket should be denied with 401.");
  assert(expired.payload?.ok === false, "Expired join ticket should return ok=false.");
  assert(expired.payload?.error === "ticket_expired", `Unexpected expired error: ${expired.payload?.error}`);
}

async function runCrashRestartCheck() {
  const { payload: healthBefore } = await getJson("/health");
  const mapsBefore = Array.isArray(healthBefore?.maps) ? healthBefore.maps : [];
  const mapABefore = findMap(mapsBefore, "map-a");
  const mapBBefore = findMap(mapsBefore, "map-b");
  assert(mapABefore?.ready === true, "map-a should be ready before crash test.");
  assert(mapBBefore?.ready === true, "map-b should be ready before crash test.");
  assert(typeof mapABefore?.pid === "number", "map-a pid should be present before crash.");
  const pidBefore = mapABefore.pid;
  const mapBPidBefore = mapBBefore.pid;

  const crash = await postJson(
    "/orch/debug/crash-map",
    { instanceId: "map-a" },
    { "x-orch-secret": INTERNAL_SECRET }
  );
  assert(crash.response.ok, `/orch/debug/crash-map failed with status ${crash.response.status}`);
  assert(crash.payload?.ok === true, "Crash endpoint should return ok=true.");

  const start = Date.now();
  let recovered = false;
  while (Date.now() - start < 25_000) {
    const { payload } = await getJson("/health");
    const maps = Array.isArray(payload?.maps) ? payload.maps : [];
    const mapA = findMap(maps, "map-a");
    const mapB = findMap(maps, "map-b");
    const mapARecovered = mapA?.ready === true && typeof mapA?.pid === "number" && mapA.pid !== pidBefore;
    const mapBHealthy = mapB?.ready === true && mapB?.pid === mapBPidBefore;
    if (mapARecovered && mapBHealthy) {
      recovered = true;
      break;
    }
    await delay(220);
  }
  assert(recovered, "map-a did not recover with a new pid while map-b stayed healthy.");
}

async function runTransferPersistenceAcrossRestartCheck(restartOrchestrator) {
  const authKey = "PERSKEY01A2B";
  const bootstrapPayload = await bootstrap(authKey);
  const validated = await validateJoinTicket(bootstrapPayload.joinTicket, "map-a");
  assert(validated.response.ok, "Initial validation for persistence test should succeed.");
  const accountId = validated.payload?.accountId;
  assert(typeof accountId === "number" && Number.isFinite(accountId), "Validated accountId missing.");

  const expected = {
    accountId,
    x: 42.25,
    y: 3.5,
    z: -77.75,
    yaw: 1.25,
    pitch: -0.35,
    vx: 0,
    vy: 0,
    vz: 0,
    health: 97,
    primaryMouseSlot: 0,
    secondaryMouseSlot: 1,
    hotbarAbilityIds: [1, 2, 3, 0, 0, 0]
  };

  const transfer = await postJson(
    "/orch/request-transfer",
    {
      authKey,
      accountId,
      fromMapInstanceId: "map-a",
      toMapInstanceId: "map-b",
      playerSnapshot: expected
    },
    { "x-orch-secret": INTERNAL_SECRET }
  );
  assert(transfer.response.ok, `/orch/request-transfer failed with status ${transfer.response.status}`);
  assert(transfer.payload?.ok === true, "Transfer request should return ok=true.");
  assert(typeof transfer.payload?.joinTicket === "string", "Transfer should return joinTicket.");

  await restartOrchestrator();

  const afterRestartBootstrap = await bootstrap(authKey);
  const afterRestartValidation = await validateJoinTicket(afterRestartBootstrap.joinTicket, "map-a");
  assert(afterRestartValidation.response.ok, "Validation after orchestrator restart should succeed.");
  const persisted = afterRestartValidation.payload?.playerSnapshot;
  assert(
    persisted && typeof persisted === "object",
    `Expected persisted playerSnapshot after restart: ${JSON.stringify(afterRestartValidation.payload)}`
  );
  assert(Math.abs((persisted.x ?? 0) - expected.x) < 1e-6, `Persisted x mismatch: ${persisted.x}`);
  assert(Math.abs((persisted.z ?? 0) - expected.z) < 1e-6, `Persisted z mismatch: ${persisted.z}`);
  assert((persisted.health ?? -1) === expected.health, `Persisted health mismatch: ${persisted.health}`);
}

async function main() {
  let orchestrator = null;
  let exitCode = 0;

  const restartOrchestrator = async () => {
    if (orchestrator) {
      await stopProcessTree(orchestrator);
      orchestrator = null;
      await delay(200);
    }
    orchestrator = await startOrchestrator();
  };

  try {
    orchestrator = await startOrchestrator();
    await runReplayDenialCheck();
    console.log("[hardening] replay-denial PASS");
    await runExpiryDenialCheck();
    console.log("[hardening] expiry-denial PASS");
    await runCrashRestartCheck();
    console.log("[hardening] crash-restart PASS");
    await runTransferPersistenceAcrossRestartCheck(restartOrchestrator);
    console.log("[hardening] persistence-boundary PASS");
    console.log("[hardening] PASS");
  } catch (error) {
    exitCode = 1;
    console.error("[hardening] FAIL", error);
  } finally {
    if (orchestrator) {
      await stopProcessTree(orchestrator);
    }
    await delay(250);
    process.exit(exitCode);
  }
}

void main();
