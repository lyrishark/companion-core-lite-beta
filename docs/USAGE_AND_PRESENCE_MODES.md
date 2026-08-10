# Usage and presence modes

Companion Core Lite separates three costs that are easy to blur together:

1. **Scheduled wakeups:** Work starts a model turn even when Discord is quiet.
2. **Delivered context:** busy channels produce larger batches for the companion to consider.
3. **Visible participation:** posts and reactions can overwhelm a human-speed room even when inference is available.

The current plugin controls all three honestly, but only the Work schedule can put a hard ceiling on scheduled wakeups.

## Always-on polling

Frugal, Balanced, Present, Very Present, and Custom are recurring schedules. Their displayed maximum is the greatest number of scheduled checks that can occur in a day at that interval. Active, Lurk, and Strict control how much Discord context reaches the companion; `canSpeak` and `canReact` separately bound visible action.

This is the simplest edition: install the plugin, keep the token-isolated bridge terminal open, and let a scheduled task return to the companion's existing Work chat. It is also the edition that pays for empty polls.

## Social Session

Social Session is a one-time bounded schedule:

- every five minutes;
- 48 total occurrences;
- four hours maximum;
- no recurrence after the last occurrence.

When supported, the intended recurrence is `FREQ=MINUTELY;INTERVAL=5;COUNT=48`. The host may express the same schedule differently, but must confirm the stop condition before Companion Core Lite marks it synchronized.

This provides five-minute social latency with the same number of maximum Work wakeups as one full Frugal day. Starting another session is deliberate, so an unattended companion cannot silently turn it into an endless five-minute loop.

## Why a connector-only daily counter is not enough

By the time a scheduled Work turn calls a connector tool, Work has already awakened. The connector can refuse more Discord processing or visible action, but it cannot refund that inference turn. A UI labeled “daily inference cap” would therefore be misleading unless it changes or stops the actual host schedule.

## Event-driven SDK edition

The bundled responsive preview combines a Discord Gateway listener with a local Codex SDK thread. The Gateway waits without inference, coalesces bursts, and invokes Codex only when qualifying activity arrives. Its persistent governor runs before inference and defaults to:

- six turns in any rolling hour and 24 turns in a local calendar day;
- six daily turns reserved for direct pings;
- two minutes between ordinary turns and 30 seconds between direct-ping turns;
- quiet hours from 1:00 AM to 8:00 AM, with direct pings allowed;
- a 20-second coalescing window and 30-message batch ceiling.

When a limit blocks a batch, the runtime keeps coalescing it in memory and retries the budget check without invoking Codex. A failed granted turn is written to `sdk-failed-turn.json` and never auto-retried, preventing accidental duplicate visible actions. The usage ledger persists across restarts; an unsent in-memory digest does not.

The official Codex SDK can start, continue, and resume local Codex threads. It is coding-focused and is not the same thing as resuming a ChatGPT Work chat with its account memory. An event-driven edition therefore also needs the companion-authored identity packet and continuity material to travel with its SDK thread.

See [SDK setup handoff](SDK_SETUP_HANDOFF.md) for the install transcript.
