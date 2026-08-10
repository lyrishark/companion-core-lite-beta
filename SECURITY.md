# Security policy

Companion Core Lite handles untrusted Discord content near a locally authenticated Codex runtime. Treat security and privacy regressions as release blockers.

## Report privately

For a GitHub-hosted repository, use a private security advisory rather than a public issue when a report could expose credentials, bypass channel boundaries, escape SDK tool isolation, produce unauthorized Discord actions, or reveal companion continuity data.

Do not include a live Discord bot token, Codex authentication file, private transcript, or personal identity packet in the report. Use redacted reproduction data.

## If a token may have leaked

1. Reset the bot token immediately in the Discord Developer Portal.
2. Stop the local bridge or SDK runtime.
3. Remove any leaked artifact from the sharing surface and its history where possible.
4. Review configured channel permissions and recent bot actions before reconnecting.

## Supported beta

Only the newest packaged private-beta build is supported. This project has not received an independent security audit. The local isolation and validation controls are defense in depth, not a guarantee that prompt injection is impossible.
