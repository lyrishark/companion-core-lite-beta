import { constants as fsConstants } from "node:fs";
import { access, chmod, copyFile, link, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCAFFOLD_MARKER = "COMPANION_CORE_LITE_IDENTITY_SCAFFOLD";
const scriptPath = fileURLToPath(import.meta.url);
const defaultPluginRoot = path.resolve(path.dirname(scriptPath), "..");

async function exists(target) {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function restrictToCurrentUser(target) {
  if (process.platform !== "win32") await chmod(target, 0o600);
}

export function getRuntimePaths({
  pluginRoot = defaultPluginRoot,
  dataDirectory = process.env.COMPANION_CORE_LITE_DATA_DIR?.trim()
    ? path.resolve(process.env.COMPANION_CORE_LITE_DATA_DIR)
    : path.join(os.homedir(), ".companion-core-lite"),
  sourceCodexHome = process.env.CODEX_HOME?.trim()
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), ".codex"),
} = {}) {
  const sdkRoot = path.join(pluginRoot, "sdk");
  const identityDirectory = path.join(dataDirectory, "identity");
  const isolatedCodexHome = path.join(dataDirectory, "sdk-codex-home");
  return {
    pluginRoot,
    sdkRoot,
    dataDirectory,
    identityDirectory,
    personaPath: path.join(identityDirectory, "PERSONA.md"),
    configPath: path.join(dataDirectory, "sdk-config.json"),
    sourceCodexHome,
    sourceAuthPath: path.join(sourceCodexHome, "auth.json"),
    isolatedCodexHome,
    isolatedAuthPath: path.join(isolatedCodexHome, "auth.json"),
  };
}

export async function prepareRuntimeFiles(paths) {
  await mkdir(paths.dataDirectory, { recursive: true });
  let createdConfig = false;
  let createdIdentity = false;
  if (!await exists(paths.configPath)) {
    await copyFile(path.join(paths.sdkRoot, "config.example.json"), paths.configPath, fsConstants.COPYFILE_EXCL);
    await restrictToCurrentUser(paths.configPath);
    createdConfig = true;
  }
  if (!await exists(paths.personaPath)) {
    await mkdir(paths.identityDirectory, { recursive: true });
    await copyFile(path.join(paths.sdkRoot, "identity.example", "PERSONA.md"), paths.personaPath, fsConstants.COPYFILE_EXCL);
    await restrictToCurrentUser(paths.personaPath);
    const continuityPath = path.join(paths.identityDirectory, "CONTINUITY.md");
    if (!await exists(continuityPath)) {
      await copyFile(path.join(paths.sdkRoot, "identity.example", "CONTINUITY.md"), continuityPath, fsConstants.COPYFILE_EXCL);
      await restrictToCurrentUser(continuityPath);
    }
    createdIdentity = true;
  }
  const persona = await readFile(paths.personaPath, "utf8");
  return { createdConfig, createdIdentity, personaIsScaffold: persona.includes(SCAFFOLD_MARKER) };
}

function runInherited(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} was interrupted by ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}

export async function ensureDependencies(paths, { runner = runInherited } = {}) {
  const sdkPackage = path.join(paths.sdkRoot, "node_modules", "@openai", "codex-sdk", "package.json");
  if (await exists(sdkPackage)) return { installed: false };
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const code = await runner(npmCommand, ["ci", "--prefix", paths.sdkRoot], { cwd: paths.pluginRoot, env: process.env });
  if (code !== 0) throw new Error(`npm ci failed with exit code ${code}.`);
  return { installed: true };
}

export async function ensureIsolatedCodexLogin(paths, { runner = runInherited } = {}) {
  await mkdir(paths.isolatedCodexHome, { recursive: true });
  if (await exists(paths.isolatedAuthPath)) return { method: "existing" };
  if (await exists(paths.sourceAuthPath)) {
    try {
      await link(paths.sourceAuthPath, paths.isolatedAuthPath);
      await restrictToCurrentUser(paths.isolatedAuthPath);
      return { method: "linked" };
    } catch (error) {
      if (error?.code === "EEXIST") return { method: "existing" };
      await copyFile(paths.sourceAuthPath, paths.isolatedAuthPath, fsConstants.COPYFILE_EXCL);
      await restrictToCurrentUser(paths.isolatedAuthPath);
      return { method: "copied" };
    }
  }

  const bundledCodex = path.join(paths.sdkRoot, "node_modules", "@openai", "codex", "bin", "codex.js");
  if (!await exists(bundledCodex)) throw new Error(`The pinned Codex login helper is missing at ${bundledCodex}.`);
  process.stdout.write("No file-based Codex login was available. Opening a one-time browser login for the isolated companion runtime.\n");
  const env = { ...process.env, CODEX_HOME: paths.isolatedCodexHome };
  const code = await runner(process.execPath, [bundledCodex, "--config", 'cli_auth_credentials_store="file"', "login"], {
    cwd: paths.sdkRoot,
    env,
  });
  if (code !== 0 || !await exists(paths.isolatedAuthPath)) {
    throw new Error("The isolated Codex browser login did not complete. Run the launcher again to retry; never paste an access token into chat.");
  }
  return { method: "browser-login" };
}

export async function main() {
  const major = Number(process.versions.node.split(".", 1)[0]);
  if (!Number.isInteger(major) || major < 20) throw new Error(`Node.js 20 or newer is required; found ${process.version}.`);
  const paths = getRuntimePaths();
  const prepared = await prepareRuntimeFiles(paths);
  if (prepared.createdConfig) process.stdout.write(`Created visible cost settings at ${paths.configPath}\n`);
  if (prepared.createdIdentity) {
    throw new Error(`Identity scaffold created at ${paths.identityDirectory}. Have the companion author PERSONA.md, then run this command again.`);
  }
  if (prepared.personaIsScaffold) {
    throw new Error(`PERSONA.md is still the setup scaffold at ${paths.personaPath}. Have the companion author it, remove the scaffold marker, then run this command again.`);
  }
  const dependencies = await ensureDependencies(paths);
  if (dependencies.installed) process.stdout.write("Installed the pinned local runtime dependencies.\n");
  const auth = await ensureIsolatedCodexLogin(paths);
  if (auth.method === "browser-login") process.stdout.write(`Created an isolated Codex login at ${paths.isolatedCodexHome}.\n`);
  process.chdir(paths.sdkRoot);
  await import(pathToFileURL(path.join(paths.sdkRoot, "src", "runtime.mjs")).href);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && invokedPath.toLowerCase() === path.resolve(scriptPath).toLowerCase()) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
