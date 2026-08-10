import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { getDataDirectory } from "./settings.mjs";

const REQUEST_TIMEOUT_MS = 10_000;

function sessionPath(dataDirectory = getDataDirectory()) {
  return path.join(dataDirectory, "bridge-session.json");
}

function validateSession(candidate) {
  if (!candidate || typeof candidate !== "object") throw new Error("Discord bridge session is invalid.");
  const url = new URL(candidate.baseUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error("Discord bridge session must use loopback HTTP.");
  }
  if (typeof candidate.sessionKey !== "string" || candidate.sessionKey.length < 32) {
    throw new Error("Discord bridge session key is invalid.");
  }
  return { ...candidate, baseUrl: url.origin };
}

export async function readBridgeSession(dataDirectory = getDataDirectory()) {
  try {
    return validateSession(JSON.parse(await readFile(sessionPath(dataDirectory), "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) throw new Error("Discord bridge session file contains invalid JSON.", { cause: error });
    throw error;
  }
}

export async function callBridge(route, options = {}, dataDirectory = getDataDirectory()) {
  const session = await readBridgeSession(dataDirectory);
  if (!session) throw new Error("Discord bridge is not running. Start it in a local terminal first.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${session.baseUrl}${route}`, {
      method: options.method ?? "GET",
      headers: {
        authorization: `Bearer ${session.sessionKey}`,
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Discord bridge returned HTTP ${response.status}.`);
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Discord bridge did not respond within 10 seconds.", { cause: error });
    if (error?.cause?.code === "ECONNREFUSED") throw new Error("Discord bridge session is stale. Start the bridge again.", { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getBridgeStatus(dataDirectory = getDataDirectory()) {
  try {
    const status = await callBridge("/v1/status", {}, dataDirectory);
    return { transportStatus: "connected", ...status };
  } catch (error) {
    return { transportStatus: "not-connected", error: error?.message ?? String(error) };
  }
}

export async function peekBridgeChannel({ channelId, limit = 10, includeMedia = true }, dataDirectory = getDataDirectory()) {
  return callBridge("/v1/peek", {
    method: "POST",
    body: { channelId, limit, includeMedia },
  }, dataDirectory);
}

function postNonce() {
  return randomBytes(12).toString("base64url");
}

export async function postBridgeMessage({ channelId, content, mentionUserIds = [], replyToMessageId = null }, dataDirectory = getDataDirectory()) {
  return callBridge("/v1/post", {
    method: "POST",
    body: { channelId, content, mentionUserIds, replyToMessageId, nonce: postNonce() },
  }, dataDirectory);
}

export async function reactBridgeMessage({ channelId, messageId, emoji }, dataDirectory = getDataDirectory()) {
  return callBridge("/v1/react", {
    method: "POST",
    body: { channelId, messageId, emoji },
  }, dataDirectory);
}

export async function pollBridgeActivity({ limitPerChannel = 25, includeMedia = true } = {}, dataDirectory = getDataDirectory()) {
  return callBridge("/v1/activity/poll", {
    method: "POST",
    body: { limitPerChannel, includeMedia },
  }, dataDirectory);
}

export async function acknowledgeBridgeActivity({ batchId }, dataDirectory = getDataDirectory()) {
  return callBridge("/v1/activity/ack", {
    method: "POST",
    body: { batchId },
  }, dataDirectory);
}
