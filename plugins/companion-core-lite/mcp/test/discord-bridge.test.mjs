import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startDiscordBridge } from "../../bridge/discord-bridge.mjs";
import {
  callBridge,
  peekBridgeChannel,
  postBridgeMessage,
  reactBridgeMessage,
  readBridgeSession,
} from "../lib/bridge-client.mjs";
import { setChannelPolicy, setDiscordConnection } from "../lib/settings.mjs";

const APPLICATION_ID = "100000000000000001";
const SERVER_ID = "100000000000000002";
const ACTIVE_CHANNEL_ID = "100000000000000005";
const LURK_CHANNEL_ID = "100000000000000006";
const BOT_ID = "100000000000000003";
const HUMAN_ID = "100000000000000004";
const MESSAGE_ID = "100000000000000008";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeDiscordFetch(token, applicationId = APPLICATION_ID, writes = { posts: [], reactions: [] }) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    if (url.hostname === "cdn.discordapp.com") {
      return new Response(Uint8Array.from([137, 80, 78, 71]), {
        headers: { "content-type": "image/png", "content-length": "4" },
      });
    }
    assert.equal(init.headers.authorization, `Bot ${token}`);
    if (url.pathname.endsWith("/users/@me")) return json({ id: BOT_ID, username: "Example Companion", bot: true });
    if (url.pathname.endsWith("/oauth2/applications/@me")) return json({ id: applicationId, name: "Example Companion Bot" });
    if (url.pathname.endsWith(`/guilds/${SERVER_ID}`)) return json({ id: SERVER_ID, name: "Test Hearth" });
    if (url.pathname.endsWith(`/channels/${ACTIVE_CHANNEL_ID}`)) return json({ id: ACTIVE_CHANNEL_ID, guild_id: SERVER_ID, name: "active-test", type: 0 });
    if (url.pathname.endsWith(`/channels/${LURK_CHANNEL_ID}`)) return json({ id: LURK_CHANNEL_ID, guild_id: SERVER_ID, name: "lurk-test", type: 0 });
    if (url.pathname.endsWith(`/channels/${ACTIVE_CHANNEL_ID}/messages`) && method === "GET") {
      return json([{
        id: MESSAGE_ID,
        timestamp: "2026-08-10T18:00:00.000Z",
        author: { id: HUMAN_ID, username: "Rae", global_name: "Rae" },
        content: "hello from Discord https://example.com",
        mentions: [],
        attachments: [{
          id: "1536430627765878111",
          filename: "hello.png",
          content_type: "image/png",
          size: 4,
          url: "https://cdn.discordapp.com/attachments/test/hello.png",
          width: 1,
          height: 1,
        }],
        embeds: [{ type: "link", url: "https://example.com", title: "Example", provider: { name: "Example" } }],
      }]);
    }
    if (url.pathname.endsWith(`/channels/${ACTIVE_CHANNEL_ID}/messages`) && method === "POST") {
      const body = JSON.parse(init.body);
      writes.posts.push(body);
      return json({
        id: "1536430627765879001",
        timestamp: "2026-08-10T18:01:00.000Z",
        author: { id: BOT_ID, username: "Example Companion", bot: true },
        content: body.content,
        mentions: body.allowed_mentions.users?.map((id) => ({ id })) ?? [],
        attachments: [],
        embeds: [],
      });
    }
    if (url.pathname.includes(`/channels/${ACTIVE_CHANNEL_ID}/messages/${MESSAGE_ID}/reactions/`) && method === "PUT") {
      writes.reactions.push(url.pathname);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fake Discord request: ${url}`);
  };
}

async function fixture() {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "companion-core-lite-bridge-test-"));
  await setDiscordConnection({ applicationId: APPLICATION_ID, serverId: SERVER_ID }, dataDirectory);
  await setChannelPolicy({ channelId: ACTIVE_CHANNEL_ID, label: "active-test", mode: "active" }, dataDirectory);
  await setChannelPolicy({ channelId: LURK_CHANNEL_ID, label: "lurk-test", mode: "lurk" }, dataDirectory);
  return dataDirectory;
}

test("bridge authenticates, peeks Active messages, and returns bounded image bytes", async () => {
  const token = "unit-test-bot-token-never-write-this";
  const dataDirectory = await fixture();
  const bridge = await startDiscordBridge({ token, dataDirectory, fetchImpl: fakeDiscordFetch(token), apiBase: "https://discord.test/api/v10" });
  try {
    const status = await callBridge("/v1/status", {}, dataDirectory);
    assert.equal(status.application.id, APPLICATION_ID);
    assert.equal(status.guild.id, SERVER_ID);
    assert.deepEqual(status.capabilities, {
      readActiveChannels: true,
      postMessages: true,
      addReactions: true,
      gatewayEvents: false,
      automaticHeartbeatBatching: true,
    });

    const peeked = await peekBridgeChannel({ channelId: ACTIVE_CHANNEL_ID, limit: 1, includeMedia: true }, dataDirectory);
    assert.equal(peeked.messages[0].content, "hello from Discord https://example.com");
    assert.equal(peeked.messages[0].embeds[0].title, "Example");
    assert.equal(peeked.media.length, 1);
    assert.equal(peeked.media[0].mimeType, "image/png");
    assert.equal(Buffer.from(peeked.media[0].data, "base64").byteLength, 4);

    const sessionText = await readFile(path.join(dataDirectory, "bridge-session.json"), "utf8");
    const settingsText = await readFile(path.join(dataDirectory, "settings.json"), "utf8");
    assert.equal(sessionText.includes(token), false);
    assert.equal(settingsText.includes(token), false);
    assert.ok((await readBridgeSession(dataDirectory)).sessionKey.length >= 32);
  } finally {
    await bridge.close();
  }
});

test("bridge refuses a manual peek that would bypass Lurk", async () => {
  const token = "another-unit-test-token";
  const dataDirectory = await fixture();
  const bridge = await startDiscordBridge({ token, dataDirectory, fetchImpl: fakeDiscordFetch(token), apiBase: "https://discord.test/api/v10" });
  try {
    await assert.rejects(peekBridgeChannel({ channelId: LURK_CHANNEL_ID }, dataDirectory), /bypass that visibility boundary/);
  } finally {
    await bridge.close();
  }
});

test("bridge rejects callers without its local session key", async () => {
  const token = "third-unit-test-token";
  const dataDirectory = await fixture();
  const bridge = await startDiscordBridge({ token, dataDirectory, fetchImpl: fakeDiscordFetch(token), apiBase: "https://discord.test/api/v10" });
  try {
    const session = await readBridgeSession(dataDirectory);
    const response = await fetch(`${session.baseUrl}/v1/status`, { headers: { authorization: "Bearer wrong" } });
    assert.equal(response.status, 401);
  } finally {
    await bridge.close();
  }
});

test("bridge refuses a token belonging to a different application", async () => {
  const token = "wrong-application-unit-test-token";
  const dataDirectory = await fixture();
  await assert.rejects(
    startDiscordBridge({ token, dataDirectory, fetchImpl: fakeDiscordFetch(token, "1536397773417742999"), apiBase: "https://discord.test/api/v10" }),
    /token belongs to application/,
  );
});

test("posting suppresses mass mentions, allows only explicit user pings, and uses an enforced nonce", async () => {
  const token = "posting-unit-test-token";
  const writes = { posts: [], reactions: [] };
  const dataDirectory = await fixture();
  const bridge = await startDiscordBridge({ token, dataDirectory, fetchImpl: fakeDiscordFetch(token, APPLICATION_ID, writes), apiBase: "https://discord.test/api/v10" });
  try {
    const posted = await postBridgeMessage({
      channelId: ACTIVE_CHANNEL_ID,
      content: `hi @everyone <@${HUMAN_ID}>`,
      mentionUserIds: [HUMAN_ID],
      replyToMessageId: MESSAGE_ID,
    }, dataDirectory);
    assert.equal(posted.message.content, `hi @everyone <@${HUMAN_ID}>`);
    assert.equal(posted.massMentionsEnabled, false);
    assert.deepEqual(writes.posts[0].allowed_mentions, { users: [HUMAN_ID], replied_user: false });
    assert.equal(writes.posts[0].enforce_nonce, true);
    assert.match(writes.posts[0].nonce, /^[A-Za-z0-9_-]{8,25}$/);
    assert.equal(writes.posts[0].message_reference.message_id, MESSAGE_ID);
  } finally {
    await bridge.close();
  }
});

test("reactions use the idempotent Discord route with URL-encoded emoji", async () => {
  const token = "reaction-unit-test-token";
  const writes = { posts: [], reactions: [] };
  const dataDirectory = await fixture();
  const bridge = await startDiscordBridge({ token, dataDirectory, fetchImpl: fakeDiscordFetch(token, APPLICATION_ID, writes), apiBase: "https://discord.test/api/v10" });
  try {
    const reacted = await reactBridgeMessage({ channelId: ACTIVE_CHANNEL_ID, messageId: MESSAGE_ID, emoji: "🧡" }, dataDirectory);
    assert.equal(reacted.reacted, true);
    assert.equal(reacted.emoji, "🧡");
    assert.match(writes.reactions[0], /%F0%9F%A7%A1\/\@me$/i);
  } finally {
    await bridge.close();
  }
});

test("speaking and reaction permissions are independently enforced", async () => {
  const token = "permission-unit-test-token";
  const writes = { posts: [], reactions: [] };
  const dataDirectory = await fixture();
  await setChannelPolicy({ channelId: ACTIVE_CHANNEL_ID, mode: "active", canSpeak: false, canReact: true }, dataDirectory);
  const bridge = await startDiscordBridge({ token, dataDirectory, fetchImpl: fakeDiscordFetch(token, APPLICATION_ID, writes), apiBase: "https://discord.test/api/v10" });
  try {
    await assert.rejects(postBridgeMessage({ channelId: ACTIVE_CHANNEL_ID, content: "should not post" }, dataDirectory), /Speaking is disabled/);
    await reactBridgeMessage({ channelId: ACTIVE_CHANNEL_ID, messageId: MESSAGE_ID, emoji: "🧡" }, dataDirectory);

    await setChannelPolicy({ channelId: ACTIVE_CHANNEL_ID, mode: "active", canSpeak: true, canReact: false }, dataDirectory);
    await postBridgeMessage({ channelId: ACTIVE_CHANNEL_ID, content: "allowed post" }, dataDirectory);
    await assert.rejects(reactBridgeMessage({ channelId: ACTIVE_CHANNEL_ID, messageId: MESSAGE_ID, emoji: "🧡" }, dataDirectory), /Reactions are disabled/);
    assert.equal(writes.posts.length, 1);
    assert.equal(writes.reactions.length, 1);
  } finally {
    await bridge.close();
  }
});
