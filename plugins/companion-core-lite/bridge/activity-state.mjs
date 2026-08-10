import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const STATE_FILE = "activity-state.json";

function defaults() {
  return {
    version: 1,
    revision: 0,
    channels: {},
    pendingBatch: null,
    lastAcknowledgedBatchId: null,
    updatedAt: null,
  };
}

function normalizeChannel(candidate) {
  return {
    lastSeenMessageId: typeof candidate?.lastSeenMessageId === "string" ? candidate.lastSeenMessageId : null,
    initializedAt: typeof candidate?.initializedAt === "string" ? candidate.initializedAt : null,
    updatedAt: typeof candidate?.updatedAt === "string" ? candidate.updatedAt : null,
    lurkBuffer: Array.isArray(candidate?.lurkBuffer) ? candidate.lurkBuffer.slice(-100) : [],
  };
}

function normalize(candidate) {
  const state = defaults();
  if (!candidate || typeof candidate !== "object") return state;
  if (Number.isInteger(candidate.revision) && candidate.revision >= 0) state.revision = candidate.revision;
  if (candidate.channels && typeof candidate.channels === "object" && !Array.isArray(candidate.channels)) {
    state.channels = Object.fromEntries(Object.entries(candidate.channels).map(([id, channel]) => [id, normalizeChannel(channel)]));
  }
  if (candidate.pendingBatch && typeof candidate.pendingBatch === "object" && typeof candidate.pendingBatch.batchId === "string") {
    state.pendingBatch = candidate.pendingBatch;
  }
  state.lastAcknowledgedBatchId = typeof candidate.lastAcknowledgedBatchId === "string" ? candidate.lastAcknowledgedBatchId : null;
  state.updatedAt = typeof candidate.updatedAt === "string" ? candidate.updatedAt : null;
  return state;
}

export async function loadActivityState(dataDirectory) {
  const statePath = path.join(dataDirectory, STATE_FILE);
  try {
    return normalize(JSON.parse(await readFile(statePath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return defaults();
    if (error instanceof SyntaxError) throw new Error(`Invalid activity state JSON at ${statePath}`, { cause: error });
    throw error;
  }
}

export async function saveActivityState(state, dataDirectory) {
  await mkdir(dataDirectory, { recursive: true });
  const statePath = path.join(dataDirectory, STATE_FILE);
  const temporaryPath = path.join(dataDirectory, `activity-state.${process.pid}.${Date.now()}.tmp`);
  const next = {
    ...state,
    revision: state.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, statePath);
  return next;
}

export function activityStateSummary(state, configuredChannelIds = []) {
  return {
    revision: state.revision,
    initializedChannelIds: configuredChannelIds.filter((id) => Boolean(state.channels[id]?.initializedAt)),
    uninitializedChannelIds: configuredChannelIds.filter((id) => !state.channels[id]?.initializedAt),
    pendingBatchId: state.pendingBatch?.batchId ?? null,
    pendingMessageCount: state.pendingBatch?.messageCount ?? 0,
    lastAcknowledgedBatchId: state.lastAcknowledgedBatchId,
    updatedAt: state.updatedAt,
  };
}
