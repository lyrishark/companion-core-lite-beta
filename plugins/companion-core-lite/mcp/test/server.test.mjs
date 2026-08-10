import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFile, mkdtemp } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";

const serverPath = path.resolve(import.meta.dirname, "../server.mjs");
const APPLICATION_ID = "100000000000000001";
const SERVER_ID = "100000000000000002";
const CHANNEL_ID = "100000000000000005";
const MESSAGE_ID = "100000000000000008";

async function startServer(dataDirectory) {
  dataDirectory ??= await mkdtemp(path.join(os.tmpdir(), "companion-core-lite-mcp-test-"));
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, COMPANION_CORE_LITE_DATA_DIR: dataDirectory },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = readline.createInterface({ input: child.stdout });
  const queue = [];
  lines.on("line", (line) => queue.shift()?.(JSON.parse(line)));
  let nextId = 1;
  return {
    child,
    request(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve) => {
        queue.push((response) => {
          assert.equal(response.id, id);
          resolve(response);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    close() {
      lines.close();
      child.kill();
    },
  };
}

async function startReadyBridge(dataDirectory) {
  const sessionKey = "test-session-key-that-is-longer-than-32-characters";
  const server = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${sessionKey}`);
    assert.equal(request.url, "/v1/status");
    const body = JSON.stringify({
      connected: true,
      capabilities: { automaticHeartbeatBatching: true },
      bot: { username: "Example Companion" },
      guild: { name: "Test server" },
    });
    response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    response.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await writeFile(path.join(dataDirectory, "bridge-session.json"), `${JSON.stringify({
    baseUrl: `http://127.0.0.1:${address.port}`,
    sessionKey,
  })}\n`, "utf8");
  return server;
}

test("MCP exposes Discord read and participation tools without a token input", async () => {
  const server = await startServer();
  try {
    const listed = await server.request("tools/list");
    const tools = listed.result.tools;
    for (const name of ["set_discord_connection", "get_discord_transport_status", "peek_discord_channel", "post_discord_message", "react_discord_message", "poll_discord_activity", "acknowledge_discord_activity"]) {
      assert.ok(tools.some((tool) => tool.name === name));
    }
    const heartbeatTool = tools.find((tool) => tool.name === "set_heartbeat_settings");
    assert.ok(heartbeatTool.inputSchema.properties.preset.enum.includes("social-session"));
    assert.equal(JSON.stringify(tools).toLowerCase().includes('"token"'), false);

    const configured = await server.request("tools/call", {
      name: "set_discord_connection",
      arguments: { applicationId: APPLICATION_ID, serverId: SERVER_ID },
    });
    assert.equal(configured.result.structuredContent.discord.applicationId, APPLICATION_ID);

    const status = await server.request("tools/call", { name: "get_discord_transport_status", arguments: {} });
    assert.equal(status.result.structuredContent.transportStatus, "not-connected");
    assert.match(status.result.structuredContent.launchCommand, /start-discord-bridge\.mjs/);

    await server.request("tools/call", {
      name: "set_channel_policy",
      arguments: { channelId: CHANNEL_ID, mode: "active", canSpeak: false, canReact: false },
    });
    const blockedPost = await server.request("tools/call", {
      name: "post_discord_message",
      arguments: { channelId: CHANNEL_ID, content: "must not leave MCP" },
    });
    assert.match(blockedPost.error.message, /Speaking is disabled/);
    const blockedReaction = await server.request("tools/call", {
      name: "react_discord_message",
      arguments: { channelId: CHANNEL_ID, messageId: MESSAGE_ID, emoji: "🧡" },
    });
    assert.match(blockedReaction.error.message, /Reactions are disabled/);
  } finally {
    server.close();
  }
});

test("Social Session asks Work for a hard-bounded 48-run schedule", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "companion-core-lite-mcp-test-"));
  const bridge = await startReadyBridge(dataDirectory);
  const server = await startServer(dataDirectory);
  try {
    const saved = await server.request("tools/call", {
      name: "set_heartbeat_settings",
      arguments: { preset: "social-session" },
    });
    assert.equal(saved.result.structuredContent.heartbeatDeliveryStatus, "ready");
    assert.equal(saved.result.structuredContent.heartbeat.maximumScheduledChecks, 48);
    assert.match(saved.result.structuredContent.scheduleInstruction, /FREQ=MINUTELY;INTERVAL=5;COUNT=48/);
    assert.match(saved.result.structuredContent.scheduleInstruction, /do not recur/);
  } finally {
    server.close();
    await new Promise((resolve) => bridge.close(resolve));
  }
});
