# 📍 Directory

A minimal homelab directory for the family: learn what is available and open the
right link. The dashboard will be driven by one mounted YAML file.

## Current state

The app includes a server-rendered directory, a compiled shared config
package, a standalone validator, and per-package CI checks. The shared loader reads YAML, applies
defaults, expands environment values, and validates the TypeBox contract. The
standalone CLI uses that same loader. The web server loads an immutable directory
before serving, polls for file changes, and keeps the last good snapshot after
invalid edits. Compact icon-and-title tiles flow into a responsive grid with muted
group headings, plain shareable details and real external service links.
The OS light/dark scheme selects the page surfaces. Existing
`appearance.primary_light_color` and `primary_dark_color` configure keyboard-focus
and Back-link underline accents on the directory, not sign-in. Choose colors with
sufficient contrast for your deployment; arbitrary configured colors are not
guaranteed accessible.
Authentication is optional: shared credentials or OIDC protect the whole directory,
including data responses. Bookmark cards and details use server-prepared bookmark
logos when no logo path is configured. With JavaScript, a failed configured bookmark
logo switches once to its prepared logo; a failed fallback stops without retrying.
Without JavaScript, broken configured images stay broken, but text and links remain
usable. After repairing an image at the same URL, refresh to try it again.
Optional `links.*.favicon_path` adds a decorative 24px icon to the details' Open
service link; omission shows no small icon. With JavaScript, failure switches once
to the same private prepared bookmark logo, independently of the 64px primary
`logo_path`; without JavaScript, a broken icon leaves the link usable. Service
icons stay private with auth and do not select the public site favicon.
The directory header shows `site.logo_path` at 48px beside its title and description,
using bundled `/favicon.svg` when omitted or once after a JavaScript image error.
Without JavaScript, a broken configured header image stays broken. With auth enabled,
the header image's source URL stays private; sign-in always uses the bundled mark
and exposes no configured site logo URI.
Configured images are now served only when
referenced by the captured configuration, with bounded 5 MiB reads and the same
authentication policy as the directory for mounted source URLs. Selecting
`site.favicon_path` publishes that image's bytes at the public `/favicon` alias,
including before sign-in; its source URI stays out of the shared layout. Omission
uses the bundled `/favicon.svg`; unavailable configured images return 404, not a
bundled fallback. Mounted files require Linux procfs; SVGs are trusted operator
content, not sanitized uploads. Search, modal details
and saved preferences remain later work. See [authentication setup](docs/config.md#authentication-shapes).
See the [configuration contract](docs/config.md) and
[production starter](apps/web/config/directory.example.yml). For the isolated,
local-only nine-bookmark review, see [the demo](demo/README.md).

## Run with Docker

Follow [local production review](docs/deployment.md#local-production-review) to
bootstrap the minimal, empty production starter without overwriting operator files.
It has open access and needs no session secret; enable authentication before
publishing. No host Node/pnpm is needed. For a populated local review instead,
follow [the isolated demo quickstart](demo/README.md).

## Development with Node

Use Node **26.5.0** and pnpm **11.9.0**, pinned in `mise.toml`:

```sh
pnpm install --frozen-lockfile
pnpm --filter @directory/web exec playwright install chromium
pnpm verify
CONFIG_PATH="$PWD/apps/web/config/directory.example.yml" pnpm dev
```

Run from the repository root and open `http://localhost:5173`. This starter is
empty and has no authentication. For the populated, authenticated preview that
leaves operator configuration and media untouched, use [demo/README.md](demo/README.md).
Groups, bookmark titles and `?link=<id>` details also render without JavaScript.
`/healthz` returns generic readiness. Invalid auth environment settings stop startup
with `auth_failed` and a fixed, value-free setting hint. Linux prerequisites,
reload checks and shutdown are documented in [development](docs/development.md).

Validate the production starter, isolated demo or your own configuration:

```sh
pnpm cli -- --help
pnpm cli -- validate apps/web/config/directory.example.yml
pnpm cli -- validate demo/config/directory.yaml
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
