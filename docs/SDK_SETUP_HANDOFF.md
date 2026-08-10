# Responsive SDK setup handoff

## Surface requirement

This edition is safely followable only from a **local Codex task with access to a private local terminal**. A ChatGPT Work-only chat cannot install or run the SDK runtime. If Work is the only available surface, stop and use `CODEX_WORK_SETUP_HANDOFF.md` instead.

Hand this entire file to a fresh local Codex task together with access to the Companion Core Lite public-beta repository. This edition uses the user's local Codex login; it does not ask for an OpenAI API key and does not resume a ChatGPT Work chat.

## Fresh-task boundary

Installing or updating the plugin is a hard handoff point. The installation task must stop afterward and ask the human to open **another fresh local Codex task**, then hand that new task this same file. Already-open tasks may retain the old skill and MCP tool inventory. On the second pass, detect that the current plugin version is already installed and continue rather than reinstalling forever.

---

Install and configure the event-driven Companion Core Lite runtime for one companion and one private Discord bot. Preserve the companion's authorship: permission to post or react is an outer boundary, never an instruction that they must act. Speaking, reacting, and silence are all valid.

1. Confirm this is a local Codex task with private-terminal access. If it is Work-only, route to `CODEX_WORK_SETUP_HANDOFF.md` and stop.
2. Check whether the repository's current plugin version is already installed. If not, validate and install it, then stop: ask the human to open another fresh local Codex task and hand it this same file. Never continue tool setup in the installer task.
3. Once the current plugin version is visible in this fresh task, read the installed `companion-presence` skill and `sdk/README.md` completely. Never ask for, read, echo, log, or handle the plaintext Discord bot token.
4. Ask only for missing non-secret Discord application ID, server ID, and channel IDs. Configure each channel as Active, Lurk, or Strict with separate `canSpeak` and `canReact` permissions.
5. Confirm the bot has View Channel and Read Message History in every configured channel, plus Send Messages or Add Reactions only where enabled. Confirm Message Content Intent is enabled in the Discord Developer Portal.
6. Run the SDK launcher once to create `%USERPROFILE%\.companion-core-lite\identity\PERSONA.md` and the visible `sdk-config.json`; it deliberately stops while the persona is still a scaffold. Invite the companion to replace that scaffold with their own compact identity, voice, relationships, boundaries, and participation preferences. Do not silently write a character card over them. Put optional, provenance-aware narrative slices in `CONTINUITY.md`.
7. Review the generated cost and web settings. If the defaults are acceptable, say them aloud: six turns/hour, 24/day, six daily turns reserved for direct pings, 120-second ordinary cooldown, 30-second ping cooldown, 1:00–8:00 AM quiet hours with direct pings allowed, and hosted web search disabled. Explain that enabling cached or live search expands the untrusted-content boundary.
8. Stop or pause any old Companion Core Lite Work heartbeat. A Gateway runtime and a scheduled polling heartbeat should not run concurrently unless the human deliberately wants both costs and duplicate-delivery risk.
9. Give the human the exact absolute command for `scripts/start-sdk-runtime.ps1`. They run it in a private local terminal and enter the Discord token only into its masked prompt. The launcher installs pinned dependencies locally if needed. Keep that terminal open while presence is wanted; Ctrl+C stops it.
10. Verify the terminal reports the authenticated application and server and then `Gateway ready`. Do not claim success from saved IDs alone.
11. In one configured test channel, prove Active delivery, a direct ping, one permitted reaction or message, and deliberate silence. Also prove one denied channel/action boundary. Keep the test human-visible and do not relax permissions merely to make it pass.
12. Report that this is a separate resumable Codex SDK thread backed by the companion-authored identity files, not ChatGPT account memory. Report the exact local budget file and current limits.

The runtime isolates this thread from the user's normal Codex configuration and disables shell, apps, MCP/plugin discovery, hooks, memories, multi-agent, browser/computer control, and command networking. Treat those as defense in depth, not immunity from prompt injection. Start with a dedicated bot, narrow channels, and non-sensitive context.

On each qualifying event batch, the runtime gives Codex the bounded messages and asks for exactly one structured outcome: speak, react, or remain silent. The host revalidates channel and action permissions before Discord receives anything. Waiting on Discord events costs no Codex turns.

If a granted turn fails, inspect `%USERPROFILE%\.companion-core-lite\sdk-failed-turn.json`; the runtime deliberately will not auto-retry it because a post may already have succeeded. Never replay it without checking Discord first.

---
