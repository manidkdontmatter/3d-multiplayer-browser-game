/**
 * Purpose: Enforce canonical creator/station terminology by rejecting legacy bench/workbench wording in engine/game code.
 * Scope: It belongs to the repository guard-rail scripts layer.
 * Human Summary: Fails CI if old crafting bench terminology reappears in source.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

interface Violation {
  file: string;
  line: number;
  token: string;
  excerpt: string;
}

const ROOTS = ["src/engine", "src/game"];
const FILE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json"]);
const EXCLUDE_FILE_SUFFIXES = [".md"];
const BANNED_PATTERNS: ReadonlyArray<{ token: string; regex: RegExp }> = [
  { token: "workbench", regex: /\bworkbench\b/gi },
  { token: "bench", regex: /\bbench\b/gi },
  { token: "craft_bench", regex: /\bcraft_bench\b/gi },
  { token: "requiresBenchSession", regex: /\brequiresBenchSession\b/g }
];

function shouldScanFile(path: string): boolean {
  const ext = extname(path).toLowerCase();
  if (!FILE_EXTENSIONS.has(ext)) {
    return false;
  }
  for (const suffix of EXCLUDE_FILE_SUFFIXES) {
    if (path.endsWith(suffix)) {
      return false;
    }
  }
  return true;
}

function gatherFiles(root: string, out: string[]): void {
  for (const entry of readdirSync(root)) {
    const next = join(root, entry);
    const stats = statSync(next);
    if (stats.isDirectory()) {
      gatherFiles(next, out);
      continue;
    }
    if (stats.isFile() && shouldScanFile(next)) {
      out.push(next);
    }
  }
}

function collectViolations(filePath: string): Violation[] {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const violations: Violation[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const pattern of BANNED_PATTERNS) {
      pattern.regex.lastIndex = 0;
      if (!pattern.regex.test(line)) {
        continue;
      }
      violations.push({
        file: relative(process.cwd(), filePath),
        line: index + 1,
        token: pattern.token,
        excerpt: line.trim()
      });
    }
  }
  return violations;
}

function main(): void {
  const files: string[] = [];
  for (const root of ROOTS) {
    gatherFiles(join(process.cwd(), root), files);
  }

  const violations = files.flatMap((file) => collectViolations(file));
  if (violations.length <= 0) {
    console.log("[check-creator-station-terminology] passed");
    return;
  }

  console.error("[check-creator-station-terminology] failed");
  for (const violation of violations) {
    console.error(
      ` - ${violation.file}:${violation.line} contains "${violation.token}": ${violation.excerpt}`
    );
  }
  process.exit(1);
}

main();
