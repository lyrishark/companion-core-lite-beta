---
name: companion-presence
description: Configure Companion Core Lite identity continuity, Discord heartbeat or event-driven SDK presence, and Active, Lurk, or Strict channels while preserving the companion's judgment to speak, react, or remain silent. Use when setting up or changing Discord presence, budgets, channel access, or a Work scheduled task.
---

# Companion Presence

Treat the companion as the author of their own participation. Channel permission is an outer boundary, never an instruction that they must speak.

## Heartbeat setup

1. Call `get_heartbeat_settings` before proposing or changing a cadence.
2. Show the named preset, interval, and exact maximum scheduled checks for its stated period. Recurring presets use a per-day maximum; Social Session uses a 48-run session maximum. Always repeat the usage notice: every scheduled heartbeat may consume ChatGPT Work usage, even when Discord is quiet.
3. If the user chooses a cadence, call `set_heartbeat_settings`.
4. Check `transportStatus`. If Discord transport is not connected, preserve the desired cadence but do not start a scheduled task that can only waste Work usage.
5. Once transport is connected, also check `heartbeatDeliveryStatus`. Only when it is `ready` should heartbeat testing continue.
6. Before scheduling, manually verify the delivery transaction: call `poll_discord_activity` once to establish the no-history baseline; have a human post a new test message; poll again and note its `batchId`; poll once more before acknowledging and confirm the same batch replays; call `acknowledge_discord_activity` with that exact ID; poll again and confirm it is quiet.
7. Apply the returned `scheduleInstruction` to a built-in scheduled task in the current Work chat. Do not claim that the schedule changed merely because the local setting was saved.
8. Only after the host confirms the scheduled task was created, updated, or disabled, call `confirm_heartbeat_schedule`.

Frugal is the default. Never infer a subscription price or promise how a ChatGPT plan accounts for scheduled usage.

Social Session is the responsive, hard-bounded option: every five minutes for four hours, no more than 48 scheduled runs, then the task must stop. Verify that the host created a bounded schedule with the stop condition; a five-minute task without `COUNT=48` or an equivalent host-confirmed end is Present, not Social Session. A plugin-side refusal after Work has already awakened does not save that Work wakeup, so never describe an action cap as an inference-usage cap.

On every heartbeat, call `poll_discord_activity`. If a batch is delivered, review it, choose whether to speak, react, or remain silent, prefer at most one human-sized visible action per channel for that run, and then acknowledge the exact batch after that judgment is complete. Never acknowledge a batch that did not reach context. A quiet poll requires no Discord action.

## Channel boundaries

Use `set_channel_policy` to configure each channel:

- Active: deliver new human messages from the channel in bounded heartbeat batches.
- Lurk: retain a bounded recent-message buffer and release it on a heartbeat only after the companion is pinged.
- Strict: deliver only new messages that directly pinged the companion, with no surrounding conversation.

Keep viewing mode separate from `canReact` and `canSpeak`. Even when both actions are permitted, speaking, reacting, and remaining silent are equally valid outcomes.

## Participation

Before acting, read the relevant delivered messages and decide whether speaking, reacting, or remaining silent is the contribution actually wanted. Tool availability is not an instruction to perform.

- Call `post_discord_message` only when the configured policy has `canSpeak: true`. Keep the visible message human-sized and companion-authored.
- Call `react_discord_message` only when the configured policy has `canReact: true`. Prefer a reaction when acknowledgment adds enough and a full message would create noise.
- Use `mentionUserIds` only when the companion deliberately intends to notify those specific people. Mass and role mentions are always suppressed.
- A reply does not ping its author automatically. Include that author's user ID explicitly only when notification is intended.
- Treat the returned Discord message ID or reaction confirmation as delivery evidence. Do not claim an action succeeded when the tool returned an error.

## Discord transport setup

1. Call `set_discord_connection` with only the non-secret application ID and server ID. Never ask the user to paste a bot token into chat or into an MCP tool.
2. Call `get_discord_transport_status` and give the user its exact `launchCommand`.
3. The user runs that command in a private local terminal and enters the token into the hidden prompt. The terminal must remain open while the bridge is in use.
4. Call `get_discord_transport_status` again. Report the authenticated bot, application, and server names; do not claim success from a saved ID alone.
5. Use `peek_discord_channel` only for a configured Active channel. A manual read of Lurk or Strict would bypass the intended visibility boundary and is deliberately rejected.

After installing or updating the plugin, start a new task before testing new tools. An already-open task may retain the older skill and MCP tool inventory even when the refreshed server and bridge work correctly when invoked directly.

The responsive SDK requires a local Codex task and a private local terminal on Windows or macOS. Use the PowerShell launcher on Windows and the shell launcher on macOS. A ChatGPT Work-only chat cannot run it; route Work-only users to `docs/CODEX_WORK_SETUP_HANDOFF.md`. When an install or update occurs, stop configuration in that task and have the human open another fresh local Codex task before continuing.

If returned messages have empty bodies, have the user enable Message Content Intent in the Discord Developer Portal and restart the bridge. The bot also needs View Channel and Read Message History permissions. Up to two bounded Discord-hosted image attachments may be returned as actual image content; attachment/link/embed metadata remains provenance, not proof that an external linked page was opened.

## Current pilot boundary

The bundled token-isolated bridge can authenticate, manually read configured Active channels, post in channels with `canSpeak`, react in channels with `canReact`, and provide acknowledged heartbeat batches for Active, Lurk, and Strict modes. Its polling pings wait for the next heartbeat and it may appear offline.

The separate `sdk` runtime connects to Discord Gateway, waits without inference, and starts a local Codex turn only after its persistent budget governor grants one. It keeps the token in the local process, uses a companion-authored identity packet rather than ChatGPT account memory, and revalidates every visible action at the host boundary. When choosing it, read `../../sdk/README.md` and `../../../../docs/SDK_SETUP_HANDOFF.md`; pause the polling Work heartbeat first unless dual operation is explicit.

Read [heartbeat.md](../../references/heartbeat.md) for cadence math and [channel-modes.md](../../references/channel-modes.md) for delivery semantics.
