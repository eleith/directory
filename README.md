# 📍 Where

A minimal homelab directory for the family: learn what is available and open the
right link. The dashboard will be driven by one mounted YAML file.

## Current state

This snapshot wires a compiled `@where/config` package into the server-rendered
placeholder. The page displays its supported configuration format version. This
is package plumbing only: no YAML schema/loading/validation, authentication,
dashboard links, or CLI is implemented yet.

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
