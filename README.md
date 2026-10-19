# 📍 Directory

A minimal homelab directory for the family: learn what is available and open the
right link. The dashboard will be driven by one mounted YAML file.

## Current state

The bootstrap includes a server-rendered placeholder, a compiled shared config
package, and non-publishing CI definitions. The shared loader reads YAML, applies
defaults, expands environment values, and validates the TypeBox contract. The
standalone CLI uses that same loader. The web server loads an immutable directory
before serving, polls for file changes, and keeps the last good snapshot after
invalid edits. The shell shows configured site copy, not dashboard links.
Authentication is optional: shared credentials or OIDC protect the whole directory,
including data responses. Mounted image serving and the full dashboard remain
later work. See [authentication setup](docs/config.md#authentication-shapes).
See the [configuration contract](docs/config.md) and
[example](apps/web/config/directory.example.yml).

## Development

Use Node **26.5.0** and pnpm **11.9.0**, pinned in `mise.toml`:

```sh
pnpm install --frozen-lockfile
pnpm --filter @directory/web exec playwright install chromium
pnpm verify
CONFIG_PATH="$PWD/apps/web/config/directory.example.yml" pnpm dev
```

Open `http://localhost:5173`. The configured site title and description render
with JavaScript disabled, too. `/healthz` returns generic readiness. To try reloads,
point `CONFIG_PATH` at a disposable copy of the example and edit it; invalid saves
keep the previous copy serving. Linux prerequisites, shutdown and other commands
are documented in [development](docs/development.md).

Validate the example or your own configuration:

```sh
pnpm cli -- --help
pnpm cli -- validate apps/web/config/directory.example.yml
```

Validation returns 0 for a valid file and nonzero for unreadable or invalid input.
It checks environment references without printing configuration values. See
[configuration](docs/config.md) for paths, interpolation and safe errors, and
[agent instructions](AGENTS.md) for the review workflow.

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
checks, and scope limits.
