import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { DiscordRestClient } from "../../bridge/discord-bridge.mjs";
import { getDataDirectory, loadSettings } from "../../mcp/lib/settings.mjs";
import { BudgetGovernor } from "./budget-governor.mjs";
import { CodexCompanion } from "./codex-companion.mjs";
import { PresenceBatcher } from "./event-batcher.mjs";
import { DiscordGatewayClient } from "./gateway-client.mjs";

async function readHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error("A local interactive terminal is required for the hidden token prompt.");
  process.stdout.write(prompt);
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  try {
    return await new Promise((resolve, reject) => {
      const onData = (chunk) => {
        for (const character of chunk) {
          if (character === "\u0003") {
            process.stdin.off("data", onData);
            reject(new Error("Token entry cancelled."));
            return;
          }
          if (character === "\r" || character === "\n") {
            process.stdin.off("data", onData);
            process.stdout.write("\n");
            resolve(value.trim());
            return;
          }
          if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
          else if (character >= " ") value += character;
        }
      };
      process.stdin.on("data", onData);
    });
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

async function loadConfig(dataDirectory) {
  const configPath = process.env.COMPANION_CORE_LITE_SDK_CONFIG?.trim()
    ? path.resolve(process.env.COMPANION_CORE_LITE_SDK_CONFIG)
    : path.join(dataDirectory, "sdk-config.json");
  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(`Could not read SDK configuration at ${configPath}`, { cause: error });
  }
}

