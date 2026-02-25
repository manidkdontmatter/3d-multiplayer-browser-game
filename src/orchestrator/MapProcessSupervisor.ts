// Supervises map server child processes for each configured map instance.
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import type { RuntimeMapConfig } from "../shared/world";

export interface MapProcessSpec {
  instanceId: string;
  mapId: string;
  wsPort: number;
  mapConfig: RuntimeMapConfig;
}

export interface ManagedMapProcess {
  readonly spec: MapProcessSpec;
  readonly pid: number;
  readonly wsUrl: string;
  readonly process: ChildProcess;
}

interface MapProcessSupervisorOptions {
  readonly restartWindowMs?: number;
  readonly restartMaxInWindow?: number;
  readonly quarantineMs?: number;
  readonly onMapProcessExit?: (instanceId: string) => void;
}

export class MapProcessSupervisor {
  private readonly managed = new Map<string, ManagedMapProcess>();
  private readonly restartHistory = new Map<string, number[]>();
  private readonly quarantineUntilByInstance = new Map<string, number>();
  private readonly restartWindowMs: number;
  private readonly restartMaxInWindow: number;
  private readonly quarantineMs: number;
  private readonly onMapProcessExit?: (instanceId: string) => void;
  private stopping = false;

  public constructor(
    private readonly orchestratorBaseUrl: string,
    private readonly internalRpcSecret: string,
    options?: MapProcessSupervisorOptions
  ) {
    this.restartWindowMs = Math.max(1_000, Math.floor(options?.restartWindowMs ?? 60_000));
    this.restartMaxInWindow = Math.max(1, Math.floor(options?.restartMaxInWindow ?? 3));
    this.quarantineMs = Math.max(1_000, Math.floor(options?.quarantineMs ?? 60_000));
    this.onMapProcessExit = options?.onMapProcessExit;
  }

  public start(specs: readonly MapProcessSpec[]): void {
    this.stopping = false;
    for (const spec of specs) {
      this.spawnMapProcess(spec);
    }
  }

  public startInstance(spec: MapProcessSpec): boolean {
    this.stopping = false;
    if (this.managed.has(spec.instanceId)) {
      return true;
    }
    return this.spawnMapProcess(spec);
  }

  public stopAll(): void {
    this.stopping = true;
    for (const managed of this.managed.values()) {
      managed.process.kill("SIGTERM");
    }
    this.managed.clear();
  }

  public getManaged(instanceId: string): ManagedMapProcess | null {
    return this.managed.get(instanceId) ?? null;
  }

  public getAll(): ManagedMapProcess[] {
    return [...this.managed.values()];
  }

  public killInstance(instanceId: string): boolean {
    const managed = this.managed.get(instanceId);
    if (!managed) {
      return false;
    }
    managed.process.kill("SIGTERM");
    return true;
  }

  public getQuarantineUntil(instanceId: string): number | null {
    const until = this.quarantineUntilByInstance.get(instanceId);
    return typeof until === "number" ? until : null;
  }

  private spawnMapProcess(spec: MapProcessSpec): boolean {
    const now = Date.now();
    const quarantineUntil = this.quarantineUntilByInstance.get(spec.instanceId) ?? 0;
    if (quarantineUntil > now) {
      console.warn(
        `[orchestrator] map instance quarantined instance=${spec.instanceId} until=${new Date(quarantineUntil).toISOString()}`
      );
      return false;
    }
    const repoRoot = process.cwd();
    const entryPath = resolve(repoRoot, "src/server/main.ts");
    const child = spawn(
      process.execPath,
      ["--import", "tsx", entryPath],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          SERVER_PORT: String(spec.wsPort),
          MAP_INSTANCE_ID: spec.instanceId,
          MAP_ID: spec.mapId,
          MAP_SEED: String(spec.mapConfig.seed),
          MAP_GROUND_HALF_EXTENT: String(spec.mapConfig.groundHalfExtent),
          MAP_GROUND_HALF_THICKNESS: String(spec.mapConfig.groundHalfThickness),
          MAP_CUBE_COUNT: String(spec.mapConfig.cubeCount),
          ORCHESTRATOR_INTERNAL_URL: this.orchestratorBaseUrl,
          ORCH_INTERNAL_RPC_SECRET: this.internalRpcSecret,
          SERVER_DISABLE_PERSISTENCE_WRITES: "1"
        },
        stdio: "inherit"
      }
    );

    const managed: ManagedMapProcess = {
      spec,
      pid: child.pid ?? -1,
      wsUrl: `ws://localhost:${spec.wsPort}`,
      process: child
    };
    this.managed.set(spec.instanceId, managed);
    child.on("exit", (code, signal) => {
      this.managed.delete(spec.instanceId);
      this.onMapProcessExit?.(spec.instanceId);
      console.error(
        `[orchestrator] map process exited instance=${spec.instanceId} code=${code ?? "null"} signal=${signal ?? "null"}`
      );
      if (this.stopping) {
        return;
      }
      if (!this.canRestart(spec.instanceId)) {
        return;
      }
      setTimeout(() => {
        if (this.stopping || this.managed.has(spec.instanceId)) {
          return;
        }
        void this.spawnMapProcess(spec);
      }, 500);
    });
    return true;
  }

  private canRestart(instanceId: string): boolean {
    const now = Date.now();
    const history = this.restartHistory.get(instanceId) ?? [];
    const recent = history.filter((timestamp) => now - timestamp <= this.restartWindowMs);
    recent.push(now);
    this.restartHistory.set(instanceId, recent);
    if (recent.length <= this.restartMaxInWindow) {
      return true;
    }
    const quarantineUntil = now + this.quarantineMs;
    this.quarantineUntilByInstance.set(instanceId, quarantineUntil);
    this.restartHistory.set(instanceId, []);
    console.error(
      `[orchestrator] map restart threshold exceeded instance=${instanceId} quarantined_ms=${this.quarantineMs}`
    );
    return false;
  }
}
