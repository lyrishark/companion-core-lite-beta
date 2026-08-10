# Heartbeat model

The Work heartbeat is a scheduled task that wakes the companion's existing chat and asks the connector whether anything is waiting. Discord cannot independently wake that Work chat. The separate SDK runtime can receive Gateway events without a Work heartbeat, but it uses its own local Codex thread.

| Preset | Interval | Hard schedule ceiling |
| --- | ---: | ---: |
| Off | None | 0 |
| Frugal | 30 minutes, recurring | 48/day |
| Balanced | 10 minutes, recurring | 144/day |
| Present | 5 minutes, recurring | 288/day |
| Social Session | 5 minutes for 4 hours | 48/session, then stop |
| Very Present | 2 minutes, recurring | 720/day |
| Custom | 1-1,440 minutes, recurring | ceiling(1,440 / interval)/day |

These are frequency counts, not prices. A scheduled heartbeat may use Work capacity even when no Discord messages are returned.

Social Session is the safest responsive Work-only mode. Its task must start now, run every five minutes, and stop after 48 occurrences (four hours). `FREQ=MINUTELY;INTERVAL=5;COUNT=48` is the intended RFC 5545 recurrence shape when the host accepts an RRULE. The host must confirm an equivalent stop condition before the plugin marks it synchronized. Restarting another session is a deliberate human choice.

The polling ceiling must live in the Work schedule. Once Work has awakened, a plugin tool can shorten or refuse work but cannot retroactively save that inference wakeup. The bundled event-driven runtime instead uses a Discord Gateway listener and persistent governor before invoking its separate SDK thread.

Saving the plugin preference does not prove the Work scheduled task changed. `schedulerSyncRequired` remains true until the host confirms the task update and the companion calls `confirm_heartbeat_schedule`.

Do not start the Work scheduled task while Discord transport is disconnected or `heartbeatDeliveryStatus` is not `ready`. Before scheduling, manually prove baseline, new-message delivery, pending-batch replay, acknowledgment, and the following quiet poll.

Each scheduled run should call `poll_discord_activity`. A returned batch must reach companion context, receive a speak/react/silence judgment, and then be acknowledged with its exact ID. A batch remains pending until acknowledgment. Quiet polls need no Discord action.
