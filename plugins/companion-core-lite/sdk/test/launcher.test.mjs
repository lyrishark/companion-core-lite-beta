import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ensureIsolatedCodexLogin,
  getRuntimePaths,
  prepareRuntimeFiles,
} from "../../scripts/start-sdk-runtime.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "companion-sdk-launcher-"));
  const pluginRoot = path.join(root, "plugin");
  const sdkRoot = path.join(pluginRoot, "sdk");
  await mkdir(path.join(sdkRoot, "identity.example"), { recursive: true });
  await writeFile(path.join(sdkRoot, "config.example.json"), "{}\n");
  await writeFile(path.join(sdkRoot, "identity.example", "PERSONA.md"), "<!-- COMPANION_CORE_LITE_IDENTITY_SCAFFOLD -->\n");
  await writeFile(path.join(sdkRoot, "identity.example", "CONTINUITY.md"), "# Continuity\n");
  return {
    root,
    paths: getRuntimePaths({
      pluginRoot,
      dataDirectory: path.join(root, "data"),
      sourceCodexHome: path.join(root, "source-codex-home"),
    }),
  };
}

test("cross-platform launcher creates visible config and identity scaffold once", async () => {
  const { root, paths } = await fixture();
  try {
    const first = await prepareRuntimeFiles(paths);
    assert.deepEqual(first, { createdConfig: true, createdIdentity: true, personaIsScaffold: true });
    if (process.platform !== "win32") assert.equal((await stat(paths.personaPath)).mode & 0o777, 0o600);
    await writeFile(paths.personaPath, "I choose when and how to participate.\n");
    const second = await prepareRuntimeFiles(paths);
    assert.deepEqual(second, { createdConfig: false, createdIdentity: false, personaIsScaffold: false });
    assert.equal(await readFile(path.join(paths.identityDirectory, "CONTINUITY.md"), "utf8"), "# Continuity\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file-based Codex auth is linked or copied into the isolated home", async () => {
  const { root, paths } = await fixture();
  try {
    await mkdir(paths.sourceCodexHome, { recursive: true });
    await writeFile(paths.sourceAuthPath, "{\"auth_mode\":\"chatgpt\"}\n", { mode: 0o600 });
    const result = await ensureIsolatedCodexLogin(paths);
    assert.ok(["linked", "copied"].includes(result.method));
    assert.equal(await readFile(paths.isolatedAuthPath, "utf8"), "{\"auth_mode\":\"chatgpt\"}\n");
    if (process.platform !== "win32") assert.equal((await stat(paths.isolatedAuthPath)).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Keychain-only users receive a one-time isolated browser login", async () => {
  const { root, paths } = await fixture();
  try {
    const bundledCodex = path.join(paths.sdkRoot, "node_modules", "@openai", "codex", "bin", "codex.js");
    await mkdir(path.dirname(bundledCodex), { recursive: true });
    await writeFile(bundledCodex, "// test fixture\n");
    let invocation;
    const result = await ensureIsolatedCodexLogin(paths, {
      runner: async (command, args, options) => {
        invocation = { command, args, options };
        await writeFile(paths.isolatedAuthPath, "{\"auth_mode\":\"chatgpt\"}\n", { mode: 0o600 });
        return 0;
      },
    });
    assert.equal(result.method, "browser-login");
    assert.equal(invocation.command, process.execPath);
    assert.deepEqual(invocation.args.slice(-3), ["--config", 'cli_auth_credentials_store="file"', "login"]);
    assert.equal(invocation.options.env.CODEX_HOME, paths.isolatedCodexHome);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
