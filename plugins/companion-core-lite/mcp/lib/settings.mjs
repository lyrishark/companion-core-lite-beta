import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const HEARTBEAT_PRESETS = Object.freeze({
  off: Object.freeze({ label: "Off", intervalMinutes: null, scheduleKind: "off", description: "No automatic Discord checks." }),
  frugal: Object.freeze({ label: "Frugal", intervalMinutes: 30, scheduleKind: "recurring", description: "A gentle always-on default for usage-sensitive plans." }),
  balanced: Object.freeze({ label: "Balanced", intervalMinutes: 10, scheduleKind: "recurring", description: "More present without checking constantly." }),
  present: Object.freeze({ label: "Present", intervalMinutes: 5, scheduleKind: "recurring", description: "Frequent always-on checks for active communities." }),
  "social-session": Object.freeze({
    label: "Social Session",
    intervalMinutes: 5,
    scheduleKind: "bounded-session",
    durationMinutes: 240,
    maximumScheduledChecks: 48,
    description: "Five-minute presence for four hours, then the task stops.",
  }),
  "very-present": Object.freeze({ label: "Very Present", intervalMinutes: 2, scheduleKind: "recurring", description: "High-frequency always-on presence for inference-rich accounts." }),
  custom: Object.freeze({ label: "Custom", intervalMinutes: null, scheduleKind: "recurring", description: "Choose an always-on interval from 1 to 1,440 minutes." }),
});

const DEFAULT_SETTINGS = Object.freeze({
  version: 2,
  revision: 0,
  heartbeat: Object.freeze({
    preset: "frugal",
    enabled: true,
    intervalMinutes: 30,
    schedulerSync: "required",
    scheduleReference: null,
    updatedAt: null,
  }),
  discord: Object.freeze({
    applicationId: null,
    serverId: null,
    updatedAt: null,
  }),
  channels: Object.freeze({}),
});

export function getDataDirectory() {
  return process.env.COMPANION_CORE_LITE_DATA_DIR?.trim()
    ? path.resolve(process.env.COMPANION_CORE_LITE_DATA_DIR)
    : path.join(os.homedir(), ".companion-core-lite");
}

export function checksPerDay(intervalMinutes) {
  if (intervalMinutes == null) return 0;
  return Number((1440 / intervalMinutes).toFixed(1));
}

export function maximumChecksPerDay(intervalMinutes) {
  if (intervalMinutes == null) return 0;
  return Math.ceil(1440 / intervalMinutes);
}

function heartbeatMetrics(presetId, intervalMinutes) {
  const preset = HEARTBEAT_PRESETS[presetId];
  const bounded = preset.scheduleKind === "bounded-session";
  return {
    scheduleKind: preset.scheduleKind,
    durationMinutes: preset.durationMinutes ?? null,
    checksPerDay: checksPerDay(intervalMinutes),
    maximumChecksPerDay: bounded ? preset.maximumScheduledChecks : maximumChecksPerDay(intervalMinutes),
    maximumScheduledChecks: bounded ? preset.maximumScheduledChecks : maximumChecksPerDay(intervalMinutes),
    maximumScheduledChecksPeriod: bounded ? "session" : "day",
  };
}

export function listHeartbeatPresets() {
  return Object.entries(HEARTBEAT_PRESETS).map(([id, preset]) => ({
    id,
    ...preset,
    ...heartbeatMetrics(id, preset.intervalMinutes),
  }));
}

function cloneDefaults() {
  return {
    version: DEFAULT_SETTINGS.version,
    revision: DEFAULT_SETTINGS.revision,
    heartbeat: { ...DEFAULT_SETTINGS.heartbeat },
    discord: { ...DEFAULT_SETTINGS.discord },
    channels: {},
  };
}

function normalizeSettings(candidate) {
  const normalized = cloneDefaults();
  if (!candidate || typeof candidate !== "object") return normalized;
  if (Number.isInteger(candidate.revision) && candidate.revision >= 0) normalized.revision = candidate.revision;

  const heartbeat = candidate.heartbeat;
  if (heartbeat && typeof heartbeat === "object") {
    const preset = Object.hasOwn(HEARTBEAT_PRESETS, heartbeat.preset) ? heartbeat.preset : "frugal";
    const requestedInterval = Number(heartbeat.intervalMinutes);
    const intervalMinutes = preset === "off"
      ? null
      : preset === "custom" && Number.isInteger(requestedInterval) && requestedInterval >= 1 && requestedInterval <= 1440
        ? requestedInterval
        : HEARTBEAT_PRESETS[preset].intervalMinutes ?? DEFAULT_SETTINGS.heartbeat.intervalMinutes;
    normalized.heartbeat = {
      preset,
      enabled: preset !== "off",
      intervalMinutes,
      schedulerSync: heartbeat.schedulerSync === "confirmed" ? "confirmed" : "required",
      scheduleReference: typeof heartbeat.scheduleReference === "string" && heartbeat.scheduleReference.trim()
        ? heartbeat.scheduleReference.trim()
        : null,
      updatedAt: typeof heartbeat.updatedAt === "string" ? heartbeat.updatedAt : null,
    };
  }

  const discord = candidate.discord;
  if (discord && typeof discord === "object") {
    normalized.discord = {
      applicationId: isDiscordSnowflake(discord.applicationId) ? discord.applicationId.trim() : null,
      serverId: isDiscordSnowflake(discord.serverId) ? discord.serverId.trim() : null,
      updatedAt: typeof discord.updatedAt === "string" ? discord.updatedAt : null,
    };
  }

  if (candidate.channels && typeof candidate.channels === "object" && !Array.isArray(candidate.channels)) {
    normalized.channels = { ...candidate.channels };
  }
  return normalized;
}

