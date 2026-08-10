import assert from "node:assert/strict";
import test from "node:test";
import { PresenceBatcher } from "../src/event-batcher.mjs";

const botId = "100000000000000003";
const serverId = "100000000000000002";
const channelId = "100000000000000005";

function message(id, content, { mention = false, bot = false } = {}) {
  return {
    id,
    channel_id: channelId,
    guild_id: serverId,
    timestamp: "2026-08-10T16:00:00.000Z",
    author: { id: bot ? botId : "100000000000000001", username: "human", bot },
    content,
    mentions: mention ? [{ id: botId }] : [],
    attachments: [],
    embeds: [],
  };
}

function makeBatcher(mode, delivered, extras = {}) {
  return new PresenceBatcher({
    botId,
    coalesceMilliseconds: 60_000,
    maximumBatchMessages: 10,
    settingsProvider: async () => ({ discord: { serverId }, channels: { [channelId]: { mode, canSpeak: true, canReact: true, lurkBufferMessages: 5, ...extras } } }),
    onReady: async (batch) => delivered.push(batch),
  });
}

test("Active queues human messages and ignores bot messages", async () => {
  const delivered = [];
  const batcher = makeBatcher("active", delivered);
  await batcher.ingest(message("100000000000000010", "hello"));
  await batcher.ingest(message("100000000000000011", "bot", { bot: true }));
  const batch = await batcher.flushNow();
  assert.equal(batch.messageCount, 1);
  assert.equal(batch.channels[0].messages[0].content, "hello");
  batcher.close();
});

test("Strict sees only the pinging message", async () => {
  const delivered = [];
  const batcher = makeBatcher("strict", delivered);
  assert.equal((await batcher.ingest(message("100000000000000020", "ordinary"))).accepted, false);
  await batcher.ingest(message("100000000000000021", "ping", { mention: true }));
  const batch = await batcher.flushNow();
  assert.equal(batch.directPing, true);
  assert.deepEqual(batch.channels[0].messages.map((entry) => entry.content), ["ping"]);
  batcher.close();
});

test("Lurk releases bounded context when pinged", async () => {
  const delivered = [];
  const batcher = makeBatcher("lurk", delivered, { lurkBufferMessages: 2 });
  await batcher.ingest(message("100000000000000030", "old"));
  await batcher.ingest(message("100000000000000031", "context"));
  await batcher.ingest(message("100000000000000032", "ping", { mention: true }));
  const batch = await batcher.flushNow();
  assert.deepEqual(batch.channels[0].messages.map((entry) => entry.content), ["context", "ping"]);
  batcher.close();
});
