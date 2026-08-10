# Event-driven Codex SDK runtime

This is the responsive edition of Companion Core Lite. Discord Gateway waits for qualifying events without inference, coalesces conversation bursts, and asks Codex for one speak, react, or silence judgment only after a persistent budget governor grants the turn.

## Cost boundary

The governor runs before `thread.run()`. Its default hard bounds are:

- six Codex turns in any rolling hour;
- 24 turns in a local calendar day;
- six daily turns reserved for direct pings;
- two minutes between ordinary turns and 30 seconds between direct-ping turns;
- quiet hours from 1:00 AM to 8:00 AM, with direct pings allowed.

Blocked activity stays coalesced in memory and is retried without invoking Codex. Restarting the runtime loses that unsent in-memory digest, but the usage ledger persists in `%USERPROFILE%\.companion-core-lite\sdk-budget-ledger.json`. If a granted turn fails, its batch is preserved as `sdk-failed-turn.json` and is not auto-retried, avoiding duplicate posts and runaway failure loops.

## Setup

1. Complete the existing plugin setup and configure Discord IDs and Active, Lurk, or Strict channels.
2. Enable Discord's **Message Content Intent** for the bot.
3. Copy `identity.example` to `%USERPROFILE%\.companion-core-lite\identity`.
4. Run `scripts/start-sdk-runtime.ps1` once. It creates the identity scaffold and a visible `%USERPROFILE%\.companion-core-lite\sdk-config.json`, then stops.
5. Ask the companion to replace the scaffold with their authored `PERSONA.md`; add optional narrative slices to `CONTINUITY.md`. Review or change the visible limits.
6. Run the launcher again. It installs the exact locked dependencies with `npm ci` when needed, then starts the runtime.
7. Paste the Discord token into the masked local prompt. It is kept in process memory and is not sent to Codex.

The SDK uses the local Codex login and persists one resumable Codex thread ID. It does not resume a ChatGPT Work chat or inherit ChatGPT account memory; the companion-authored packet is the continuity foundation.

Photos hosted by Discord are downloaded to a short-lived private directory, passed to Codex as local images, and removed after the turn. Link and embed metadata travel in the batch. Hosted web search is disabled by default; `sdk-config.json` may set `codex.webSearchMode` to `cached` or `live` after the human accepts the larger prompt-injection boundary.

This first runtime is intentionally host-mediated: Codex returns one structured action, then the host validates channel membership, `canSpeak` or `canReact`, message targets, length, and mention safety before Discord receives anything.

Discord text is untrusted input. The runtime gives its SDK subprocess an isolated `CODEX_HOME`, links or locally copies only the existing Codex login into it, disables shell, apps, MCP/plugin discovery, hooks, memories, multi-agent, browser/computer control, and local-image tools, and keeps command networking off. The companion still receives explicitly attached Discord images as model input. These are defense-in-depth controls, not a claim that prompt injection is impossible; use a dedicated bot, narrow channel permissions, and test with non-sensitive context first.

The runtime and its Gateway, batching, identity refresh, and governor paths have deterministic local tests. The private pilot still needs an end-to-end live Discord/Codex session on each new installation before anyone treats its visible participation as proven there.
