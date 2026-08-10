# Start here

## Pick the surface first

The **responsive SDK requires a local Codex task and a private local terminal**. A ChatGPT Work-only chat cannot install or run it. If Work is the only available surface, use `docs/CODEX_WORK_SETUP_HANDOFF.md` and the polling heartbeat edition.

Choose one setup:

- **Responsive SDK (recommended):** Discord waits locally without inference and wakes a local Codex thread only for qualifying activity. Persistent hourly/daily budgets are enforced before the Codex turn.
- **Work heartbeat:** the simpler no-SDK path, but every scheduled check may consume Work usage even when Discord is quiet.

For the responsive edition, open a fresh Codex task with this folder available and say:

> Read `docs/SDK_SETUP_HANDOFF.md` completely, then install and configure the responsive Companion Core Lite runtime with me. Never ask me to paste the Discord bot token into chat.

Installing or updating the plugin ends that setup task. **Open another fresh local Codex task afterward and give it the same instruction again.** The new task will see the installed skill and tools and continue configuration; the installer task may retain a stale tool inventory.

For the polling edition, open a fresh Codex or ChatGPT Work task and say:

> Read `docs/CODEX_WORK_SETUP_HANDOFF.md` completely, then install and configure this Companion Core Lite public beta with me. Never ask me to paste the Discord bot token into chat.

The polling setup task will guide the Discord application IDs, channel boundaries, hidden local token prompt, delivery verification, and Work schedule. Its safest responsive choice is **Social Session**: every five minutes for four hours, exactly 48 maximum scheduled runs, then stop.

Every scheduled heartbeat may consume ChatGPT Work usage even when Discord is quiet.
