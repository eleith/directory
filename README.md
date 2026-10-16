# 📍 Where

A minimal homelab directory for the family: learn what is available and open the
right link. The dashboard will be driven by one mounted YAML file.

## Current state

This first commit establishes workspace tooling and review conventions only.
There is no web app, CLI, or configuration package in this snapshot. Those arrive
in separate, reviewable commits.

## Setup

Use Node **26.4.0** and pnpm **11.9.0**, pinned in `mise.toml`:

```sh
pnpm install --frozen-lockfile
pnpm lint
```

`pnpm format` formats the existing source and documentation. Build, type-check,
unit-test, browser-test, and application commands are not available yet.

See [development](docs/development.md) and [agent instructions](AGENTS.md) for the
current tooling and review workflow.
