# Codex/Work setup handoff

Hand this entire file to a fresh Codex or ChatGPT Work task together with access to the Companion Core Lite public-beta repository.

This is the polling edition. For responsive Gateway presence without empty Work wakeups, use [SDK_SETUP_HANDOFF.md](SDK_SETUP_HANDOFF.md) instead.

---

Install and configure Companion Core Lite for one companion and one private Discord bot. Preserve the companion's authorship: permission to post or react is an outer boundary, never an instruction that they must act. Speaking, reacting, and silence are all valid.

1. Read the plugin's `companion-presence` skill completely and follow it.
2. Validate and install the repository marketplace plugin. Do not ask for or handle a plaintext Discord bot token.
3. Ask only for missing non-secret identifiers: Discord application ID, server ID, and channel IDs.
4. For every channel, ask the human to choose Active, Lurk, or Strict and separate `canSpeak` and `canReact` permissions.
5. Configure the IDs, call `get_discord_transport_status`, and give the human its exact launcher command.
6. Have the human run that command in a private local terminal and enter the token into its masked prompt. The terminal stays open.
7. Confirm the authenticated bot, application, and server names from the live transport. A saved ID is not proof of connection.
8. If this plugin was just installed or updated, stop and have the human open a fresh task before testing new tools.
9. Manually prove the heartbeat transaction: establish the no-history baseline; have a human post one new message; poll and record its `batchId`; poll again before acknowledging and verify the exact pending batch replays; acknowledge that exact ID only after the companion made a speak/react/silence judgment; poll once more and verify quiet.
10. Call `get_heartbeat_settings` before choosing a schedule. Repeat the preset, interval, hard maximum for its stated period, and this notice: every scheduled heartbeat may consume ChatGPT Work usage even when Discord is quiet.
11. Recommend Social Session when the human wants responsive presence with a hard unattended ceiling. It is every five minutes for four hours, exactly 48 maximum scheduled runs, then stop. Confirm the Work task contains `COUNT=48` or an equivalent host-confirmed stop condition. An endless five-minute task is Present, not Social Session.
12. Create the scheduled task inside the existing companion chat so each run returns to that chat and its context. Use the exact `scheduleInstruction` returned by the plugin.
13. Call `confirm_heartbeat_schedule` only after Work confirms the real schedule and, for Social Session, its stop condition.

On each heartbeat, poll once. If a batch arrives, review it and let the companion decide whether to speak, react, or remain silent. Prefer at most one human-sized visible action per channel for that run. Acknowledge the exact batch only after judgment is complete. If the poll is quiet, take no Discord action.

Never claim that a plugin-side action cap saves a Work wakeup that already occurred. Never infer plan pricing or promise how a subscription accounts for scheduled usage.

---
