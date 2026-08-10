import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CodexCompanion } from "../src/codex-companion.mjs";

class FakeThread {
  constructor() {
    this.id = "thread-local-1";
    this.inputs = [];
  }

  async run(input) {
    this.inputs.push(input);
    return {
      finalResponse: JSON.stringify({ action: "silent", channelId: null, messageId: null, content: null, emoji: null }),
      usage: null,
    };
  }
}

class FakeCodex {
  constructor(options) {
    this.options = options;
    this.thread = new FakeThread();
  }

  startThread() {
    return this.thread;
  }

  resumeThread() {
    return this.thread;
  }
}

const batch = {
  createdAt: "2026-08-10T12:00:00.000Z",
  directPing: false,
  messageCount: 1,
  channels: [{
    channelId: "123",
    policy: { mode: "active", canSpeak: true, canReact: true },
    messages: [{ id: "m1", timestamp: "2026-08-10T12:00:00.000Z", author: { id: "u1", username: "human" }, content: "hello", attachments: [], embeds: [] }],
  }],
};

test("identity is injected initially and whenever companion-authored files change", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "companion-sdk-identity-"));
  const identityDirectory = path.join(root, "identity");
  await mkdir(identityDirectory);
  await writeFile(path.join(identityDirectory, "PERSONA.md"), "I am Example Companion.");
  const companion = new CodexCompanion({ dataDirectory: root, identityDirectory, CodexClass: FakeCodex, codexHomeProvider: async () => path.join(root, "isolated-codex-home") });
  try {
    await companion.run(batch);
    await companion.run(batch);
    await writeFile(path.join(identityDirectory, "PERSONA.md"), "I am Example Companion, and I choose when to speak.");
    await companion.run(batch);
    const prompts = companion.thread.inputs.map((input) => input[0].text);
    assert.match(prompts[0], /COMPANION-AUTHORED IDENTITY PACKET/);
    assert.doesNotMatch(prompts[1], /COMPANION-AUTHORED IDENTITY PACKET/);
    assert.match(prompts[2], /I choose when to speak/);
    assert.equal(companion.client.options.config.features.shell_tool, false);
    assert.equal(companion.client.options.config.features.apps, false);
    assert.equal(companion.client.options.env.CODEX_HOME, path.join(root, "isolated-codex-home"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the generated persona scaffold cannot silently become the companion", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "companion-sdk-scaffold-"));
  const identityDirectory = path.join(root, "identity");
  await mkdir(identityDirectory);
  await writeFile(path.join(identityDirectory, "PERSONA.md"), "<!-- COMPANION_CORE_LITE_IDENTITY_SCAFFOLD -->\nReplace me.");
  const companion = new CodexCompanion({ dataDirectory: root, identityDirectory, CodexClass: FakeCodex, codexHomeProvider: async () => path.join(root, "isolated-codex-home") });
  try {
    await assert.rejects(() => companion.run(batch), /still the setup scaffold/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
