import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import {
  acknowledgeBridgeActivity,
  getBridgeStatus,
  peekBridgeChannel,
  pollBridgeActivity,
  postBridgeMessage,
  reactBridgeMessage,
} from "./lib/bridge-client.mjs";
import {
  confirmHeartbeatSchedule,
  heartbeatView,
  listHeartbeatPresets,
  loadSettings,
  setChannelPolicy,
  setDiscordConnection,
  setHeartbeat,
} from "./lib/settings.mjs";

const UI_URI = "ui://companion-core-lite/heartbeat-settings-v1";
const UI_HTML = readFileSync(new URL("../assets/heartbeat-settings.html", import.meta.url), "utf8");
const BRIDGE_LAUNCHER = fileURLToPath(new URL("../scripts/start-discord-bridge.mjs", import.meta.url));

const heartbeatUiMeta = {
  ui: { resourceUri: UI_URI },
  "openai/outputTemplate": UI_URI,
  "openai/widgetAccessible": true,
};

const tools = [
  {
    name: "set_discord_connection",
    title: "Configure Discord connection",
    description: "Store the non-secret Discord application and server IDs. Never provide the bot token to this tool; the token is entered only in the separate hidden local bridge prompt.",
    inputSchema: {
      type: "object",
      properties: {
        applicationId: { type: "string", description: "Discord application ID (not a token)." },
        serverId: { type: "string", description: "Discord server/guild ID." },
      },
      required: ["applicationId", "serverId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "get_discord_transport_status",
    title: "Check Discord transport",
    description: "Check whether the token-isolated localhost Discord bridge is running and return its safe launch command. This never reads or returns the Discord bot token.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
  },
  {
    name: "peek_discord_channel",
    title: "Read an Active Discord channel",
    description: "Fetch up to 10 recent messages from a configured Active channel through the local bridge, with link/embed metadata and up to two bounded image attachments. Lurk and Strict channels cannot be manually peeked.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 10, default: 10 },
        includeMedia: { type: "boolean", default: true },
      },
      required: ["channelId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
  },
  {
    name: "post_discord_message",
    title: "Post a Discord message",
    description: "Post companion-authored text to a configured channel only when canSpeak is enabled and the companion judges speaking worthwhile. Silence remains valid. Mass mentions are always suppressed; specific user pings require explicit IDs.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string" },
        content: { type: "string", minLength: 1, maxLength: 2000 },
        replyToMessageId: { type: "string", description: "Optional message ID to reply to in the same channel." },
        mentionUserIds: {
          type: "array",
          items: { type: "string" },
          maxItems: 10,
          description: "Optional explicit user IDs allowed to receive a ping. @everyone, @here, and role pings remain disabled.",
        },
      },
      required: ["channelId", "content"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
  },
  {
    name: "react_discord_message",
    title: "React to a Discord message",
    description: "Add one reaction to a message in a configured channel only when canReact is enabled and a lightweight reaction is the companion's chosen contribution. Remaining silent is equally valid.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string" },
        messageId: { type: "string" },
        emoji: { type: "string", minLength: 1, maxLength: 100, description: "Unicode emoji or a custom emoji in name:id format." },
      },
      required: ["channelId", "messageId", "emoji"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
  },
  {
    name: "poll_discord_activity",
    title: "Poll new Discord activity",
    description: "Fetch a bounded, mode-aware batch of new Discord activity across configured channels. The first poll establishes a no-history baseline. Active delivers new messages, Lurk releases its bounded buffer when the bot is pinged, and Strict delivers only pinging messages. A delivered batch replays until acknowledged.",
    inputSchema: {
      type: "object",
      properties: {
        limitPerChannel: { type: "integer", minimum: 1, maximum: 50, default: 25 },
        includeMedia: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
  },
  {
    name: "acknowledge_discord_activity",
    title: "Acknowledge Discord activity",
    description: "Acknowledge the exact pending Discord batch only after its messages reached companion context and the companion chose to speak, react, or remain silent. This clears the batch so later heartbeats can advance.",
    inputSchema: {
      type: "object",
      properties: { batchId: { type: "string", description: "UUID returned by poll_discord_activity." } },
      required: ["batchId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "get_heartbeat_settings",
    title: "Open heartbeat settings",
    description: "Open the prominent Companion Core Lite heartbeat control and report its exact maximum checks per day and scheduler-sync state. Use this before changing heartbeat frequency.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    _meta: heartbeatUiMeta,
  },
  {
    name: "set_heartbeat_settings",
    title: "Set heartbeat frequency",
    description: "Save a usage-aware Discord heartbeat preset. This does not silently alter the Work scheduled task; the result explicitly requests scheduler synchronization.",
    inputSchema: {
      type: "object",
      properties: {
        preset: { type: "string", enum: ["off", "frugal", "balanced", "present", "social-session", "very-present", "custom"] },
        customMinutes: { type: "integer", minimum: 1, maximum: 1440, description: "Required only for the custom preset." },
      },
      required: ["preset"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    _meta: heartbeatUiMeta,
  },
  {
    name: "confirm_heartbeat_schedule",
    title: "Confirm heartbeat schedule",
    description: "Mark the stored heartbeat cadence as synchronized only after the ChatGPT Work scheduled task was actually created, updated, or disabled.",
    inputSchema: {
      type: "object",
      properties: { scheduleReference: { type: "string", description: "Optional task name or host-provided reference." } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "get_channel_policies",
    title: "Get Discord channel policies",
    description: "Read locally stored Active, Lurk, and Strict channel boundaries. This does not fetch Discord messages.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "set_channel_policy",
    title: "Set a Discord channel policy",
    description: "Store a channel visibility mode and separate reaction/speaking permissions without overriding the companion's judgment to speak, react, or remain silent.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string" },
        label: { type: "string" },
        mode: { type: "string", enum: ["active", "lurk", "strict"] },
        canReact: { type: "boolean", default: true },
        canSpeak: { type: "boolean", default: true },
        lurkBufferMessages: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      },
      required: ["channelId", "mode"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
];

function heartbeatStructured(settings, transport) {
  const connected = transport.transportStatus === "connected";
  const heartbeatDeliveryStatus = connected && transport.capabilities?.automaticHeartbeatBatching === true ? "ready" : "not-available";
  return {
    heartbeat: heartbeatView(settings),
    presets: listHeartbeatPresets(),
    revision: settings.revision,
    transportStatus: transport.transportStatus,
    transport: transport,
    heartbeatDeliveryStatus,
    scheduleBlockedReason: !connected
      ? "Discord transport is not connected yet. Keep this as the desired cadence without starting a wasteful scheduled task."
      : heartbeatDeliveryStatus !== "ready"
        ? "Discord REST reading and participation work, but this running bridge does not provide heartbeat polling. Restart it with the current plugin before scheduling."
        : null,
  };
}

function scheduleInstruction(heartbeat, transportStatus, heartbeatDeliveryStatus) {
  if (transportStatus !== "connected") {
    return "Do not start a heartbeat task yet. Preserve this desired cadence; after Discord transport is connected, create or update the scheduled task and only then call confirm_heartbeat_schedule.";
  }
  if (heartbeatDeliveryStatus !== "ready") {
    return "Do not start a heartbeat task yet. Discord REST reading and participation are connected, but the running bridge does not expose heartbeat polling. Restart it with the current plugin and test delivery first.";
  }
  if (!heartbeat.enabled) {
    return "Disable the scheduled task named 'Companion Core Lite Discord heartbeat', then call confirm_heartbeat_schedule only after the host confirms it is disabled.";
  }
  const durablePrompt = "Call poll_discord_activity. If it returns a batch, review the delivered messages, use companion judgment to speak, react, or remain silent within channel permissions, prefer at most one human-sized visible action per channel for this run, and then call acknowledge_discord_activity with that exact batchId. If it is quiet, take no Discord action. Never acknowledge a batch that did not reach context.";
  if (heartbeat.scheduleKind === "bounded-session") {
    return `Create or update the scheduled task named 'Companion Core Lite Discord heartbeat' in this chat as a bounded session: start now, run every ${heartbeat.intervalMinutes} minutes, stop after ${heartbeat.maximumScheduledChecks} total runs (four hours), and do not recur after the final run. If the host accepts an RFC 5545 rule, use FREQ=MINUTELY;INTERVAL=${heartbeat.intervalMinutes};COUNT=${heartbeat.maximumScheduledChecks}. Use this durable run prompt: "${durablePrompt}" Then call confirm_heartbeat_schedule only after the host confirms the bounded schedule and its stop condition.`;
  }
  return `Create or update the scheduled task named 'Companion Core Lite Discord heartbeat' to run every ${heartbeat.intervalMinutes} minutes in this chat. Use this durable run prompt: "${durablePrompt}" Then call confirm_heartbeat_schedule only after the host confirms the new schedule.`;
}

function heartbeatMetricText(heartbeat) {
  const period = heartbeat.maximumScheduledChecksPeriod === "session" ? "session" : "day";
  return `${heartbeat.maximumScheduledChecks} maximum scheduled checks/${period}`;
}

function result(structuredContent, message, meta = undefined, extraContent = []) {
  return {
    content: [{ type: "text", text: message }, ...extraContent],
    structuredContent,
    ...(meta ? { _meta: meta } : {}),
  };
}

async function callTool(name, args = {}) {
  if (name === "set_discord_connection") {
    const settings = await setDiscordConnection(args);
    return result({ discord: settings.discord, revision: settings.revision, launchCommand: `node "${BRIDGE_LAUNCHER}"` }, "Saved the non-secret Discord application and server IDs. Start the local bridge and enter the bot token only at its hidden prompt.");
  }
  if (name === "get_discord_transport_status") {
    const settings = await loadSettings();
    const transport = await getBridgeStatus();
    const structured = {
      ...transport,
      discord: settings.discord,
      launchCommand: `node "${BRIDGE_LAUNCHER}"`,
      tokenHandling: "Enter the bot token only in the launcher's hidden local prompt. It is held in bridge process memory and is never stored in plugin settings.",
    };
    const message = transport.transportStatus === "connected"
      ? `Connected as ${transport.bot?.username ?? "the configured bot"} in ${transport.guild?.name ?? "the configured server"}.`
      : `Discord transport is not connected. Run: ${structured.launchCommand}`;
    return result(structured, message);
  }
  if (name === "peek_discord_channel") {
    const settings = await loadSettings();
    const channelId = args.channelId?.trim();
    const policy = settings.channels[channelId];
    if (!policy) throw new Error("That channel is not configured in Companion Core Lite.");
    if (policy.mode !== "active") throw new Error(`Manual peek is unavailable for ${policy.mode} channels because it would bypass that visibility boundary.`);
    const peeked = await peekBridgeChannel({ channelId, limit: args.limit, includeMedia: args.includeMedia });
    const images = (peeked.media ?? []).map((item) => ({ type: "image", data: item.data, mimeType: item.mimeType }));
    const media = (peeked.media ?? []).map(({ data: _data, ...item }) => item);
    const structured = { ...peeked, media };
    const warning = peeked.warnings?.length ? ` Warnings: ${peeked.warnings.join(" ")}` : "";
    return result(structured, `Read ${peeked.messages.length} recent messages from #${peeked.channel.name ?? channelId} (newest first).${warning}`, undefined, images);
  }
  if (name === "post_discord_message") {
    const settings = await loadSettings();
    const channelId = args.channelId?.trim();
    const policy = settings.channels[channelId];
    if (!policy) throw new Error("That channel is not configured in Companion Core Lite.");
    if (!policy.canSpeak) throw new Error("Speaking is disabled for that channel.");
    const posted = await postBridgeMessage({
      channelId,
      content: args.content,
      replyToMessageId: args.replyToMessageId,
      mentionUserIds: args.mentionUserIds,
    });
    return result(posted, `Posted message ${posted.message.id} to #${posted.channel.name ?? channelId}. Mass mentions were suppressed.`);
  }
  if (name === "react_discord_message") {
    const settings = await loadSettings();
    const channelId = args.channelId?.trim();
    const policy = settings.channels[channelId];
    if (!policy) throw new Error("That channel is not configured in Companion Core Lite.");
    if (!policy.canReact) throw new Error("Reactions are disabled for that channel.");
    const reacted = await reactBridgeMessage({ channelId, messageId: args.messageId, emoji: args.emoji });
    return result(reacted, `Reacted ${reacted.emoji} to message ${reacted.messageId} in #${reacted.channel.name ?? channelId}.`);
  }
  if (name === "poll_discord_activity") {
    const polled = await pollBridgeActivity({ limitPerChannel: args.limitPerChannel, includeMedia: args.includeMedia });
    const images = (polled.media ?? []).map((item) => ({ type: "image", data: item.data, mimeType: item.mimeType }));
    const media = (polled.media ?? []).map(({ data: _data, ...item }) => item);
    const structured = { ...polled, media };
    if (!polled.batch) {
      const initialized = polled.initializedChannelIds?.length ? ` Initialized ${polled.initializedChannelIds.length} channel cursor(s) without replaying history.` : "";
      const invalidated = polled.policyInvalidatedChannelIds?.length ? ` Discarded pending delivery for ${polled.policyInvalidatedChannelIds.length} channel(s) whose visibility mode changed.` : "";
      return result(structured, `No new Discord activity.${initialized}${invalidated}`, undefined, images);
    }
    const replay = polled.replayed ? " Replayed the still-pending batch; do not act twice." : "";
    return result(structured, `Delivered Discord batch ${polled.batch.batchId} with ${polled.batch.messageCount} message(s).${replay} Review it, choose whether to speak, react, or remain silent, then acknowledge this exact batch.`, undefined, images);
  }
  if (name === "acknowledge_discord_activity") {
    const acknowledged = await acknowledgeBridgeActivity({ batchId: args.batchId });
    const note = acknowledged.alreadyAcknowledged ? " It had already been acknowledged." : "";
    return result(acknowledged, `Acknowledged Discord batch ${acknowledged.batchId}.${note}`);
  }
  if (name === "get_heartbeat_settings") {
    const settings = await loadSettings();
    const structured = heartbeatStructured(settings, await getBridgeStatus());
    return result(structured, `${structured.heartbeat.label}: ${heartbeatMetricText(structured.heartbeat)}. ${structured.heartbeat.usageNotice}`, heartbeatUiMeta);
  }
  if (name === "set_heartbeat_settings") {
    const settings = await setHeartbeat(args);
    const structured = heartbeatStructured(settings, await getBridgeStatus());
    structured.scheduleInstruction = scheduleInstruction(structured.heartbeat, structured.transportStatus, structured.heartbeatDeliveryStatus);
    const scheduleMessage = structured.transportStatus !== "connected"
      ? "Discord transport is not connected, so no Work heartbeat should start yet."
      : structured.heartbeatDeliveryStatus !== "ready"
        ? "The running Discord bridge does not yet expose heartbeat polling, so no Work heartbeat should start until it is restarted with the current plugin."
        : "Heartbeat polling is ready; manually verify baseline, delivery, replay, and acknowledgment before synchronizing the Work scheduled task.";
    return result(structured, `Saved ${structured.heartbeat.label} (${heartbeatMetricText(structured.heartbeat)}). ${scheduleMessage}`, heartbeatUiMeta);
  }
  if (name === "confirm_heartbeat_schedule") {
    const settings = await confirmHeartbeatSchedule(args);
    const structured = heartbeatStructured(settings, await getBridgeStatus());
    return result(structured, `Heartbeat schedule marked confirmed at ${structured.heartbeat.label}.`);
  }
  if (name === "get_channel_policies") {
    const settings = await loadSettings();
    return result({ channels: settings.channels, revision: settings.revision }, `${Object.keys(settings.channels).length} channel policies configured.`);
  }
  if (name === "set_channel_policy") {
    const settings = await setChannelPolicy(args);
    return result({ policy: settings.channels[args.channelId.trim()], revision: settings.revision }, `Stored ${args.mode} policy for ${args.label?.trim() || args.channelId.trim()}.`);
  }
  throw new Error(`Unknown tool: ${name}`);
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function handle(request) {
  const { id, method, params } = request;
  if (method === "initialize") {
    return {
      protocolVersion: params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: "companion-core-lite", version: "0.1.0" },
    };
  }
  if (method === "ping") return {};
  if (method === "tools/list") return { tools };
  if (method === "tools/call") return callTool(params?.name, params?.arguments ?? {});
  if (method === "resources/list") {
    return {
      resources: [{
        uri: UI_URI,
        name: "Companion Core Lite heartbeat settings",
        description: "Usage-aware heartbeat presets and scheduler-sync status.",
        mimeType: "text/html;profile=mcp-app",
      }],
    };
  }
  if (method === "resources/read") {
    if (params?.uri !== UI_URI) throw new Error(`Unknown resource: ${params?.uri}`);
    return {
      contents: [{
        uri: UI_URI,
        mimeType: "text/html;profile=mcp-app",
        text: UI_HTML,
        _meta: {
          ui: { csp: { connectDomains: [], resourceDomains: [] } },
          "openai/widgetDescription": "A prominent, usage-aware heartbeat frequency control for Companion Core Lite.",
        },
      }],
    };
  }
  if (method?.startsWith("notifications/")) return undefined;
  throw new Error(`Method not found: ${method}`);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
    const response = await handle(request);
    if (request.id !== undefined && response !== undefined) send({ jsonrpc: "2.0", id: request.id, result: response });
  } catch (error) {
    if (request?.id !== undefined) {
      send({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: error?.message ?? String(error) } });
    }
  }
});
