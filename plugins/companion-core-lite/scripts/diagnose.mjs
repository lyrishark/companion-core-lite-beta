import path from "node:path";
import { getBridgeStatus } from "../mcp/lib/bridge-client.mjs";
import { getDataDirectory, heartbeatView, loadSettings } from "../mcp/lib/settings.mjs";

const dataDirectory = getDataDirectory();
const settings = await loadSettings(dataDirectory);
const transport = await getBridgeStatus(dataDirectory);
const heartbeat = heartbeatView(settings);

const report = {
  dataDirectory,
  settingsPath: path.join(dataDirectory, "settings.json"),
  heartbeat: {
    preset: heartbeat.preset,
    label: heartbeat.label,
    intervalMinutes: heartbeat.intervalMinutes,
    scheduleKind: heartbeat.scheduleKind,
    maximumScheduledChecks: heartbeat.maximumScheduledChecks,
    maximumScheduledChecksPeriod: heartbeat.maximumScheduledChecksPeriod,
    schedulerSync: heartbeat.schedulerSync,
    scheduleReference: heartbeat.scheduleReference,
  },
  discord: {
    configured: Boolean(settings.discord.applicationId && settings.discord.serverId),
    applicationId: settings.discord.applicationId,
    serverId: settings.discord.serverId,
    configuredChannels: Object.keys(settings.channels).length,
  },
  transport: {
    status: transport.transportStatus,
    bot: transport.bot?.username ?? null,
    server: transport.guild?.name ?? null,
    automaticHeartbeatBatching: transport.capabilities?.automaticHeartbeatBatching === true,
    error: transport.transportStatus === "connected" ? null : transport.error ?? null,
  },
  tokenStoredByPlugin: false,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
