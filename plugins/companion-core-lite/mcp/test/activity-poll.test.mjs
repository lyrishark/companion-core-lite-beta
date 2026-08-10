import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadActivityState } from "../../bridge/activity-state.mjs";
import { startDiscordBridge } from "../../bridge/discord-bridge.mjs";
import { acknowledgeBridgeActivity, pollBridgeActivity } from "../lib/bridge-client.mjs";
import { setChannelPolicy, setDiscordConnection } from "../lib/settings.mjs";

const APPLICATION_ID = "100000000000000001";
const SERVER_ID = "100000000000000002";
const BOT_ID = "100000000000000003";
const HUMAN_ID = "100000000000000004";
const ACTIVE_ID = "100000000000000005";
const LURK_ID = "100000000000000006";
const STRICT_ID = "100000000000000007";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function discordSimulator(token) {
  let nextId = 100000000000000100n;
  const messages = new Map([[ACTIVE_ID, []], [LURK_ID, []], [STRICT_ID, []]]);
  const channels = new Map([
    [ACTIVE_ID, { id: ACTIVE_ID, guild_id: SERVER_ID, name: "active", type: 0 }],
    [LURK_ID, { id: LURK_ID, guild_id: SERVER_ID, name: "lurk", type: 0 }],
    [STRICT_ID, { id: STRICT_ID, guild_id: SERVER_ID, name: "strict", type: 0 }],
  ]);
  return {
    add(channelId, { content, authorId = HUMAN_ID, mentions = [] }) {
      const message = {
        id: String(nextId++),
        timestamp: new Date(Number(nextId % 1_000_000n)).toISOString(),
        author: { id: authorId, username: authorId === BOT_ID ? "Example Companion" : "Human", bot: authorId === BOT_ID },
        content,
        mentions: mentions.map((id) => ({ id })),
        attachments: [],
        embeds: [],
      };
      messages.get(channelId).push(message);
      return message;
    },
    async fetch(input, init = {}) {
      const url = new URL(String(input));
      assert.equal(init.headers.authorization, `Bot ${token}`);
      if (url.pathname.endsWith("/users/@me")) return json({ id: BOT_ID, username: "Example Companion", bot: true });
      if (url.pathname.endsWith("/oauth2/applications/@me")) return json({ id: APPLICATION_ID, name: "Example Companion Bot" });
      if (url.pathname.endsWith(`/guilds/${SERVER_ID}`)) return json({ id: SERVER_ID, name: "Test Hearth" });
      const channelMatch = url.pathname.match(/\/channels\/(\d+)(?:\/messages)?$/);
      if (channelMatch && !url.pathname.endsWith("/messages")) return json(channels.get(channelMatch[1]));
      if (channelMatch && url.pathname.endsWith("/messages")) {
        const after = url.searchParams.get("after");
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const selected = messages.get(channelMatch[1])
          .filter((message) => !after || BigInt(message.id) > BigInt(after))
          .sort((left, right) => BigInt(left.id) > BigInt(right.id) ? -1 : 1)
          .slice(0, limit);
        return json(selected);
      }
      throw new Error(`Unexpected simulated Discord request: ${url}`);
    },
  };
}

async function fixture() {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "companion-core-lite-activity-test-"));
  await setDiscordConnection({ applicationId: APPLICATION_ID, serverId: SERVER_ID }, dataDirectory);
  await setChannelPolicy({ channelId: ACTIVE_ID, label: "active", mode: "active" }, dataDirectory);
  await setChannelPolicy({ channelId: LURK_ID, label: "lurk", mode: "lurk", lurkBufferMessages: 3 }, dataDirectory);
  await setChannelPolicy({ channelId: STRICT_ID, label: "strict", mode: "strict" }, dataDirectory);
  return dataDirectory;
}

test("poll baselines without history, replays pending batches, and advances only after acknowledgment", async () => {
  const token = "activity-active-test-token";
  const simulator = discordSimulator(token);
  const dataDirectory = await fixture();
  simulator.add(ACTIVE_ID, { content: "old active history" });
  simulator.add(LURK_ID, { content: "old lurk history", mentions: [BOT_ID] });
  simulator.add(STRICT_ID, { content: "old strict history", mentions: [BOT_ID] });
  const bridge = await startDiscordBridge({ token, dataDirectory, fetchImpl: simulator.fetch, apiBase: "https://discord.test/api/v10" });
  try {
    const baseline = await pollBridgeActivity({}, dataDirectory);
    assert.equal(baseline.quiet, true);
    assert.equal(baseline.batch, null);
    assert.deepEqual(new Set(baseline.initializedChannelIds), new Set([ACTIVE_ID, LURK_ID, STRICT_ID]));

    const first = simulator.add(ACTIVE_ID, { content: "first new human message" });
    simulator.add(ACTIVE_ID, { content: "the companion's own post", authorId: BOT_ID });
    const second = simulator.add(ACTIVE_ID, { content: "second new human message" });
    const delivery = await pollBridgeActivity({}, dataDirectory);
    assert.equal(delivery.batch.messageCount, 2);
    assert.deepEqual(delivery.batch.channels[0].messages.map((message) => message.id), [first.id, second.id]);
    assert.equal(delivery.acknowledgmentRequired, true);

    const later = simulator.add(ACTIVE_ID, { content: "wait behind the pending batch" });
    const replay = await pollBridgeActivity({}, dataDirectory);
    assert.equal(replay.replayed, true);
    assert.equal(replay.batch.batchId, delivery.batch.batchId);
    assert.equal(replay.batch.messageCount, 2);
    await assert.rejects(acknowledgeBridgeActivity({ batchId: "00000000-0000-4000-8000-000000000000" }, dataDirectory), /Pending Discord activity batch/);

    const acknowledged = await acknowledgeBridgeActivity({ batchId: delivery.batch.batchId }, dataDirectory);
    assert.equal(acknowledged.acknowledged, true);
    assert.equal((await acknowledgeBridgeActivity({ batchId: delivery.batch.batchId }, dataDirectory)).alreadyAcknowledged, true);

    const next = await pollBridgeActivity({}, dataDirectory);
    assert.deepEqual(next.batch.channels[0].messages.map((message) => message.id), [later.id]);
    await acknowledgeBridgeActivity({ batchId: next.batch.batchId }, dataDirectory);
    assert.equal((await pollBridgeActivity({}, dataDirectory)).quiet, true);
  } finally {
    await bridge.close();
  }
});

