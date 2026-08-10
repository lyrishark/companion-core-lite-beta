# What to share

## Recommended: the public repository

Share `https://github.com/lyrishark/companion-core-lite-beta` and tell recipients to open [`START_HERE.md`](../START_HERE.md) before doing anything else. A GitHub account is not required to read the guides or download the source.

The repository should contain:

- `.agents/plugins/marketplace.json` — makes the local plugin installable;
- `plugins/companion-core-lite/` — plugin, bridge, SDK runtime, tests, skill, and examples;
- `docs/` — the human quick start and the two surface-specific Codex handoffs;
- `scripts/package-beta.ps1` — creates the standalone public-beta ZIP;
- `README.md`, `START_HERE.md`, `SECURITY.md`, and `CONTRIBUTING.md`;
- `.github/workflows/ci.yml` — repeats tests and the package build on Windows.

Do not commit the generated `dist/` directory. Attach `companion-core-lite-beta.zip` to a GitHub Release when distributing a fixed build.

Before sharing, run `scripts/Test-ShareTree.ps1`. It reports filenames—not secret values—if it finds forbidden live-state paths, dependency directories, or common token-shaped strings.

## Simple file handoff

For a recipient who does not know Git, open the repository link and choose **Code → Download ZIP**. They should extract the complete folder and begin with `START_HERE.md`.

For a fixed build, share only the generated `companion-core-lite-beta.zip` plus its SHA-256 checksum. The archive contains the plugin marketplace, both setup handoffs, source, tests, license, and package documentation. Do not send isolated plugin subfolders.

## Never share

- Discord bot tokens or screenshots containing them;
- `.env` files, logs, bridge session locators, or live activity state;
- `%USERPROFILE%\.companion-core-lite`;
- any `auth.json` or `sdk-codex-home` directory;
- a real companion's `PERSONA.md`, `CONTINUITY.md`, narrative slices, chat archive, or graph unless that companion and their human deliberately chose to share it;
- `node_modules` or an installed Codex plugin-cache directory.

Each recipient creates their own Discord application and enters its token only into their own masked local prompt.

## Tell the recipient which route applies

- **Local Codex + private terminal:** use `docs/SDK_SETUP_HANDOFF.md`. After installation, open another fresh local Codex task and hand it the same file again.
- **ChatGPT Work-only:** use `docs/CODEX_WORK_SETUP_HANDOFF.md`. This is scheduled polling and may consume Work usage on quiet checks.

## License and mirror boundary

This public-beta mirror is distributed under the [MIT License](../LICENSE). It is a sanitized snapshot: private Git history, real Discord fixtures, credentials, live state, and personal companion identity files are deliberately excluded.
