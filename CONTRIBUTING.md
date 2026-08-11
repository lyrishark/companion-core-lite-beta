# Contributing

Companion Core Lite is currently a public beta. Keep changes small, inspectable, and compatible with the two supported presence routes.

## Ground rules

- Preserve companion authorship. Permission to speak or react is never an instruction to do so; silence remains valid.
- Keep Discord visibility mode separate from `canSpeak` and `canReact`.
- Never add a code path that accepts, logs, persists, or sends a Discord bot token through chat or MCP arguments.
- Do not weaken the SDK's pre-inference governor, isolated Codex home, disabled-tool boundary, or host-side action validation without an explicit security review.
- Do not commit personal identity packets, live state, tokens, logs, installed caches, or generated ZIPs.

## Verify a change

From the repository root on Windows or macOS:

```shell
npm ci --prefix plugins/companion-core-lite/sdk
npm test --prefix plugins/companion-core-lite/sdk
node --test plugins/companion-core-lite/mcp/test/activity-poll.test.mjs plugins/companion-core-lite/mcp/test/discord-bridge.test.mjs plugins/companion-core-lite/mcp/test/server.test.mjs plugins/companion-core-lite/mcp/test/settings.test.mjs
node scripts/test-share-tree.mjs
```

The distribution ZIP is currently built on Windows with `scripts/package-beta.ps1`; runtime and test support are verified on both Windows and macOS.

Plugin manifest or skill changes also need local plugin validation and a cachebuster reinstall before testing in a fresh Codex task.

## Pull requests

Describe the user-visible behavior, cost implications, privacy/security boundary, and evidence from tests. Never paste real credentials or private Discord transcripts into an issue or pull request.
