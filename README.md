# 📍 Where

A minimal homelab directory for the family: learn what is available and open the
right link. The dashboard will be driven by one mounted YAML file.

## Current state

This snapshot adds a standalone, server-rendered placeholder web app and its
quality checks. It does not load YAML, authenticate visitors, or render dashboard
links. The shared configuration package and CLI arrive in later commits.

## Development

Use Node **26.4.0** and pnpm **11.9.0**, pinned in `mise.toml`:

```sh
pnpm install --frozen-lockfile
pnpm --filter @where/web exec playwright install chromium
pnpm verify
pnpm dev
```

Open `http://localhost:5173`. The placeholder should render with JavaScript
disabled, too. Linux browser prerequisites and other commands are documented in
[development](docs/development.md).

See [agent instructions](AGENTS.md) for the review workflow. CI and publishing
are not part of this snapshot.
