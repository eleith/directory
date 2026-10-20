# 📍 Directory

A minimal homelab directory for the family: learn what is available and open the
right link. The dashboard will be driven by one mounted YAML file.

## Current state

The bootstrap includes a server-rendered placeholder, a compiled shared config
package, and per-package CI checks. The shared loader reads YAML, applies
defaults, expands environment values, and validates the TypeBox contract. The
standalone CLI uses that same loader. The web server loads an immutable directory
before serving, polls for file changes, and keeps the last good snapshot after
invalid edits. The shell shows configured site copy, not dashboard links.
Authentication is optional: shared credentials or OIDC protect the whole directory,
including data responses. Mounted image serving and the full dashboard remain
later work. See [authentication setup](docs/config.md#authentication-shapes).
See the [configuration contract](docs/config.md) and
[example](apps/web/config/directory.example.yml).

## Run with Docker

From a checkout, without host Node/pnpm:

```sh
cd apps/web
test -e .env || cp .env.example .env
test -e config/directory.yaml || cp config/directory.example.yml config/directory.yaml
mkdir -p public
docker compose up --build --pull never
```

Open **http://localhost:3000**. See [Docker and Compose](docs/deployment.md) for
development containers, authentication, HTTPS, published images and manual checks.
Existing operator files are preserved; the example starts without auth.

## Development with Node

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
Main builds publish Linux amd64 `latest` images to the confirmed Gitea and GHCR
registries after web/E2E and schema/config/CLI gates. Qualified stable web tags
publish versioned images after the same gates; PRs do not publish. Automatic
deployment is not included.

Each Woodpecker pipeline has one status-aware email step for main pushes, using `when`'s
notification secret names. Confirm those bindings, publishing authorization and Gitea CI-image pull access
on the actual provider; a Gitea PR does not itself trigger GitHub Actions. See
[development](docs/development.md) for routing, safe secret setup, first-run
checks, and scope limits.

## Releases

Changesets records app changes; the private web and CLI apps version together.
Versioning, release commits and tag pushes are manual and require owner review
and authorization. Only stable `@directory/web@<version>` tags publish versioned
images; `latest` remains main-only. See the
[release workflow](docs/development.md#manual-app-releases).
