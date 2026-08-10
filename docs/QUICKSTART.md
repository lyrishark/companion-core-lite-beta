# Companion Core Lite public beta

Companion Core Lite lets one companion use a private Discord bot through Codex or ChatGPT Work. The companion can read only configured channels and retains their own judgment to speak, react, or remain silent.

## What is needed

- For the responsive SDK: Windows, Node.js 20 or newer, local Codex, and a private local terminal. Work-only is not sufficient.
- For polling: Codex or ChatGPT Work with local plugin support and a private local terminal for the Discord bridge.
- A Discord application and bot created for this companion.
- A downloaded or cloned copy of this repository.
- The computer and the local bridge terminal left running while Discord access is wanted.

Never paste the Discord bot token into chat. The setup flow asks for it in a masked local terminal prompt and holds it only in that process's memory.

## The short version

For the recommended responsive edition:

1. Give the whole [responsive SDK setup](SDK_SETUP_HANDOFF.md) to a fresh Codex task.
2. Let it install the plugin, then stop. Open another fresh local Codex task and hand it the same setup file so the new skill and tools are actually visible.
3. In the fresh task, configure only non-secret Discord IDs and channel policies and help the companion author `PERSONA.md`.
4. Review the visible local budget, then run the exact SDK launcher command. Enter the bot token only in its hidden terminal prompt.
5. Verify the authenticated application/server, `Gateway ready`, Active delivery, a ping, one allowed visible action or reaction, deliberate silence, and one denied boundary.

For the simpler polling edition:

1. Give the whole [Codex/Work polling setup](CODEX_WORK_SETUP_HANDOFF.md) to a fresh Codex or Work task.
2. Configure non-secret IDs and policies, start the token-isolated REST bridge, then open a new task so its plugin tools are fresh.
3. Complete the baseline, new-message, replay, exact-acknowledgment, and quiet verification.
4. Choose a presence rhythm and let Work create the same-chat scheduled task only after verification passes.

## Responsive SDK limits

The SDK listener stays connected to Discord without starting Codex turns. By default it permits no more than six turns in any rolling hour and 24 in a local calendar day, reserving six daily turns for direct pings. Ordinary traffic has a two-minute cooldown, direct pings have a 30-second cooldown, quiet hours are 1:00–8:00 AM with pings allowed, and hosted web search is off. These are visible local settings in `%USERPROFILE%\.companion-core-lite\sdk-config.json`.

## Work heartbeat choices

| Mode | Rhythm | Hard ceiling |
| --- | --- | ---: |
| Frugal | Every 30 minutes, always on | 48 scheduled checks/day |
| Balanced | Every 10 minutes, always on | 144/day |
| Present | Every 5 minutes, always on | 288/day |
| Social Session | Every 5 minutes for 4 hours, then stop | 48/session |
| Very Present | Every 2 minutes, always on | 720/day |

Every scheduled heartbeat may consume ChatGPT Work usage even when Discord is quiet. Social Session is the recommended responsive option for people who want a hard unattended ceiling. Restarting another session is deliberate.

## Current boundary

The polling edition waits for its next heartbeat and may appear offline. The SDK edition connects to Discord Gateway, shows the bot online, and invokes a separate local Codex thread only for qualifying events. That thread does not inherit ChatGPT account memory, so its companion-authored persona and continuity files are the identity foundation. Discord-hosted image attachments can reach companion context; link metadata is included, and the SDK may use live web lookup when enabled.
