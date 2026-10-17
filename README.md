# 📍 Where

A minimal homelab directory for the family: learn what is available and open the
right link. The dashboard will be driven by one mounted YAML file.

## Current state

The bootstrap includes a server-rendered placeholder, a compiled shared config
package, CLI help/error handling, and non-publishing CI definitions. The page and
CLI share the supported configuration format version. YAML schema validation and
loading, authentication, and dashboard links are not implemented yet.

## Development

Use Node **26.5.0** and pnpm **11.9.0**, pinned in `mise.toml`:

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
workflow.

## Continuous integration

[Woodpecker](.woodpecker/) and [GitHub Actions](.github/workflows/) each have
`config.yml`, `cli.yml`, and `web.yml`, following `when`'s per-package pattern.
Package-scoped checks use frozen installs; shared-package and root-tooling
changes trigger dependent pipelines. Web E2E reuses the matching Playwright
images. `pnpm verify` remains a local all-workspace convenience, not a pipeline.
No application image is published or deployed.

Each Woodpecker pipeline has one status-aware email step for main pushes, using `when`'s
notification secret names. Confirm those bindings and Gitea CI-image pull access
on the actual provider; a Gitea PR does not itself trigger GitHub Actions. See
[development](docs/development.md) for routing, safe secret setup, first-run
checks, and scope limits. YAML
schema/validation is the next PR, not part of this bootstrap.
