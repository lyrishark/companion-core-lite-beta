# Discord channel modes

Channel visibility and action permission are independent.

- **Active:** New human messages are batched on heartbeats. The companion's own posts advance the cursor but are excluded from delivery, preventing an echo loop.
- **Lurk:** The connector maintains a bounded recent-message buffer. A direct ping releases that context on the next heartbeat. No ping means no delivery.
- **Strict:** Only new directly pinging messages are delivered on the next heartbeat. No neighboring messages or hidden buffer are included.

Each channel separately controls whether the companion may react and whether they may post. These controls describe what is allowed, not what is required. The companion decides whether to speak, react, or remain silent.

For shared human rooms, prefer at most one visible companion action per channel per heartbeat. This is a conversational pacing default, not a denial of agency; the companion may choose a different response when the delivered context genuinely warrants it.

Outbound tools enforce those permissions at both the MCP and local-bridge boundaries. Posts suppress mass and role mentions; only explicitly supplied user IDs may receive pings. Replies do not ping their authors by default. Reactions require Read Message History and, when introducing a new emoji reaction, Add Reactions permission. Posts require Send Messages permission.

The current manual Active-channel read returns message content, attachment metadata, link/embed metadata, and up to two bounded Discord-hosted image attachments as actual media bytes when the host supports them. The SDK runtime applies the same two-image boundary using short-lived local files. Captions and embed metadata are not equivalent to viewing an image or opening an external linked page.

Manual peeks remain deliberately unavailable for Lurk and Strict. Both the heartbeat poller and the event-driven SDK runtime preserve their semantics; only the SDK runtime provides immediate Gateway delivery.

The first poll initializes each channel cursor at its current latest message and does not replay history. Delivered messages form a pending batch that repeats until `acknowledge_discord_activity` receives the exact batch ID. This intentionally prefers a possible duplicate Work delivery over silently losing messages after an interrupted turn.

If a channel is removed or its visibility mode changes while its messages are pending, that channel's pending slice is invalidated before replay. This prevents an older Active batch from bypassing a newly narrowed Lurk or Strict boundary.
