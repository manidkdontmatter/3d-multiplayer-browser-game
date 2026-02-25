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

export class MapProcessSupervisor {
  private readonly managed = new Map<string, ManagedMapProcess>();

  public constructor(
    private readonly orchestratorBaseUrl: string,
    private readonly internalRpcSecret: string
  ) {}

  public start(specs: readonly MapProcessSpec[]): void {
    for (const spec of specs) {
      this.spawnMapProcess(spec);
    }
  }

  public stopAll(): void {
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

  private spawnMapProcess(spec: MapProcessSpec): void {
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
      console.error(
        `[orchestrator] map process exited instance=${spec.instanceId} code=${code ?? "null"} signal=${signal ?? "null"}`
      );
    });
  }
}