async function saveFailedTurn(dataDirectory, batch, error) {
  const target = path.join(dataDirectory, "sdk-failed-turn.json");
  const temporary = path.join(dataDirectory, `sdk-failed-turn.${process.pid}.${Date.now()}.tmp`);
  const record = {
    failedAt: new Date().toISOString(),
    error: error?.message ?? String(error),
    retryPolicy: "manual-only-to-avoid-duplicate-visible-actions",
    batch,
  };
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

function mergeBatches(batches, maximumMessages) {
  const channels = new Map();
  for (const batch of batches) {
    for (const channel of batch.channels) {
      const current = channels.get(channel.channelId) ?? { ...channel, messages: [], directPing: false };
      const seen = new Set(current.messages.map((message) => message.id));
      for (const message of channel.messages) if (!seen.has(message.id)) current.messages.push(message);
      current.messages = current.messages.slice(-maximumMessages);
      current.directPing ||= channel.directPing;
      channels.set(channel.channelId, current);
    }
  }
  const values = [...channels.values()];
  return {
    createdAt: batches[0]?.createdAt ?? new Date().toISOString(),
    directPing: batches.some((batch) => batch.directPing),
    messageCount: values.reduce((total, channel) => total + channel.messages.length, 0),
    channels: values,
  };
}

function findChannel(batch, channelId) {
  return batch.channels.find((channel) => channel.channelId === channelId) ?? null;
}

async function executeAction(client, batch, action) {
  if (action.action === "silent") return { visibleAction: "silent" };
  const channel = findChannel(batch, String(action.channelId ?? ""));
  if (!channel) throw new Error("Codex selected a channel outside the delivered batch.");
  if (action.action === "message") {
    if (channel.policy.canSpeak === false) throw new Error("Codex selected speech in a channel where canSpeak is disabled.");
    const content = typeof action.content === "string" ? action.content.trim() : "";
    if (!content || content.length > 2_000) throw new Error("Codex returned an empty or oversized Discord message.");
    const replyId = action.messageId == null ? null : String(action.messageId);
    if (replyId && !channel.messages.some((message) => message.id === replyId)) throw new Error("Codex selected a reply target outside the delivered batch.");
    const posted = await client.createMessage(channel.channelId, {
      content,
      mentionUserIds: [],
      replyToMessageId: replyId,
      nonce: randomBytes(12).toString("base64url"),
    });
    return { visibleAction: "message", messageId: String(posted.id), channelId: channel.channelId };
  }
  if (action.action === "reaction") {
    if (channel.policy.canReact === false) throw new Error("Codex selected a reaction in a channel where canReact is disabled.");
    const messageId = String(action.messageId ?? "");
    if (!channel.messages.some((message) => message.id === messageId)) throw new Error("Codex selected a reaction target outside the delivered batch.");
    const emoji = typeof action.emoji === "string" ? action.emoji.trim() : "";
    if (!emoji || emoji.length > 100 || emoji.startsWith("<") || emoji.includes("/")) throw new Error("Codex returned an invalid reaction emoji.");
    await client.createReaction(channel.channelId, messageId, emoji);
    return { visibleAction: "reaction", messageId, channelId: channel.channelId, emoji };
  }
  throw new Error(`Unknown Codex action: ${action.action}`);
}

const dataDirectory = getDataDirectory();
await mkdir(dataDirectory, { recursive: true });
const config = await loadConfig(dataDirectory);
const identityDirectory = path.resolve(config.identityDirectory ?? path.join(dataDirectory, "identity"));
const maximumBatchMessages = Math.min(100, Math.max(1, Number(config.maximumBatchMessages) || 30));
const governor = new BudgetGovernor({ dataDirectory, config: config.budget });
const limits = governor.config;
const configPath = process.env.COMPANION_CORE_LITE_SDK_CONFIG?.trim()
  ? path.resolve(process.env.COMPANION_CORE_LITE_SDK_CONFIG)
  : path.join(dataDirectory, "sdk-config.json");
const quietHours = limits.quietHours
  ? `${limits.quietHours.start}-${limits.quietHours.end}${limits.quietHours.allowDirectPings ? " (direct pings allowed)" : ""}`
  : "off";
process.stdout.write(`Cost guard: ${limits.maximumTurnsPerHour}/hour, ${limits.maximumTurnsPerDay}/day, ${limits.reservedDirectPingTurnsPerDay} daily turns reserved for direct pings.\n`);
process.stdout.write(`Cooldowns: ${limits.minimumCooldownSeconds}s ordinary, ${limits.directPingCooldownSeconds}s direct ping. Quiet hours: ${quietHours}.\n`);
process.stdout.write(`Hosted web search: ${["disabled", "cached", "live"].includes(config.codex?.webSearchMode) ? config.codex.webSearchMode : "disabled"}.\n`);
process.stdout.write(`Settings file: ${configPath}\n`);
let token = await readHidden("Discord bot token (hidden; never saved or sent to Codex): ");
if (!token) throw new Error("No Discord bot token was entered.");

const rest = new DiscordRestClient(token);
const settings = await loadSettings(dataDirectory);
const identity = await rest.authenticate(settings);
const gateway = await rest.request("/gateway/bot");
const companion = new CodexCompanion({ dataDirectory, identityDirectory, codexConfig: config.codex });
const pending = [];
let processing = false;
let retryTimer = null;

async function processPending() {
  if (processing || !pending.length) return;
  processing = true;
  let claimedBatch = null;
  try {
    const batch = mergeBatches(pending, maximumBatchMessages);
    const decision = await governor.claim({ directPing: batch.directPing, messageCount: batch.messageCount });
    if (!decision.granted) {
      process.stdout.write(`Budget held ${batch.messageCount} Discord message(s): ${decision.reason}. No Codex turn was started.\n`);
      retryTimer ??= setTimeout(() => { retryTimer = null; void processPending(); }, 60_000);
      retryTimer.unref?.();
      return;
    }
    pending.splice(0, pending.length);
    claimedBatch = batch;
    const result = await companion.run(batch);
    const execution = await executeAction(rest, batch, result.action);
    process.stdout.write(`Codex turn ${decision.usage.day}/${decision.limits.maximumTurnsPerDay} today: ${execution.visibleAction}.\n`);
  } catch (error) {
    process.stderr.write(`Companion turn failed safely: ${error?.message ?? String(error)}\n`);
    if (claimedBatch) {
      try {
        await saveFailedTurn(dataDirectory, claimedBatch, error);
        process.stderr.write(`The failed batch was preserved at ${path.join(dataDirectory, "sdk-failed-turn.json")}; it will not auto-retry.\n`);
      } catch (preserveError) {
        process.stderr.write(`Could not preserve the failed batch: ${preserveError?.message ?? String(preserveError)}\n`);
      }
    }
  } finally {
    processing = false;
    if (pending.length && !retryTimer) void processPending();
  }
}

const batcher = new PresenceBatcher({
  botId: identity.bot.id,
  settingsProvider: () => loadSettings(dataDirectory),
  coalesceMilliseconds: Math.max(0, Number(config.coalesceSeconds ?? 20) * 1000),
  maximumBatchMessages,
  onReady: async (batch) => {
    pending.push(batch);
    await processPending();
  },
});
const gatewayClient = new DiscordGatewayClient({
  gatewayUrl: gateway.url,
  token,
  onDispatch: async (event) => {
    if (event.type === "MESSAGE_CREATE") await batcher.ingest(event.data);
    else if (event.type === "READY") process.stdout.write(`Gateway ready as ${event.data.user?.username ?? identity.bot.username}.\n`);
    else if (event.type === "gateway.error") process.stderr.write(`Discord Gateway error: ${event.error?.message ?? event.error}\n`);
  },
});
gatewayClient.start();
token = "";

process.stdout.write(`Companion Core Lite SDK runtime connected ${identity.application.name} in ${identity.guild.name}.\n`);
process.stdout.write(`Identity: ${path.join(identityDirectory, "PERSONA.md")}\n`);
process.stdout.write("Waiting on Gateway events costs no Codex turns. Press Ctrl+C to stop.\n");

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  if (retryTimer) clearTimeout(retryTimer);
  batcher.close();
  gatewayClient.close();
  process.stdout.write("\nCompanion Core Lite SDK runtime stopped.\n");
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
