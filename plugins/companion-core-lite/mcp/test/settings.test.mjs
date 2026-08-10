import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checksPerDay,
  confirmHeartbeatSchedule,
  heartbeatView,
  loadSettings,
  maximumChecksPerDay,
  setChannelPolicy,
  setDiscordConnection,
  setHeartbeat,
} from "../lib/settings.mjs";

async function tempDataDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "companion-core-lite-test-"));
}

test("defaults to a frugal, visibly unsynchronized heartbeat", async () => {
  const directory = await tempDataDirectory();
  const settings = await loadSettings(directory);
  assert.equal(settings.heartbeat.preset, "frugal");
  assert.equal(heartbeatView(settings).checksPerDay, 48);
  assert.equal(heartbeatView(settings).schedulerSyncRequired, true);
});

test("calculates checks per day for fixed and custom intervals", () => {
  assert.equal(checksPerDay(30), 48);
  assert.equal(checksPerDay(10), 144);
  assert.equal(checksPerDay(2), 720);
  assert.equal(checksPerDay(7), 205.7);
  assert.equal(checksPerDay(null), 0);
  assert.equal(maximumChecksPerDay(7), 206);
  assert.equal(maximumChecksPerDay(null), 0);
});

test("social session concentrates presence into a hard-bounded run count", async () => {
  const directory = await tempDataDirectory();
  await setHeartbeat({ preset: "social-session" }, directory);
  const view = heartbeatView(await loadSettings(directory));
  assert.equal(view.intervalMinutes, 5);
  assert.equal(view.scheduleKind, "bounded-session");
  assert.equal(view.durationMinutes, 240);
  assert.equal(view.maximumScheduledChecks, 48);
  assert.equal(view.maximumScheduledChecksPeriod, "session");
});

test("saving a heartbeat requires scheduler synchronization", async () => {
  const directory = await tempDataDirectory();
  await setHeartbeat({ preset: "present" }, directory);
  let settings = await loadSettings(directory);
  assert.equal(settings.heartbeat.intervalMinutes, 5);
  assert.equal(settings.heartbeat.schedulerSync, "required");

  await confirmHeartbeatSchedule({ scheduleReference: "task-123" }, directory);
  settings = await loadSettings(directory);
  assert.equal(settings.heartbeat.schedulerSync, "confirmed");
  assert.equal(settings.heartbeat.scheduleReference, "task-123");
});

test("repeating the same setting is idempotent", async () => {
  const directory = await tempDataDirectory();
  const first = await setHeartbeat({ preset: "present" }, directory);
  const second = await setHeartbeat({ preset: "present" }, directory);
  assert.equal(second.revision, first.revision);
  assert.equal(second.heartbeat.updatedAt, first.heartbeat.updatedAt);
});

test("custom heartbeat validation is bounded", async () => {
  const directory = await tempDataDirectory();
  await assert.rejects(setHeartbeat({ preset: "custom", customMinutes: 0 }, directory), /1 to 1,440/);
  await setHeartbeat({ preset: "custom", customMinutes: 60 }, directory);
  assert.equal((await loadSettings(directory)).heartbeat.intervalMinutes, 60);
});

test("channel modes preserve action permissions separately", async () => {
  const directory = await tempDataDirectory();
  await setChannelPolicy({ channelId: "42", label: "commons", mode: "lurk", canReact: true, canSpeak: false, lurkBufferMessages: 12 }, directory);
  const settings = await loadSettings(directory);
  assert.deepEqual(settings.channels["42"], {
    channelId: "42",
    label: "commons",
    mode: "lurk",
    canReact: true,
    canSpeak: false,
    lurkBufferMessages: 12,
    updatedAt: settings.channels["42"].updatedAt,
  });
  JSON.parse(await readFile(path.join(directory, "settings.json"), "utf8"));
});

test("Discord connection stores IDs but has no token field", async () => {
  const directory = await tempDataDirectory();
  await setDiscordConnection({ applicationId: "100000000000000001", serverId: "100000000000000002" }, directory);
  const settings = await loadSettings(directory);
  assert.deepEqual(settings.discord, {
    applicationId: "100000000000000001",
    serverId: "100000000000000002",
    updatedAt: settings.discord.updatedAt,
  });
  assert.equal(JSON.stringify(settings).includes("token"), false);
});

test("Discord connection rejects malformed IDs", async () => {
  const directory = await tempDataDirectory();
  await assert.rejects(setDiscordConnection({ applicationId: "not-an-id", serverId: "100000000000000002" }, directory), /applicationId/);
});
