import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BudgetGovernor } from "../src/budget-governor.mjs";

test("ordinary traffic cannot consume direct-ping reserve", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ccl-budget-"));
  try {
    const now = new Date("2026-08-10T16:00:00.000Z");
    const governor = new BudgetGovernor({
      dataDirectory: directory,
      clock: () => now,
      config: {
        timeZone: "UTC",
        maximumTurnsPerHour: 10,
        maximumTurnsPerDay: 4,
        reservedDirectPingTurnsPerDay: 2,
        minimumCooldownSeconds: 0,
        directPingCooldownSeconds: 0,
        quietHours: null,
      },
    });
    assert.equal((await governor.claim()).granted, true);
    assert.equal((await governor.claim()).granted, true);
    const reserveDecision = await governor.claim();
    assert.equal(reserveDecision.granted, false);
    assert.equal(reserveDecision.reason, "direct-ping-reserve");
    assert.equal((await governor.claim({ directPing: true })).granted, true);
    assert.equal((await governor.claim({ directPing: true })).granted, true);
    const capDecision = await governor.claim({ directPing: true });
    assert.equal(capDecision.granted, false);
    assert.equal(capDecision.reason, "daily-cap");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("budget ledger persists across governor instances", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ccl-budget-"));
  try {
    const now = new Date("2026-08-10T16:00:00.000Z");
    const config = { timeZone: "UTC", maximumTurnsPerHour: 1, maximumTurnsPerDay: 5, reservedDirectPingTurnsPerDay: 0, minimumCooldownSeconds: 0, quietHours: null };
    assert.equal((await new BudgetGovernor({ dataDirectory: directory, config, clock: () => now }).claim()).granted, true);
    const decision = await new BudgetGovernor({ dataDirectory: directory, config, clock: () => now }).claim();
    assert.equal(decision.granted, false);
    assert.equal(decision.reason, "hourly-cap");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("quiet hours preserve an explicit direct-ping exception", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ccl-budget-"));
  try {
    const governor = new BudgetGovernor({
      dataDirectory: directory,
      clock: () => new Date("2026-08-10T05:30:00.000Z"),
      config: { timeZone: "UTC", quietHours: { start: "01:00", end: "08:00", allowDirectPings: true }, minimumCooldownSeconds: 0, directPingCooldownSeconds: 0 },
    });
    assert.equal((await governor.claim()).reason, "quiet-hours");
    assert.equal((await governor.claim({ directPing: true })).granted, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("direct pings do not consume the ordinary daily allocation", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "companion-budget-mixed-"));
  let now = new Date("2026-08-10T12:00:00.000Z");
  const governor = new BudgetGovernor({
    dataDirectory,
    clock: () => now,
    config: { timeZone: "UTC", maximumTurnsPerHour: 10, maximumTurnsPerDay: 4, reservedDirectPingTurnsPerDay: 2, minimumCooldownSeconds: 0, directPingCooldownSeconds: 0, quietHours: null },
  });
  try {
    assert.equal((await governor.claim({ directPing: true })).granted, true);
    now = new Date(now.getTime() + 1_000);
    assert.equal((await governor.claim({ directPing: false })).granted, true);
    now = new Date(now.getTime() + 1_000);
    assert.equal((await governor.claim({ directPing: false })).granted, true);
    now = new Date(now.getTime() + 1_000);
    assert.equal((await governor.claim({ directPing: false })).reason, "direct-ping-reserve");
    assert.equal((await governor.claim({ directPing: true })).granted, true);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
