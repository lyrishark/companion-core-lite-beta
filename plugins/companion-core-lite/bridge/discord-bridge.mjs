import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { getDataDirectory, isDiscordSnowflake, loadSettings } from "../mcp/lib/settings.mjs";
import { activityStateSummary, loadActivityState, saveActivityState } from "./activity-state.mjs";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const MAX_BODY_BYTES = 16_384;
const MAX_MEDIA_BYTES = 4 * 1024 * 1024;
const MAX_MEDIA_ITEMS = 2;
const MEDIA_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function redactDiscordError(payload, status) {
  const code = payload && typeof payload.code !== "undefined" ? ` (Discord code ${payload.code})` : "";
  const message = payload && typeof payload.message === "string" ? payload.message : `HTTP ${status}`;
  return `${message}${code}`;
}

export class DiscordRestClient {
  constructor(token, { fetchImpl = fetch, apiBase = DISCORD_API_BASE } = {}) {
    if (!token || typeof token !== "string") throw new Error("A Discord bot token is required.");
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.apiBase = apiBase.replace(/\/$/, "");
  }

  async request(route, { method = "GET", body, attempts = 0 } = {}) {
    const response = await this.fetchImpl(`${this.apiBase}${route}`, {
      method,
      headers: {
        authorization: `Bot ${this.token}`,
        "user-agent": "DiscordBot (https://github.com, 0.1.0) CompanionCoreLite",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => null);
    if (response.status === 429 && attempts < 1) {
      const retryAfter = Math.max(0, Number(payload?.retry_after ?? response.headers.get("retry-after") ?? 0));
      if (Number.isFinite(retryAfter) && retryAfter <= 5) {
        await new Promise((resolve) => setTimeout(resolve, Math.ceil(retryAfter * 1000)));
        return this.request(route, { method, body, attempts: attempts + 1 });
      }
    }
    if (!response.ok) throw new Error(`Discord API rejected the request: ${redactDiscordError(payload, response.status)}`);
    return payload;
  }

  async authenticate(settings) {
    if (!settings.discord.applicationId || !settings.discord.serverId) {
      throw new Error("Discord application and server IDs are not configured yet.");
    }
    const [bot, application, guild] = await Promise.all([
      this.request("/users/@me"),
      this.request("/oauth2/applications/@me"),
      this.request(`/guilds/${settings.discord.serverId}`),
    ]);
    if (String(application.id) !== settings.discord.applicationId) {
      throw new Error(`The token belongs to application ${application.id}, not configured application ${settings.discord.applicationId}.`);
    }
    return {
      bot: { id: String(bot.id), username: bot.username, discriminator: bot.discriminator ?? null },
      application: { id: String(application.id), name: application.name },
      guild: { id: String(guild.id), name: guild.name },
    };
  }

  async channel(channelId) {
    return this.request(`/channels/${channelId}`);
  }

  async messages(channelId, { limit, after = null } = {}) {
    const query = new URLSearchParams({ limit: String(limit ?? 50) });
    if (after) query.set("after", after);
    return this.request(`/channels/${channelId}/messages?${query}`);
  }

  async createMessage(channelId, { content, mentionUserIds, replyToMessageId, nonce }) {
    const allowedMentions = mentionUserIds.length
      ? { users: mentionUserIds, replied_user: false }
      : { parse: [], replied_user: false };
    return this.request(`/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content,
        nonce,
        enforce_nonce: true,
        allowed_mentions: allowedMentions,
        ...(replyToMessageId ? {
          message_reference: {
            type: 0,
            message_id: replyToMessageId,
            channel_id: channelId,
            fail_if_not_exists: true,
          },
        } : {}),
      },
    });
  }

  async createReaction(channelId, messageId, emoji) {
    return this.request(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, {
      method: "PUT",
    });
  }

  async media(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !MEDIA_HOSTS.has(parsed.hostname)) {
      throw new Error("Refused non-Discord media URL.");
    }
    const response = await this.fetchImpl(parsed, { redirect: "error" });
    if (!response.ok) throw new Error(`Discord media returned HTTP ${response.status}.`);
    const type = (response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
    if (!MEDIA_TYPES.has(type)) throw new Error(`Unsupported Discord media type: ${type || "unknown"}.`);
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_MEDIA_BYTES) throw new Error("Discord image exceeds the 4 MiB bridge limit.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_MEDIA_BYTES) throw new Error("Discord image exceeds the 4 MiB bridge limit.");
    return { mimeType: type, data: Buffer.from(bytes).toString("base64") };
  }
}

function validateChannelId(value) {
  const channelId = typeof value === "string" ? value.trim() : "";
  if (!isDiscordSnowflake(channelId)) throw new Error("channelId must be a Discord snowflake ID.");
  return channelId;
}

function validateMessageId(value, field = "messageId") {
  const messageId = typeof value === "string" ? value.trim() : "";
  if (!isDiscordSnowflake(messageId)) throw new Error(`${field} must be a Discord snowflake ID.`);
  return messageId;
}

function validatePostBody(body) {
  const channelId = validateChannelId(body.channelId);
  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim()) throw new Error("content must not be empty.");
  if (content.length > 2_000) throw new Error("content must be at most 2,000 characters.");
  const mentionUserIds = Array.isArray(body.mentionUserIds) ? [...new Set(body.mentionUserIds.map((id) => String(id).trim()))] : [];
  if (mentionUserIds.length > 10 || mentionUserIds.some((id) => !isDiscordSnowflake(id))) {
    throw new Error("mentionUserIds must contain at most 10 Discord user IDs.");
  }
  const replyToMessageId = body.replyToMessageId == null ? null : validateMessageId(body.replyToMessageId, "replyToMessageId");
  const nonce = typeof body.nonce === "string" ? body.nonce.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,25}$/.test(nonce)) throw new Error("The local post nonce is invalid.");
  return { channelId, content, mentionUserIds, replyToMessageId, nonce };
}

function validateReactionBody(body) {
  const channelId = validateChannelId(body.channelId);
  const messageId = validateMessageId(body.messageId);
  const emoji = typeof body.emoji === "string" ? body.emoji.trim() : "";
  if (!emoji || emoji.length > 100) throw new Error("emoji must be a Unicode emoji or custom name:id value.");
  if (emoji.startsWith("<") || emoji.includes("/")) throw new Error("Custom emoji must use name:id format, without Discord angle brackets.");
  return { channelId, messageId, emoji };
}

async function configuredChannel(client, settings, channelId) {
  const policy = settings.channels[channelId];
  if (!policy) throw new Error("That channel is not configured in Companion Core Lite.");
  const channel = await client.channel(channelId);
  if (String(channel.guild_id ?? "") !== settings.discord.serverId) {
    throw new Error("That channel does not belong to the configured Discord server.");
  }
  return { policy, channel };
}

function normalizeEmbed(embed) {
  return {
    type: embed.type ?? null,
    url: embed.url ?? null,
    title: embed.title ?? null,
    description: embed.description ?? null,
    provider: embed.provider?.name ?? null,
    imageUrl: embed.image?.url ?? embed.thumbnail?.url ?? null,
  };
}

function normalizeMessage(message) {
  return {
    id: String(message.id),
    timestamp: message.timestamp,
    editedTimestamp: message.edited_timestamp ?? null,
    author: {
      id: String(message.author?.id ?? ""),
      username: message.author?.global_name ?? message.author?.username ?? "unknown",
      bot: Boolean(message.author?.bot),
    },
    content: message.content ?? "",
    mentions: Array.isArray(message.mentions) ? message.mentions.map((mention) => String(mention.id)) : [],
    attachments: Array.isArray(message.attachments) ? message.attachments.map((attachment) => ({
      id: String(attachment.id),
      filename: attachment.filename,
      description: attachment.description ?? null,
      contentType: attachment.content_type ?? null,
      size: attachment.size ?? null,
      url: attachment.url,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
    })) : [],
    embeds: Array.isArray(message.embeds) ? message.embeds.map(normalizeEmbed) : [],
  };
}

function compareSnowflakes(left, right) {
  const a = BigInt(left.id);
  const b = BigInt(right.id);
  return a < b ? -1 : a > b ? 1 : 0;
}

function messageMentionsBot(message, botId) {
  return message.mentions.includes(botId);
}

async function collectMedia(client, messages) {
  const candidates = [];
  for (const message of messages) {
    for (const attachment of message.attachments) {
      if (candidates.length >= MAX_MEDIA_ITEMS) break;
      if (attachment.contentType && MEDIA_TYPES.has(attachment.contentType.split(";", 1)[0].toLowerCase())) {
        candidates.push({ messageId: message.id, attachment });
      }
    }
    if (candidates.length >= MAX_MEDIA_ITEMS) break;
  }
  const media = [];
  const warnings = [];
  for (const candidate of candidates) {
    try {
      const loaded = await client.media(candidate.attachment.url);
      media.push({
        messageId: candidate.messageId,
        attachmentId: candidate.attachment.id,
        filename: candidate.attachment.filename,
        ...loaded,
      });
    } catch (error) {
      warnings.push(`${candidate.attachment.filename}: ${error?.message ?? String(error)}`);
    }
  }
  return { media, warnings };
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function sendJson(response, status, payload) {
  const bytes = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": bytes.length,
    "cache-control": "no-store",
  });
  response.end(bytes);
}

function authorized(request, sessionKey) {
  const header = request.headers.authorization;
  return typeof header === "string" && header === `Bearer ${sessionKey}`;
}

async function writeSessionFile(dataDirectory, session) {
  await mkdir(dataDirectory, { recursive: true });
  const target = path.join(dataDirectory, "bridge-session.json");
  const temporary = path.join(dataDirectory, `bridge-session.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

async function removeOwnSessionFile(dataDirectory, bridgeId) {
  const target = path.join(dataDirectory, "bridge-session.json");
  try {
    const current = JSON.parse(await readFile(target, "utf8"));
    if (current.bridgeId === bridgeId) await unlink(target);
  } catch (error) {
    if (error?.code !== "ENOENT") return;
  }
}

export async function startDiscordBridge({
  token,
  dataDirectory = getDataDirectory(),
  fetchImpl = fetch,
  apiBase = DISCORD_API_BASE,
} = {}) {
  const client = new DiscordRestClient(token, { fetchImpl, apiBase });
  const settings = await loadSettings(dataDirectory);
  const identity = await client.authenticate(settings);
  const bridgeId = randomUUID();
  const sessionKey = randomBytes(32).toString("base64url");
  let activityQueue = Promise.resolve();

  function serializeActivity(operation) {
    const pending = activityQueue.then(operation, operation);
    activityQueue = pending.catch(() => undefined);
    return pending;
  }

  async function pollActivity({ limitPerChannel, includeMedia }) {
    const pollResult = await serializeActivity(async () => {
      const current = await loadSettings(dataDirectory);
      let activity = await loadActivityState(dataDirectory);
      if (activity.pendingBatch) {
        const originalChannels = activity.pendingBatch.channels;
        const validChannels = originalChannels.filter((delivery) => {
          const currentPolicy = current.channels[delivery.channel.id];
          return currentPolicy && currentPolicy.mode === delivery.policy.mode;
        });
        const policyInvalidatedChannelIds = originalChannels
          .filter((delivery) => !validChannels.includes(delivery))
          .map((delivery) => delivery.channel.id);
        if (policyInvalidatedChannelIds.length) {
          activity.pendingBatch = validChannels.length ? {
            ...activity.pendingBatch,
            channels: validChannels,
            messageCount: validChannels.reduce((total, delivery) => total + delivery.messages.length, 0),
          } : null;
          activity = await saveActivityState(activity, dataDirectory);
        }
        return {
          batch: activity.pendingBatch,
          replayed: Boolean(activity.pendingBatch),
          initializedChannelIds: [],
          policyInvalidatedChannelIds,
          state: activityStateSummary(activity, Object.keys(current.channels)),
        };
      }

      const initializedChannelIds = [];
      const deliveries = [];
      for (const [channelId, policy] of Object.entries(current.channels)) {
        const channel = await client.channel(channelId);
        if (String(channel.guild_id ?? "") !== current.discord.serverId) {
          throw new Error(`Configured channel ${channelId} does not belong to the configured Discord server.`);
        }
        const channelState = activity.channels[channelId] ?? {
          lastSeenMessageId: null,
          initializedAt: null,
          updatedAt: null,
          lurkBuffer: [],
        };
        if (!channelState.initializedAt) {
          const latest = await client.messages(channelId, { limit: 1 });
          channelState.lastSeenMessageId = latest[0] ? String(latest[0].id) : null;
          channelState.initializedAt = new Date().toISOString();
          channelState.updatedAt = channelState.initializedAt;
          channelState.lurkBuffer = [];
          activity.channels[channelId] = channelState;
          initializedChannelIds.push(channelId);
          continue;
        }

        const rawMessages = await client.messages(channelId, { limit: 100, after: channelState.lastSeenMessageId });
        const ordered = rawMessages.sort(compareSnowflakes).slice(0, limitPerChannel);
        if (ordered.length) {
          channelState.lastSeenMessageId = String(ordered.at(-1).id);
          channelState.updatedAt = new Date().toISOString();
        }
        const humanMessages = ordered
          .filter((message) => String(message.author?.id ?? "") !== identity.bot.id)
          .map(normalizeMessage);
        let delivered = [];
        if (policy.mode === "active") {
          delivered = humanMessages;
          channelState.lurkBuffer = [];
        } else if (policy.mode === "strict") {
          delivered = humanMessages.filter((message) => messageMentionsBot(message, identity.bot.id));
          channelState.lurkBuffer = [];
        } else {
          const bufferLimit = Math.min(100, Math.max(1, policy.lurkBufferMessages || 25));
          channelState.lurkBuffer = [...channelState.lurkBuffer, ...humanMessages].slice(-bufferLimit);
          if (humanMessages.some((message) => messageMentionsBot(message, identity.bot.id))) {
            delivered = channelState.lurkBuffer;
            channelState.lurkBuffer = [];
          }
        }
        activity.channels[channelId] = channelState;
        if (delivered.length) {
          deliveries.push({
            channel: { id: String(channel.id), name: channel.name ?? null, type: channel.type },
            policy,
            messages: delivered,
            backlogPossible: rawMessages.length > ordered.length,
          });
        }
      }

      let batch = null;
      if (deliveries.length) {
        batch = {
          batchId: randomUUID(),
          createdAt: new Date().toISOString(),
          channels: deliveries,
          messageCount: deliveries.reduce((total, delivery) => total + delivery.messages.length, 0),
        };
        activity.pendingBatch = batch;
      }
      activity = await saveActivityState(activity, dataDirectory);
      return {
        batch,
        replayed: false,
        initializedChannelIds,
        policyInvalidatedChannelIds: [],
        state: activityStateSummary(activity, Object.keys(current.channels)),
      };
    });

    const messages = pollResult.batch?.channels.flatMap((channel) => channel.messages) ?? [];
    const mediaResult = includeMedia && messages.length ? await collectMedia(client, messages) : { media: [], warnings: [] };
    return {
      ...pollResult,
      quiet: !pollResult.batch,
      media: mediaResult.media,
      warnings: mediaResult.warnings,
      acknowledgmentRequired: Boolean(pollResult.batch),
    };
  }

  async function acknowledgeActivity(batchId) {
    return serializeActivity(async () => {
      const current = await loadSettings(dataDirectory);
      let activity = await loadActivityState(dataDirectory);
      if (!activity.pendingBatch) {
        if (activity.lastAcknowledgedBatchId === batchId) {
          return { acknowledged: true, alreadyAcknowledged: true, batchId, state: activityStateSummary(activity, Object.keys(current.channels)) };
        }
        throw new Error("There is no pending Discord activity batch to acknowledge.");
      }
      if (activity.pendingBatch.batchId !== batchId) {
        throw new Error(`Pending Discord activity batch is ${activity.pendingBatch.batchId}, not ${batchId}.`);
      }
      activity.pendingBatch = null;
      activity.lastAcknowledgedBatchId = batchId;
      activity = await saveActivityState(activity, dataDirectory);
      return { acknowledged: true, alreadyAcknowledged: false, batchId, state: activityStateSummary(activity, Object.keys(current.channels)) };
    });
  }

  const server = http.createServer(async (request, response) => {
    try {
      if (!authorized(request, sessionKey)) return sendJson(response, 401, { error: "Local bridge authorization failed." });
      if (request.method === "GET" && request.url === "/v1/status") {
        const current = await loadSettings(dataDirectory);
        const activity = await loadActivityState(dataDirectory);
        if (current.discord.applicationId !== identity.application.id || current.discord.serverId !== identity.guild.id) {
          return sendJson(response, 409, { error: "Discord connection IDs changed after this bridge started. Restart the bridge." });
        }
        return sendJson(response, 200, {
          connected: true,
          startedAt: server.startedAt,
          bot: identity.bot,
          application: identity.application,
          guild: identity.guild,
          configuredApplicationId: current.discord.applicationId,
          configuredServerId: current.discord.serverId,
          capabilities: {
            readActiveChannels: true,
            postMessages: true,
            addReactions: true,
            gatewayEvents: false,
            automaticHeartbeatBatching: true,
          },
          activity: activityStateSummary(activity, Object.keys(current.channels)),
        });
      }
      if (request.method === "POST" && request.url === "/v1/peek") {
        const body = await readJsonBody(request);
        const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";
        const limit = Math.min(10, Math.max(1, Number.isInteger(body.limit) ? body.limit : 10));
        const current = await loadSettings(dataDirectory);
        const policy = current.channels[channelId];
        if (!policy) return sendJson(response, 403, { error: "That channel is not configured in Companion Core Lite." });
        if (policy.mode !== "active") {
          return sendJson(response, 403, { error: `Manual peek is unavailable for ${policy.mode} channels because it would bypass that visibility boundary.` });
        }
        const channel = await client.channel(channelId);
        if (String(channel.guild_id ?? "") !== current.discord.serverId) {
          return sendJson(response, 403, { error: "That channel does not belong to the configured Discord server." });
        }
        const rawMessages = await client.messages(channelId, limit);
        const messages = rawMessages.map(normalizeMessage);
        const mediaResult = body.includeMedia === false ? { media: [], warnings: [] } : await collectMedia(client, messages);
        const contentWarning = messages.length > 0 && messages.every((message) => !message.content)
          ? "All returned message bodies are empty. Enable the Message Content privileged intent for the bot, then restart the bridge."
          : null;
        return sendJson(response, 200, {
          channel: { id: String(channel.id), name: channel.name ?? null, type: channel.type },
          policy,
          messages,
          media: mediaResult.media,
          warnings: [...mediaResult.warnings, ...(contentWarning ? [contentWarning] : [])],
          order: "newest-first",
        });
      }
      if (request.method === "POST" && request.url === "/v1/post") {
        const body = validatePostBody(await readJsonBody(request));
        const current = await loadSettings(dataDirectory);
        const { policy, channel } = await configuredChannel(client, current, body.channelId);
        if (!policy.canSpeak) return sendJson(response, 403, { error: "Speaking is disabled for that channel." });
        const posted = await client.createMessage(body.channelId, body);
        return sendJson(response, 200, {
          channel: { id: String(channel.id), name: channel.name ?? null, type: channel.type },
          policy,
          message: normalizeMessage(posted),
          mentionsEnabledForUserIds: body.mentionUserIds,
          massMentionsEnabled: false,
        });
      }
      if (request.method === "POST" && request.url === "/v1/react") {
        const body = validateReactionBody(await readJsonBody(request));
        const current = await loadSettings(dataDirectory);
        const { policy, channel } = await configuredChannel(client, current, body.channelId);
        if (!policy.canReact) return sendJson(response, 403, { error: "Reactions are disabled for that channel." });
        await client.createReaction(body.channelId, body.messageId, body.emoji);
        return sendJson(response, 200, {
          channel: { id: String(channel.id), name: channel.name ?? null, type: channel.type },
          policy,
          messageId: body.messageId,
          emoji: body.emoji,
          reacted: true,
        });
      }
      if (request.method === "POST" && request.url === "/v1/activity/poll") {
        const body = await readJsonBody(request);
        const limitPerChannel = Math.min(50, Math.max(1, Number.isInteger(body.limitPerChannel) ? body.limitPerChannel : 25));
        return sendJson(response, 200, await pollActivity({ limitPerChannel, includeMedia: body.includeMedia !== false }));
      }
      if (request.method === "POST" && request.url === "/v1/activity/ack") {
        const body = await readJsonBody(request);
        const batchId = typeof body.batchId === "string" ? body.batchId.trim() : "";
        if (!/^[0-9a-f-]{36}$/i.test(batchId)) throw new Error("batchId must be the UUID returned by poll_discord_activity.");
        return sendJson(response, 200, await acknowledgeActivity(batchId));
      }
      return sendJson(response, 404, { error: "Unknown bridge route." });
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : 502;
      return sendJson(response, status, { error: error?.message ?? String(error) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  server.startedAt = new Date().toISOString();
  const address = server.address();
  const session = {
    version: 1,
    bridgeId,
    baseUrl: `http://127.0.0.1:${address.port}`,
    sessionKey,
    pid: process.pid,
    startedAt: server.startedAt,
  };
  await writeSessionFile(dataDirectory, session);

  return {
    server,
    identity,
    session: { ...session, sessionKey: "[stored locally; bot token is not stored]" },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await removeOwnSessionFile(dataDirectory, bridgeId);
    },
  };
}
