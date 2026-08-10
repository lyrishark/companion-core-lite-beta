import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const LEDGER_FILE = "sdk-budget-ledger.json";

export const DEFAULT_BUDGET = Object.freeze({
  timeZone: "America/New_York",
  maximumTurnsPerHour: 6,
  maximumTurnsPerDay: 24,
  reservedDirectPingTurnsPerDay: 6,
  minimumCooldownSeconds: 120,
  directPingCooldownSeconds: 30,
  quietHours: Object.freeze({ start: "01:00", end: "08:00", allowDirectPings: true }),
});

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function validClock(value, fallback) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

function validTimeZone(value) {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_BUDGET.timeZone;
  const candidate = value.trim();
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    throw new Error(`Invalid budget time zone: ${candidate}`);
  }
}

export function normalizeBudgetConfig(candidate = {}) {
  const maximumTurnsPerDay = boundedInteger(candidate.maximumTurnsPerDay, DEFAULT_BUDGET.maximumTurnsPerDay, 1, 10_000);
  return {
    timeZone: validTimeZone(candidate.timeZone),
    maximumTurnsPerHour: boundedInteger(candidate.maximumTurnsPerHour, DEFAULT_BUDGET.maximumTurnsPerHour, 1, maximumTurnsPerDay),
    maximumTurnsPerDay,
    reservedDirectPingTurnsPerDay: boundedInteger(
      candidate.reservedDirectPingTurnsPerDay,
      DEFAULT_BUDGET.reservedDirectPingTurnsPerDay,
      0,
      maximumTurnsPerDay,
    ),
    minimumCooldownSeconds: boundedInteger(candidate.minimumCooldownSeconds, DEFAULT_BUDGET.minimumCooldownSeconds, 0, 86_400),
    directPingCooldownSeconds: boundedInteger(candidate.directPingCooldownSeconds, DEFAULT_BUDGET.directPingCooldownSeconds, 0, 86_400),
    quietHours: candidate.quietHours === null ? null : {
      start: validClock(candidate.quietHours?.start, DEFAULT_BUDGET.quietHours.start),
      end: validClock(candidate.quietHours?.end, DEFAULT_BUDGET.quietHours.end),
      allowDirectPings: candidate.quietHours?.allowDirectPings !== false,
    },
  };
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return {
    dateKey: `${value("year")}-${value("month")}-${value("day")}`,
    clockMinutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function clockMinutes(clock) {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}

function inQuietHours(date, config) {
  if (!config.quietHours) return false;
  const now = zonedParts(date, config.timeZone).clockMinutes;
  const start = clockMinutes(config.quietHours.start);
  const end = clockMinutes(config.quietHours.end);
  if (start === end) return true;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

function normalizeLedger(candidate) {
  return {
    version: 1,
    revision: Number.isInteger(candidate?.revision) && candidate.revision >= 0 ? candidate.revision : 0,
    turns: Array.isArray(candidate?.turns)
      ? candidate.turns.filter((turn) => typeof turn?.at === "string" && !Number.isNaN(Date.parse(turn.at))).map((turn) => ({
        at: new Date(turn.at).toISOString(),
        directPing: Boolean(turn.directPing),
        messageCount: boundedInteger(turn.messageCount, 1, 1, 10_000),
      }))
      : [],
    updatedAt: typeof candidate?.updatedAt === "string" ? candidate.updatedAt : null,
  };
}

async function loadLedger(dataDirectory) {
  try {
    return normalizeLedger(JSON.parse(await readFile(path.join(dataDirectory, LEDGER_FILE), "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return normalizeLedger(null);
    if (error instanceof SyntaxError) throw new Error("The SDK budget ledger is invalid JSON.", { cause: error });
    throw error;
  }
}

async function saveLedger(dataDirectory, ledger) {
  await mkdir(dataDirectory, { recursive: true });
  const target = path.join(dataDirectory, LEDGER_FILE);
  const temporary = path.join(dataDirectory, `sdk-budget-ledger.${process.pid}.${Date.now()}.tmp`);
  const next = { ...ledger, revision: ledger.revision + 1, updatedAt: new Date().toISOString() };
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
  return next;
}

export class BudgetGovernor {
  constructor({ dataDirectory, config = {}, clock = () => new Date() }) {
    if (!dataDirectory) throw new Error("BudgetGovernor requires a data directory.");
    this.dataDirectory = dataDirectory;
    this.config = normalizeBudgetConfig(config);
    this.clock = clock;
    this.queue = Promise.resolve();
  }

  claim({ directPing = false, messageCount = 1 } = {}) {
    const operation = this.queue.then(() => this.#claim({ directPing, messageCount }));
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async #claim({ directPing, messageCount }) {
    const now = this.clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("Budget clock returned an invalid date.");
    const config = this.config;
    let ledger = await loadLedger(this.dataDirectory);
    const cutoff = now.getTime() - 48 * 60 * 60 * 1000;
    ledger.turns = ledger.turns.filter((turn) => Date.parse(turn.at) >= cutoff);

    const dayKey = zonedParts(now, config.timeZone).dateKey;
    const dayTurns = ledger.turns.filter((turn) => zonedParts(new Date(turn.at), config.timeZone).dateKey === dayKey);
    const ordinaryDayTurns = dayTurns.filter((turn) => !turn.directPing);
    const hourTurns = ledger.turns.filter((turn) => now.getTime() - Date.parse(turn.at) < 60 * 60 * 1000);
    const ordinaryCeiling = Math.max(0, config.maximumTurnsPerDay - config.reservedDirectPingTurnsPerDay);
    let reason = null;

    if (inQuietHours(now, config) && !(directPing && config.quietHours?.allowDirectPings)) reason = "quiet-hours";
    else if (dayTurns.length >= config.maximumTurnsPerDay) reason = "daily-cap";
    else if (!directPing && ordinaryDayTurns.length >= ordinaryCeiling) reason = "direct-ping-reserve";
    else if (hourTurns.length >= config.maximumTurnsPerHour) reason = "hourly-cap";
    else {
      const latest = ledger.turns.at(-1);
      const cooldownMs = (directPing ? config.directPingCooldownSeconds : config.minimumCooldownSeconds) * 1000;
      if (latest && now.getTime() - Date.parse(latest.at) < cooldownMs) reason = "cooldown";
    }

    if (reason) {
      return {
        granted: false,
        reason,
        directPing,
        usage: { hour: hourTurns.length, day: dayTurns.length, ordinaryCeiling },
        limits: config,
      };
    }

    ledger.turns.push({ at: now.toISOString(), directPing: Boolean(directPing), messageCount: boundedInteger(messageCount, 1, 1, 10_000) });
    ledger = await saveLedger(this.dataDirectory, ledger);
    return {
      granted: true,
      reason: null,
      directPing,
      usage: { hour: hourTurns.length + 1, day: dayTurns.length + 1, ordinaryCeiling },
      limits: config,
      ledgerRevision: ledger.revision,
    };
  }
}
