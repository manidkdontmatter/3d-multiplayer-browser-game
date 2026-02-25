// Captures server errors and fatal diagnostics into a tiny capped local log file for host troubleshooting.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_MAX_LINES = 20;

export interface ServerDiagnosticsOptions {
  errorLogPath: string;
  maxLines?: number;
}

export class ServerDiagnostics {
  private readonly errorLogPath: string;
  private readonly maxLines: number;
  private readonly originalConsoleError: typeof console.error;

  public constructor(options: ServerDiagnosticsOptions) {
    this.errorLogPath = options.errorLogPath;
    this.maxLines = Math.max(1, Math.floor(options.maxLines ?? DEFAULT_MAX_LINES));
    this.originalConsoleError = console.error.bind(console);
  }

  public getErrorLogPath(): string {
    return this.errorLogPath;
  }

  public installConsoleErrorCapture(): void {
    const original = this.originalConsoleError;
    console.error = (...args: unknown[]): void => {
      original(...args);
      const detail = this.serializeArgs(args);
      this.appendLine(`level=error source=console.error detail="${detail}"`);
    };
  }

  public logFatal(source: "uncaughtException" | "unhandledRejection" | "startup", error: unknown): void {
    this.appendLine(`level=fatal source=${source} detail="${this.serializeUnknown(error)}"`);
  }

  private appendLine(message: string): void {
    const timestamp = new Date().toISOString();
    const line = `${timestamp} ${message}`;
    const logDir = dirname(this.errorLogPath);
    try {
      mkdirSync(logDir, { recursive: true });
      const existing = this.readExistingLines();
      existing.push(line);
      const capped = existing.slice(-this.maxLines);
      writeFileSync(this.errorLogPath, `${capped.join("\n")}\n`, "utf8");
    } catch {
      // Keep diagnostics fail-safe and never throw while handling errors.
    }
  }

  private readExistingLines(): string[] {
    try {
      const raw = readFileSync(this.errorLogPath, "utf8");
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch {
      return [];
    }
  }

  private serializeArgs(args: unknown[]): string {
    return args.map((value) => this.serializeUnknown(value)).join(" | ");
  }

  private serializeUnknown(value: unknown): string {
    if (value instanceof Error) {
      return `${value.name}: ${value.message} stack=${(value.stack ?? "").replace(/\r?\n/g, " \\n ")}`;
    }
    if (typeof value === "string") {
      return value.replace(/\r?\n/g, " \\n ");
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
