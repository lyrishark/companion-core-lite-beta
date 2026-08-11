import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(scriptDirectory, "..");
const forbiddenLeafNames = new Set([
  ".env", "auth.json", "activity-state.json", "discord-bridge-session.json",
  "sdk-budget-ledger.json", "sdk-runtime-state.json", "sdk-failed-turn.json",
]);
const forbiddenDirectories = new Set(["node_modules", "sdk-codex-home", ".local-data"]);
const textExtensions = new Set([".json", ".md", ".mjs", ".js", ".ts", ".ps1", ".sh", ".html", ".yml", ".yaml", ".toml", ".txt"]);
const secretPatterns = [
  /(?<![A-Za-z0-9_-])mfa\.[A-Za-z0-9_-]{40,}/,
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/,
  /(?<![A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{20,}/,
  /(?<![A-Za-z0-9_-])gh[pousr]_[A-Za-z0-9]{30,}/,
];

async function walk(directory, relative = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if ([".git", "dist", "node_modules"].includes(entry.name)) continue;
      files.push(...await walk(path.join(directory, entry.name), childRelative));
    } else if (entry.isFile()) files.push(childRelative);
  }
  return files;
}

async function listedFiles() {
  try {
    const output = execFileSync("git", ["-C", repoRoot, "ls-files", "--cached", "--others", "--exclude-standard"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.split(/\r?\n/).filter(Boolean);
  } catch {
    return walk(repoRoot);
  }
}

const files = await listedFiles();
const forbidden = files.filter((relative) => {
  const segments = relative.split(/[\\/]/);
  return forbiddenLeafNames.has(segments.at(-1)) || segments.some((segment) => forbiddenDirectories.has(segment));
});
if (forbidden.length) throw new Error(`Share tree contains forbidden live-state or dependency paths:\n${forbidden.join("\n")}`);

const suspect = [];
for (const relative of files) {
  if (!textExtensions.has(path.extname(relative).toLowerCase())) continue;
  const content = await readFile(path.join(repoRoot, relative), "utf8");
  if (secretPatterns.some((pattern) => pattern.test(content))) suspect.push(relative);
}
if (suspect.length) throw new Error(`Possible token-shaped secret found; values were not printed. Inspect:\n${suspect.join("\n")}`);

process.stdout.write(`Share-tree audit passed: ${files.length} files checked; no forbidden live state, dependencies, or token-shaped secrets found.\n`);