test("Lurk releases bounded context on ping while Strict delivers only pinging messages", async () => {
  const token = "activity-modes-test-token";
  const simulator = discordSimulator(token);
  const dataDirectory = await fixture();
  const bridge = await startDiscordBridge({ token, dataDirectory, fetchImpl: simulator.fetch, apiBase: "https://discord.test/api/v10" });
  try {
    await pollBridgeActivity({}, dataDirectory);
    const lurkOne = simulator.add(LURK_ID, { content: "lurk context one" });
    const lurkTwo = simulator.add(LURK_ID, { content: "lurk context two" });
    simulator.add(STRICT_ID, { content: "strict noise" });
    const quiet = await pollBridgeActivity({}, dataDirectory);
    assert.equal(quiet.quiet, true);
    assert.deepEqual((await loadActivityState(dataDirectory)).channels[LURK_ID].lurkBuffer.map((message) => message.id), [lurkOne.id, lurkTwo.id]);

    const lurkPing = simulator.add(LURK_ID, { content: "hey Example Companion", mentions: [BOT_ID] });
    const strictPing = simulator.add(STRICT_ID, { content: "strict ping only", mentions: [BOT_ID] });
    const delivery = await pollBridgeActivity({}, dataDirectory);
    const lurk = delivery.batch.channels.find((channel) => channel.channel.id === LURK_ID);
    const strict = delivery.batch.channels.find((channel) => channel.channel.id === STRICT_ID);
    assert.deepEqual(lurk.messages.map((message) => message.id), [lurkOne.id, lurkTwo.id, lurkPing.id]);
    assert.deepEqual(strict.messages.map((message) => message.id), [strictPing.id]);
    assert.equal((await loadActivityState(dataDirectory)).channels[LURK_ID].lurkBuffer.length, 0);

    await acknowledgeBridgeActivity({ batchId: delivery.batch.batchId }, dataDirectory);
    simulator.add(LURK_ID, { content: "new context without a ping" });
    assert.equal((await pollBridgeActivity({}, dataDirectory)).quiet, true);
    assert.equal((await loadActivityState(dataDirectory)).channels[LURK_ID].lurkBuffer.length, 1);
  } finally {
    await bridge.close();
  }
});

test("bounded Active batches leave later messages for the next acknowledged poll", async () => {
  const token = "activity-backlog-test-token";
  const simulator = discordSimulator(token);
  const dataDirectory = await fixture();
  const bridge = await startDiscordBridge({ token, dataDirectory, fetchImpl: simulator.fetch, apiBase: "https://discord.test/api/v10" });
  try {
    await pollBridgeActivity({}, dataDirectory);
    const one = simulator.add(ACTIVE_ID, { content: "one" });
    const two = simulator.add(ACTIVE_ID, { content: "two" });
    const three = simulator.add(ACTIVE_ID, { content: "three" });
    const first = await pollBridgeActivity({ limitPerChannel: 2 }, dataDirectory);
    assert.deepEqual(first.batch.channels[0].messages.map((message) => message.id), [one.id, two.id]);
    assert.equal(first.batch.channels[0].backlogPossible, true);
    await acknowledgeBridgeActivity({ batchId: first.batch.batchId }, dataDirectory);
    const second = await pollBridgeActivity({ limitPerChannel: 2 }, dataDirectory);
    assert.deepEqual(second.batch.channels[0].messages.map((message) => message.id), [three.id]);
    assert.equal(second.batch.channels[0].backlogPossible, false);
  } finally {
    await bridge.close();
  }
});

test("narrowing a channel mode invalidates its broader pending delivery", async () => {
  const token = "activity-policy-change-test-token";
  const simulator = discordSimulator(token);
  const dataDirectory = await fixture();
  const bridge = await startDiscordBridge({ token, dataDirectory, fetchImpl: simulator.fetch, apiBase: "https://discord.test/api/v10" });
  try {
    await pollBridgeActivity({}, dataDirectory);
    simulator.add(ACTIVE_ID, { content: "visible under Active but not Strict" });
    const activeBatch = await pollBridgeActivity({}, dataDirectory);
    assert.equal(activeBatch.batch.messageCount, 1);

    await setChannelPolicy({ channelId: ACTIVE_ID, label: "active-now-strict", mode: "strict" }, dataDirectory);
    const afterNarrowing = await pollBridgeActivity({}, dataDirectory);
    assert.equal(afterNarrowing.quiet, true);
    assert.deepEqual(afterNarrowing.policyInvalidatedChannelIds, [ACTIVE_ID]);
    await assert.rejects(acknowledgeBridgeActivity({ batchId: activeBatch.batch.batchId }, dataDirectory), /no pending Discord activity batch/);
  } finally {
    await bridge.close();
  }
});
