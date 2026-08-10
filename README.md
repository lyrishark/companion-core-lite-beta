# Companion Core Lite

A public-beta Codex/ChatGPT Work plugin for companion-authored continuity and bounded Discord presence, with both polling and event-driven Codex SDK runtimes.

[![Public beta checks](https://github.com/lyrishark/companion-core-lite-beta/actions/workflows/ci.yml/badge.svg)](https://github.com/lyrishark/companion-core-lite-beta/actions/workflows/ci.yml)

This repository is a sanitized distribution snapshot. It contains no bot token, live bridge state, companion identity archive, private Discord transcript, or private development history. Every recipient supplies their own Discord application and companion-authored identity files locally.

The responsive SDK requires **local Codex plus a private local terminal**. ChatGPT Work-only users should use the polling handoff. After any plugin install or update, open a fresh task before configuration so the new skill and MCP tools are loaded.

## Start and share

- New recipient: begin with [START_HERE.md](START_HERE.md).
- Exact distribution contents and exclusions: [What to share](docs/SHARING.md).
- Security reports and token-response steps: [SECURITY.md](SECURITY.md).
- Source contributions: [CONTRIBUTING.md](CONTRIBUTING.md).
- Release history: [CHANGELOG.md](CHANGELOG.md).

This pilot makes the costly part obvious: the heartbeat control shows named presets, intervals, hard schedule ceilings, and whether the saved preference has actually been synchronized to the Work scheduled task. Frugal (every 30 minutes, at most 48 scheduled checks/day) is the default. Social Session offers five-minute responsiveness for four hours with the same 48-run ceiling, then stops.

## What works now

- Local, atomic persistence with no third-party dependencies.
- Interactive heartbeat settings UI through the MCP Apps resource.
- Off, Frugal, Balanced, Present, Very Present, and bounded Custom presets.
- A bounded Social Session preset: every five minutes for four hours, no more than 48 scheduled runs, then stop.
- A separate `schedulerSyncRequired` state so a saved setting cannot masquerade as a changed Work task.
- Active, Lurk, and Strict per-channel policies with separate react/speak permissions.
- Companion-presence skill guidance that treats speak, react, and silence as equally valid choices.
- A Discord REST bridge that authenticates the configured bot, verifies its server, and reads a configured Active channel on demand.
- Link/embed metadata and up to two Discord-hosted image attachments per manual read.
- A masked local token prompt. The bot token is held only in the bridge process memory; it is never passed to an MCP tool or written to plugin settings.
- Companion-authored message posting gated by each channel's `canSpeak` permission.
- Idempotent reactions gated separately by `canReact`.
- Mention-safe posting: mass/role pings are suppressed, specific user pings must be explicit, and replies do not automatically ping their authors.
- Persistent per-channel cursors and bounded, mode-aware heartbeat polling.
- Acknowledged delivery: a batch replays until the companion confirms it reached context and made a speak/react/silence judgment.
- A Discord Gateway + Codex SDK preview that waits without inference, coalesces qualifying events, and shows the bot online.
- A persistent pre-inference governor with hourly and daily caps, cooldowns, quiet hours, and reserved direct-ping capacity.
- One structured speak/react/silence outcome per SDK turn, followed by host-side permission and mention validation.
- Companion-authored `PERSONA.md` plus optional `CONTINUITY.md`, injected into a durable local SDK thread and refreshed when the files change.

## Honest pilot boundary

Discord REST reading, posting, reactions, and heartbeat polling are wired. Active batches new human messages; Lurk releases bounded context after a ping; Strict delivers only pinging messages. The separate SDK preview also wires Discord Gateway event delivery to a durable local Codex thread, so it can be responsive without paying for empty polls.

The schedule itself belongs to ChatGPT Work's scheduled-task surface. While Discord transport is disconnected, the plugin saves a desired cadence but deliberately does not start a wasteful task. After the polling transaction passes its manual baseline/delivery/replay/acknowledgment test, Work may create or update the scheduled task in the companion chat; only then should the plugin mark the cadence confirmed.

A limit inside the connector cannot save a Work turn that has already awakened. For the responsive Work-only mode, the hard ceiling therefore lives in the scheduled task itself: Social Session uses a five-minute interval with 48 total occurrences. The [responsive SDK setup](docs/SDK_SETUP_HANDOFF.md) instead enforces limits before each Codex turn. It uses local Codex continuity files and does not inherit ChatGPT Work memory.

## Hand this to Codex or Work

- [Human quick start](docs/QUICKSTART.md)
- [Responsive SDK setup handoff](docs/SDK_SETUP_HANDOFF.md)
- [Codex/Work setup handoff](docs/CODEX_WORK_SETUP_HANDOFF.md)
- [Usage and presence modes](docs/USAGE_AND_PRESENCE_MODES.md)

The shareable archive opens with [START_HERE.md](START_HERE.md). Build it locally with:

```powershell
& .\scripts\package-beta.ps1
```

## First polling Discord connection

1. In the Discord Developer Portal, enable **Message Content Intent** for the bot.
2. Make sure the bot can **View Channel** and **Read Message History** in each channel it should read. Add **Send Messages** where `canSpeak` is enabled and **Add Reactions** where `canReact` is enabled.
3. In Companion Core Lite, configure the non-secret application and server IDs with `set_discord_connection`, then configure channels with `set_channel_policy`.
4. Ask for `get_discord_transport_status`. It returns the exact local launcher command for that installation.
5. Run that command in a private local terminal. Paste the bot token only into its masked prompt, where no characters are echoed.
6. Start a new Codex or Work task. Already-open tasks may retain the older skill and MCP tool inventory after a plugin update.
7. Keep the terminal open. Use `peek_discord_channel` for a configured Active channel, `post_discord_message` where speaking is allowed, and `react_discord_message` where reactions are allowed.
8. Before enabling a scheduled heartbeat, manually test `poll_discord_activity`: baseline once, post a new human message, poll twice to prove pending replay, acknowledge its exact batch ID, and poll once more to prove quiet deduplication.

The bridge listens on a random `127.0.0.1` port and protects every route with a random per-run session key. The session file contains the loopback address and session key—not the Discord bot token—and is removed when the bridge stops normally. Stop it with Ctrl+C.

Runtime delivery state lives in `%USERPROFILE%\.companion-core-lite\activity-state.json`. It contains channel cursors, a bounded Lurk buffer, and at most one pending delivery batch. It does not contain the Discord bot token. This bounded local persistence is what allows an interrupted Work turn to replay rather than lose a batch.

## Local development

Requirements: Node.js 20 or newer and Codex.

Run all tests:

```powershell
node --test H:\companion-core-lite\plugins\companion-core-lite\mcp\test\activity-poll.test.mjs H:\companion-core-lite\plugins\companion-core-lite\mcp\test\discord-bridge.test.mjs H:\companion-core-lite\plugins\companion-core-lite\mcp\test\server.test.mjs H:\companion-core-lite\plugins\companion-core-lite\mcp\test\settings.test.mjs
Push-Location H:\companion-core-lite\plugins\companion-core-lite\sdk; npm ci; npm test; Pop-Location
```

Use an isolated data directory during manual MCP tests:

```powershell
$env:COMPANION_CORE_LITE_DATA_DIR = "H:\companion-core-lite\.local-data"
node H:\companion-core-lite\plugins\companion-core-lite\mcp\server.mjs
```

Normal installs store settings, bounded activity state, and the ephemeral bridge locator in `%USERPROFILE%\.companion-core-lite`. Set `COMPANION_CORE_LITE_DATA_DIR` to override that location.

Start the event-driven runtime with:

```powershell
& H:\companion-core-lite\plugins\companion-core-lite\scripts\start-sdk-runtime.ps1
```

Run a token-free diagnostic with:

```powershell
node H:\companion-core-lite\plugins\companion-core-lite\scripts\diagnose.mjs
```

## Installation

Add this repository's marketplace, then install the plugin from `companion-pilot`:

```powershell
codex plugin marketplace add <path-to-this-folder>
codex plugin add companion-core-lite@companion-pilot
```

People who do not use GitHub can click **Code → Download ZIP**, extract the complete folder, and begin with [`START_HERE.md`](START_HERE.md). Each person should create their own Discord application and enter its token only into their own bridge prompt. Do not commit `.local-data`, Discord tokens, or companion archives.
