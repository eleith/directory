# 📍 Where

A minimal homelab directory for the family: learn what is available and open the
right link. The dashboard will be driven by one mounted YAML file.

## Current state

This snapshot adds CLI help and honest unsupported-command errors alongside the
compiled config package and server-rendered placeholder. The page and CLI share
the supported configuration format version. YAML schema/loading/validation,
authentication, and dashboard links are not implemented yet.

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

The CLI currently supports help only:

```sh
pnpm cli -- --help
```

Unsupported commands, including `validate`, exit nonzero rather than pretending
to validate configuration. See [agent instructions](AGENTS.md) for the review
workflow. CI and publishing are not part of this snapshot.