export function isDiscordSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value.trim());
}

export async function loadSettings(dataDirectory = getDataDirectory()) {
  const settingsPath = path.join(dataDirectory, "settings.json");
  try {
    const raw = await readFile(settingsPath, "utf8");
    return normalizeSettings(JSON.parse(raw));
  } catch (error) {
    if (error?.code === "ENOENT") return cloneDefaults();
    if (error instanceof SyntaxError) throw new Error(`Invalid settings JSON at ${settingsPath}`, { cause: error });
    throw error;
  }
}

async function saveSettings(settings, dataDirectory = getDataDirectory()) {
  await mkdir(dataDirectory, { recursive: true });
  const settingsPath = path.join(dataDirectory, "settings.json");
  const temporaryPath = path.join(dataDirectory, `settings.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await rename(temporaryPath, settingsPath);
  return settings;
}

export function heartbeatView(settings) {
  const heartbeat = settings.heartbeat;
  const metrics = heartbeatMetrics(heartbeat.preset, heartbeat.intervalMinutes);
  return {
    ...heartbeat,
    label: HEARTBEAT_PRESETS[heartbeat.preset].label,
    ...metrics,
    usageNotice: "Each scheduled heartbeat may consume ChatGPT Work usage, even when Discord is quiet.",
    schedulerSyncRequired: heartbeat.schedulerSync !== "confirmed",
  };
}

export async function setHeartbeat({ preset, customMinutes }, dataDirectory = getDataDirectory()) {
  if (!Object.hasOwn(HEARTBEAT_PRESETS, preset)) {
    throw new Error(`Unknown heartbeat preset: ${preset}`);
  }
  let intervalMinutes = HEARTBEAT_PRESETS[preset].intervalMinutes;
  if (preset === "custom") {
    intervalMinutes = Number(customMinutes);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440) {
      throw new Error("customMinutes must be a whole number from 1 to 1,440.");
    }
  }

  const current = await loadSettings(dataDirectory);
  const normalizedInterval = preset === "off" ? null : intervalMinutes;
  if (current.heartbeat.preset === preset && current.heartbeat.intervalMinutes === normalizedInterval) {
    return current;
  }
  const next = {
    ...current,
    revision: current.revision + 1,
    heartbeat: {
      preset,
      enabled: preset !== "off",
      intervalMinutes: normalizedInterval,
      schedulerSync: "required",
      scheduleReference: null,
      updatedAt: new Date().toISOString(),
    },
  };
  await saveSettings(next, dataDirectory);
  return next;
}

export async function confirmHeartbeatSchedule({ scheduleReference }, dataDirectory = getDataDirectory()) {
  const current = await loadSettings(dataDirectory);
  const normalizedReference = typeof scheduleReference === "string" && scheduleReference.trim()
    ? scheduleReference.trim()
    : "confirmed-by-host";
  if (current.heartbeat.schedulerSync === "confirmed" && current.heartbeat.scheduleReference === normalizedReference) {
    return current;
  }
  const next = {
    ...current,
    revision: current.revision + 1,
    heartbeat: {
      ...current.heartbeat,
      schedulerSync: "confirmed",
      scheduleReference: normalizedReference,
      updatedAt: new Date().toISOString(),
    },
  };
  await saveSettings(next, dataDirectory);
  return next;
}

export async function setChannelPolicy(input, dataDirectory = getDataDirectory()) {
  const channelId = input.channelId?.trim();
  if (!channelId) throw new Error("channelId is required.");
  if (!["active", "lurk", "strict"].includes(input.mode)) throw new Error("mode must be active, lurk, or strict.");

  const current = await loadSettings(dataDirectory);
  const policy = {
    channelId,
    label: typeof input.label === "string" && input.label.trim() ? input.label.trim() : null,
    mode: input.mode,
    canReact: input.canReact !== false,
    canSpeak: input.canSpeak !== false,
    lurkBufferMessages: input.mode === "lurk"
      ? Math.min(100, Math.max(1, Number.isInteger(input.lurkBufferMessages) ? input.lurkBufferMessages : 25))
      : 0,
    updatedAt: new Date().toISOString(),
  };
  const existing = current.channels[channelId];
  if (existing
    && existing.channelId === policy.channelId
    && existing.label === policy.label
    && existing.mode === policy.mode
    && existing.canReact === policy.canReact
    && existing.canSpeak === policy.canSpeak
    && existing.lurkBufferMessages === policy.lurkBufferMessages) {
    return current;
  }
  const next = {
    ...current,
    revision: current.revision + 1,
    channels: { ...current.channels, [channelId]: policy },
  };
  await saveSettings(next, dataDirectory);
  return next;
}

export async function setDiscordConnection(input, dataDirectory = getDataDirectory()) {
  const applicationId = input.applicationId?.trim();
  const serverId = input.serverId?.trim();
  if (!isDiscordSnowflake(applicationId)) throw new Error("applicationId must be a Discord snowflake ID.");
  if (!isDiscordSnowflake(serverId)) throw new Error("serverId must be a Discord snowflake ID.");

  const current = await loadSettings(dataDirectory);
  if (current.discord.applicationId === applicationId && current.discord.serverId === serverId) return current;
  const next = {
    ...current,
    revision: current.revision + 1,
    discord: {
      applicationId,
      serverId,
      updatedAt: new Date().toISOString(),
    },
  };
  await saveSettings(next, dataDirectory);
  return next;
}
