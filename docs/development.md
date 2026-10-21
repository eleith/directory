# Development

## Current scope

The bootstrap contains all three workspaces, local quality gates, and per-package
Woodpecker/GitHub workflow definitions. CLI help and the SSR directory read the
same supported configuration format version. The TypeBox schema, inferred types
and deterministic editor-schema generation are implemented, along with YAML
loading, environment interpolation and standalone CLI validation; see
[configuration](config.md). The web server now loads before serving, polls the
configuration path, and captures one immutable snapshot per request. The shell
renders configured groups, bookmark titles and plain details with external service
links. Cards and details use server-prepared bookmark logos when no logo path is
configured. Configured image files now serve through exact captured snapshot
references, not an arbitrary static directory. Optional credentials or OIDC authentication gates the entire directory;
no-auth mode stays open and requires no session secret. [Docker and Compose](deployment.md)
provide dev/production containers, main `latest` images and manually tagged
stable releases.

## Toolchain

`mise.toml` pins Node **26.5.0** and pnpm **11.9.0**. The shared catalog pins direct
dependencies exactly, including:

| Tool                              | Version         |
| --------------------------------- | --------------- |
| SvelteKit / Svelte                | 2.70.1 / 5.56.0 |
| adapter-node / Svelte Vite plugin | 5.5.4 / 7.1.2   |
| Vite / TypeScript                 | 8.0.16 / 6.0.3  |
| ESLint / typescript-eslint        | 10.4.1 / 8.60.0 |
| eslint-plugin-svelte              | 3.18.0          |
| Prettier / prettier-plugin-svelte | 3.8.3 / 3.5.2   |
| Vitest / coverage-v8              | 4.1.7 / 4.1.7   |
| Playwright                        | 1.61.1          |
| Changesets CLI                    | 3.0.1           |

Published peer ranges support this combination. `@types/node` 24.12.4 satisfies
Vite/Vitest's peer ranges; it does not describe every Node 26 API. The base ESLint
configuration now loads Svelte template rules and the actual web configuration.
Do not use SvelteKit 3 configuration APIs with this pinned Kit 2 stack.

## Setup and commands

```sh
pnpm install --frozen-lockfile
pnpm --filter @directory/web exec playwright install chromium
pnpm verify
```

On Linux, Playwright may also need system libraries. On a machine where you
control system package installation, its `install --with-deps chromium` command
installs them; do not use it to bypass sandbox restrictions. Install the Chromium
revision matching the pinned Playwright version after changing that dependency.

| Command                                      | What it does                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm build`                                 | Builds config, then CLI and the adapter-node production server.                |
| `pnpm check`                                 | Checks config/CLI TypeScript plus web Svelte/TypeScript diagnostics.           |
| `pnpm lint` / `pnpm format`                  | Checks or writes root/workspace Prettier formatting; lint also runs ESLint.    |
| `pnpm test` / `pnpm test:coverage`           | Runs all workspace unit/artifact tests, with diagnostic coverage.              |
| `pnpm test:e2e`                              | Runs Chromium against the existing production build.                           |
| `pnpm schema:generate` / `pnpm schema:check` | Generates editor JSON / checks drift without writing, before any build.        |
| `pnpm verify`                                | Checks schema drift, builds, checks types/lint, runs coverage tests, then E2E. |
| `pnpm dev`                                   | Builds config, then starts Vite on `127.0.0.1:5173`.                           |

`pnpm build:packages` rebuilds just shared output. Package exports deliberately
resolve `dist/index.js` and `dist/index.d.ts`, with no source aliases or custom
loader. `@directory/config/types` is a type-only entry; the schema JSON is exported
separately. Schema generation compiles fresh source into disposable output and
never relies on an existing `dist`. Build before independent workspace
checks/tests; `pnpm verify` does this in order.
After editing config source during development, rebuild shared output to make it
visible to Vite; there is no automatic config-source compiler/watch process.
The config package pins YAML **2.9.1**. The CLI uses **Gunshi 0.35.1** for
commands, arguments and generated help, matching When. It uses catalog-pinned esbuild
**0.28.2** for its Node bundle; dependency install scripts are disabled for
esbuild because the platform binary ships as an optional dependency.

The web server needs configuration at runtime, not at build time. From the
repository root, preview the isolated demo without creating or modifying
operator configuration or copying images:

```sh
CONFIG_PATH="$PWD/demo/config/directory.yaml" \
  DIRECTORY_PUBLIC_DIR="$PWD/demo/public" \
  AUTH_SECRET="$(openssl rand -base64 32)" \
  ORIGIN=http://localhost:5173 AUTH_URL=http://localhost:5173 pnpm dev
```

Open **http://localhost:5173**. See [the demo quickstart](../demo/README.md) for
local-only credentials, manual preview scope and production preview. This command uses
real authentication with a fresh ephemeral secret, not an auth bypass. Mounted
image reads require Linux procfs. The explicit public root overrides any operator
environment value; by default this demo config also resolves to `demo/public`.
The separate `apps/web/config/directory.example.yml` starter is empty and open,
requires no session secret, and must have authentication added before publishing.

`pnpm dev` runs Vite from `apps/web`, so its default path is
`apps/web/config/directory.yaml`. Absolute `CONFIG_PATH` and `DIRECTORY_PUBLIC_DIR`
values avoid working-directory ambiguity. An existing active configuration stays
unchanged with the command above. Back it up yourself before explicitly choosing
to replace it with a demo copy; setup must never automatically overwrite it.
Auth changes require a process restart, not just waiting for the file poll.
Use HTTPS or `http://localhost:5173`, never an HTTP IP address with auth enabled;
update both `ORIGIN` and `AUTH_URL` if the port changes. See
[authentication setup](config.md#authentication-shapes) and
[Compose setup](deployment.md#local-production-review) for stable secrets and
manual, non-overwriting asset copying.

### CLI validation

```sh
pnpm cli -- --help
pnpm cli -- validate apps/web/config/directory.example.yml
pnpm cli -- validate demo/config/directory.yaml
```

The root command builds shared config and the CLI, then runs its compiled Node
entrypoint. The wrapper also emits build logs; the following stream guarantees
refer to the compiled CLI itself:

- Help returns 0 on stdout without loading configuration.
- `directory validate [path]` returns 0 on stdout for a valid file, otherwise 1 on
  stderr. It checks the actual environment, with no weaker structure-only mode.
- Missing commands, unknown options and extra paths return 1 on stderr. Exactly
  one leading `--` is accepted for package-manager forwarding; repeated or
  mid-command separators are rejected. Gunshi handles help in its normal flag
  positions, including after a path, without loading configuration.
- Output contains no configuration values, filenames or parser snippets. See
  [configuration](config.md) for paths, interpolation and safe error codes.

The package's build command runs TypeScript and esbuild directly, following
When's pattern. It cleans `dist`, emits declarations, and bundles `index.js` and
the side-effect-free `cli.js`. Only Node built-ins remain external. The
executable keeps its shebang and executable mode; it needs no source, workspace
resolution or `node_modules` at runtime. `runCli` is async and accepts injected
output sinks and an optional environment map.

Artifact tests copy only those two bundles outside the workspace, run from that
temporary directory, and compare acceptance/errors with the shared loader. They
cover configuration paths, auth/environment failures, secret sentinels, help,
arguments and API import without executing main. Config compiled-module and CLI
subprocess tests do not contribute to source coverage; passing them is not a
claim of full source coverage.

### Prepared configuration snapshots

`prepareSnapshot` in `apps/web/src/lib/server/config/snapshot.ts` clones the
validated private configuration, creates the display model and exact referenced
asset lists and bookmark logos, then freezes the complete snapshot.
`getBookmarkLogos` in `bookmark-logos.ts` currently renders SVGs with the internal
Initials style. SVG strings stay in the private, frozen `assets.bookmarkLogos` map
for every link, including those with configured logos. Display links carry one
required `logo_path`, resolved to the configured path or `/bookmarks/<id>/logo`.
This logo API remains available for every bookmark; the display uses it only when
`logo_path` is omitted. Configured paths now reach the mounted-image endpoint.
Only the snapshot's `display` member may be sent to the browser. The client-facing
interfaces in `src/lib/display/types.ts` contain no server imports. Snapshot IDs are fresh random UUIDs, not hashes of
configuration or credentials.

`prepareDirectory` builds the browser data through `getSite(config)` and
`getGroups(config)`. These helpers select public fields, prepare comma-split tag
labels, and group/order links. Alphabetical ordering uses an English,
base-sensitive, numeric collator on the server, preserving declaration-order ties.
Group identities keep a configured Other separate from the missing-group bucket.

`loadDirectory(path?, { env, report }?)` in
`apps/web/src/lib/server/config/load-directory.ts` loads and prepares the first
snapshot before returning a directory object:

```ts
const directory = await loadDirectory(path, { report });
const captured = directory.currentSnapshot();
await directory.reload();
directory.stop();
```

- `currentSnapshot()` returns a complete immutable snapshot. Replacements change
  one private reference; earlier captures keep their complete version.
- `reload()` runs one attempt at a time. Requests during loading or preparation
  coalesce into one follow-up. Load/preparation failures retain the current
  snapshot and report a safe issue. Auth differences from the initial snapshot
  report `restart_required` and reject the entire candidate, including display
  edits. Restoring the original auth permits later display reloads.
- `stop()` is terminal. It clears pending work and prevents later publication or
  reporting, without claiming to cancel I/O already in progress.

Startup failure rejects with a redacted `DirectoryError`; no directory object is
returned. There is no separate `start()` or public publisher. The config package
only loads and validates configuration.

### Web startup and file polling

The Kit `init` hook skips build analysis, then chooses separate production or
development startup functions. Both use the shared `bootApp` function; production
startup finishes before adapter-node opens a socket. Compilation needs no mounted
YAML or credentials. Startup errors stay fatal and are reported without raw error
values. Enabled auth requires a random 32+ character `AUTH_SECRET` and matching
root `ORIGIN`/`AUTH_URL` with no trailing slash. Authenticated deployments use
HTTPS; HTTP is supported only on `localhost` for local development. Missing or inconsistent auth settings
report `auth_failed` followed by a fixed hint naming the failing environment
variable and its requirement, without values or raw error details. Unknown auth
initialization failures report only `auth_failed`. No mode falls back to open
access after an auth failure.

Only a valid startup installs `watchConfig`, a non-persistent one-second path
poll. Inode, modification-time or size changes request a serialized reload;
editor atomic rename saves and deletion/recreation keep working. Boot requests
one additional reload after watcher installation to catch saves during setup.
Invalid later edits keep the last good snapshot and generic health readiness.

The request hook captures `directory.currentSnapshot()` once into
`event.locals.snapshot`; nested loaders use that reference even if a reload
publishes meanwhile. Boot resolves the public root once through the existing
`resolvePublicDir` helper, using the same selected config path and environment as
configuration loading. The application captures it as `event.locals.publicDir`;
it never enters page data. Missing roots or files do not prevent startup. The page returns only the captured display model, a validated selected-link
identity and a signed-in boolean after the access gate. Private configuration,
assets, sessions and filesystem paths are not page data.
`/healthz` returns only `{ "status": "ok" }` after initialization. Requests do not
load YAML or regenerate bookmark logos. Shutdown stops the watcher and blocks pending
publication. Polling/config preparation are not browser code.

Production lifecycle handling uses adapter-node's `sveltekit:shutdown` event.
Development lifecycle handling separately owns replacement of previous instances,
pending-startup cleanup, and the small serve-only Vite close bridge. Kit's pinned
SSR loader does not run `import.meta.hot.dispose`, so that bridge remains
application-specific. Development cleanup happens at the next initialization or
server close, not immediately when source is invalidated.

### Configured image files

`/public/[...file]` checks exact membership in the captured
`assets.referencedPaths` before any image I/O. The server-only `assets.ts` reader
uses bounded 5 MiB reads, canonical containment, regular-file and stability checks,
and the same opened descriptor's `/proc/self/fd` location. This requires Linux
procfs even in native Node; unavailable descriptor lookup fails closed. Symlinks
inside the root work, escapes do not. Extension/signature checks recognize
PNG/JPEG/GIF/WebP and UTF-8 SVG without DTD/entity markup; this is neither a full
codec/XML decoder nor an SVG sanitizer. SVG files are trusted operator content.

The route shares only response formatting with `/bookmarks/[id]/logo`; the
snapshot renderer is unchanged. GET and HEAD return private/no-store, nosniff and
byte lengths, with no HEAD body or range/conditional caching. Failures are generic
404s. Config loads/preparation do not inspect images. References update only with
accepted snapshots; image bytes update independently on subsequent requests.
All mounted source URLs, including the selected site favicon's source, remain
private when auth is enabled. HTML Accept does not turn image requests into
sign-in redirects. The public group's `/favicon` GET/HEAD route reads only
`locals.snapshot.configuration.site.favicon_path` through the existing reader and
response helper. Selecting a bookmark image publishes its bytes through this alias
as well, without making its raw URL public. Missing selection or unavailable bytes
return generic 404, not a bundled fallback.

The shared server layout returns only `{ faviconPath }`: `/favicon` when configured,
otherwise bundled `/favicon.svg`. Its single head icon link has no fixed MIME type.
No configured source URI, title, session or private configuration enters that
layout data; the existing public sign-in title remains unchanged.

### Authentication boundary

The running application owns its directory and one boot-created Auth.js instance
when auth is configured. Providers and seven-day JWT session policy do not change
on display reloads. The request hook captures the application and one snapshot,
then runs Auth.js and the whole-directory access checks. Only a signed-in boolean is
added to the directory page data; sessions, provider configuration and Auth.js handles
remain server-side.

Route folders declare access ownership; SvelteKit groups do not change URLs:

```text
routes/
  +layout.server.ts
  +layout.svelte
  (public)/
    favicon/
    signin/
    healthz/
  (protected)/
    +page.server.ts
    +page.svelte
    (endpoints)/
      bookmarks/[id]/logo/
      public/[...file]/
```

With authentication enabled, the hook bypasses the session gate only for matched
`(public)` route IDs. All other application routes, including unmatched requests,
require a session by default. Anonymous HTML GET page navigation redirects to
sign-in; data, HEAD and non-navigation requests return 401. The nested `(endpoints)`
group always returns 401 to anonymous requests, even with HTML Accept, and is also
where future private APIs belong. Route handlers and Kit reject unsupported verbs;
public ownership does not permit arbitrary writes. Configured image references do
not create access exceptions. Bundled static files are served by adapter-node or
Vite before application hooks, not by a public URL-prefix rule in the gate.
No-auth mode, origin/CSRF checks and the native Auth.js sequence are unchanged.

Sign-in uses native SvelteKit form actions, as in When, with a server-selected
provider and an allowlist of submitted fields. Return URLs are reduced to safe
local paths. Sign-out is the root page's named POST action. Login forms work
without JavaScript. Auth.js owns session encryption/cookies and OIDC callbacks;
Directory owns default-deny routing, safe diagnostics and fixed-origin policy.
Auth.js is bundled server-side; its build-time dependency classification keeps
framework/compiler peers out of the pruned container runtime.

SvelteKit's CSRF protection stays enabled, with an additional exact-origin check
on state-changing requests independent of content type. Auth.js uses its standard
`AUTH_URL` setting for callback/action URLs. Session handling uses the native
SvelteKit event and cookie context; only submitted form fields are allowlisted. Native CSP protects scripts and framing;
it does not restrict form redirects to self, because Chromium would block the
OIDC redirect to the identity provider. Referrer policy follows When's
`strict-origin-when-cross-origin`, preserving form Origin headers without leaking
directory paths to another origin. Cookie security uses the native Auth.js and
SvelteKit defaults for HTTPS and HTTP localhost.

Server diagnostics use **tslog 5.2.0**: JSON in production and pretty output in
development, with call-site stack capture disabled. Reporting passes only fixed
messages, issue codes and safe field paths to the logger, never raw errors or
configuration values. Library formatting is not a substitute for that boundary.

### Browser checks

Browser tests launch `node build/index.js` from the web workspace on
`127.0.0.1:4183`. They refuse to reuse an existing server and stop their server
afterwards. Build before invoking E2E independently. Playwright explicitly sets
`CONFIG_PATH` to the checked-in empty-directory fixture under `e2e/fixtures`, not
the process's operator path. Tests use no personal configuration, credentials,
or development server. Unit discovery is separate from browser specs.
Application tests use only their own fixtures and disposable data, never the
manual `demo/` configuration or images. The demo is not an automated test, build,
lint, formatting or package input and does not trigger CI.

The co-located process tests launch the real adapter-node build with disposable
YAML and OS-assigned ports. They check fatal invalid configuration or auth
prerequisites, atomic replacement, invalid/deleted file recovery, safe logs/health and graceful
shutdown. These tests require the production build, just like the CLI artifact
tests; they are not browser tests. Coverage measures TypeScript modules, not Svelte markup;
there is no arbitrary percentage gate or claim of full UI coverage. The config
smoke test imports built output, so its pass does not imply source instrumentation
coverage of `src/index.ts`.

Authentication browser/HTTP tests use separate disposable production servers and
a test-only local OIDC issuer built from Node HTTP/crypto. They exercise real
Auth.js flows, discovery, PKCE/state/nonce, invalid claims/outages, cookie expiry/rotation,
private data routes and cross-origin/redirect attacks. Configured-image tests use
disposable mounts for real production HTTP authentication, exact references,
symlinks, MIME, HEAD/cache headers, reloads and byte recovery, plus the existing
SSR logo consumer with JavaScript disabled. Reader unit tests cover bounded I/O,
ordinary races and descriptor cleanup. These are not Docker/procfs deployment
checks. No live IdP or operator
config is used; real HTTPS/proxy and provider registration remain manual checks.

Root commands cover all three workspaces, ordered by their declared package
dependencies. Each workspace's lint/format commands explicitly share the root
ignore file, so formatting after a build/test run must not rewrite generated
output. Build output, coverage, operator configuration, local plans, manual demo
data, and prototypes remain outside formatting; ESLint also ignores `demo/`.

## Manual app releases

Directory follows When's thin Changesets CLI pattern, with no release bot,
prerelease flow or automatic commit, tag push or deployment. The three root
commands are `pnpm changeset`, `pnpm version:apps` and `pnpm tag:apps`; root
quality commands still cover all workspaces, not just web.

The fixed group contains only `@directory/web` and `@directory/cli`. Both are
private, but `privatePackages.version` and `privatePackages.tag` are enabled so
Changesets can version and tag them together. `commit: false` keeps commits
manual; `baseBranch: main` is the comparison base. `@directory/config` is internal
and ignored for independent versioning, **not ignored for release impact**:
record behavior/schema changes in an explicit changeset for each affected
consuming app. Its checks remain required. Tooling/docs-only setup needs no
retroactive app changeset or version bump.

1. With each feature or fix, run `pnpm changeset`. Select the affected app(s),
   choose major/minor/patch by consumer impact and write a useful release note.
   Review the generated `.changeset/*.md` with the feature. The fixed group
   synchronizes app versions at release time, even for a web-only change.
2. When preparing a release on reviewed main, inspect pending changesets with
   `pnpm changeset status`, then manually run `pnpm version:apps`. This consumes
   pending entries, updates app manifests and generates app changelogs. Review
   the complete diff, including any lockfile changes, and verify the intended
   versions and notes. Do not hand-bump versions or run this in CI.
3. Run the frozen-install and all-workspace quality gates (`pnpm verify`), then
   obtain owner review and explicit authorization before committing the release
   manifests, changelogs, consumed changesets and any lockfile changes. Do not
   mix unrelated working changes into the release commit.
4. Only after the release commit is approved, and tagging is explicitly
   authorized, run `pnpm tag:apps`. It creates local qualified tags such as
   `@directory/web@1.2.3` and `@directory/cli@1.2.3`; it does not push them.
   Inspect tags and their target commit. Push the approved release commit and
   only the intended release tags when separately authorized; do not blindly
   push every local tag.
5. Inspect both providers' runs and registry outputs. Only the qualified web tag
   publishes the web image; the accompanying CLI tag must not publish a second
   image. There is no npm publication or separately published CLI image.

The publisher accepts only stable `@directory/web@<major>.<minor>.<patch>` tags
with no leading zeroes, matching `apps/web/package.json` exactly. Partial,
prerelease, build-metadata, malformed and mismatched tags are rejected before
registry login/publication. After web checks/E2E and schema/config/CLI gates,
`@directory/web@1.2.3` publishes `1.2.3`, `1.2` and `1` image aliases to both
`git.eleith.com/eleith.private/directory` and `ghcr.io/eleith/directory`. Tags
never move `latest`; only successful main pushes do. Minor/major aliases move
when a release is published; select a full version or digest for deployment
pinning. See [published images](deployment.md#published-production-images).

Rehearse authoring, versioning and tagging only in an independent disposable Git
repository, never the working repository or a worktree that shares its refs.
Before a real release, check private-app lockstep, ignored-config app impact,
consumed notes/changelogs and qualified tags there. Hosted publication and
registry authorization still require actual authorized provider runs.

## Continuous integration

Each provider has separate `config.yml`, `cli.yml`, and `web.yml` pipelines,
matching `when`: [.github/workflows](../.github/workflows/) and
[.woodpecker](../.woodpecker/). `pnpm verify` remains the local all-workspace
aggregate, not a pipeline. Every selected pipeline uses a frozen full-workspace
install, then package-scoped build, type checks, lint, and coverage tests. Config
exports and CLI executables are built before their artifact tests. Both config
pipelines run `pnpm schema:check` after frozen installation and before building;
regeneration is never an automatic part of build. Web alone has
production browser tests, with an explicit production build before Playwright.
Each pipeline also runs root `pnpm lint` so global formatting/ESLint remains
covered; this intentionally overlaps workspace lint.

Path filters include dependencies and shared tooling, not just app directories:

- `packages/config/**` and the shared `apps/web/config/directory.example.yml`
  starter run config, CLI, and web checks. The manual-only `demo/` does not trigger
  pipelines or supply automated test fixtures.
- `apps/cli/**` or `apps/web/**` selects that application's pipeline.
- Root files (`'*'`, including dotfiles), `.changeset/**`, `docs/**`, and both
  workflow directories run all three. This covers the lockfile, catalog,
  package manager/Node pins, base TypeScript, ESLint/Prettier settings, docs, and
  workflow changes.

Both providers check main pushes and pull requests. The web pipeline also
selects qualified web-tag candidates and runs all workspace gates before image
publication, even when the other package pipelines do not select tag events.
Keep these filters and the package gates current when adding shared tools or
commands.

- GitHub Actions uses `ubuntu-24.04`, Node 26.5.0, pnpm from the `packageManager`
  pin, and a pnpm store cache. Job names are distinct: `Config checks`, `CLI
checks`, `Web checks`, and `Web E2E`. Only web has a dependent E2E job, using
  `ghcr.io/eleith/containers-playwright:1.61.1-node26` pinned to its verified
  manifest digest. That separate checkout gets another frozen install and builds
  only web and its shared dependencies before browser tests.
- Each Woodpecker pipeline shares `/workspace/src` across ordered preparation,
  package build/check/lint/test steps, and web E2E where applicable. Plain Node
  steps use `node:26.5.0-bookworm`, pinned Corepack 0.36.0, and pnpm 11.9.0.
  Corepack's shared cache is under the ignored `.pnpm-store/corepack`; the pnpm
  store is local too. Later steps reuse dependencies and output. Web E2E uses
  `git.eleith.com/eleith.private/playwright:1.61.1-node26` without overriding its
  baked Corepack cache settings.

The browser images contain Playwright 1.61.1's browsers and Ubuntu 24.04 system
libraries; CI does not download browsers or run APT for each application check.
Keep both image references (and the GitHub digest) paired with the catalog's
Playwright version. A `node26` image tag alone does not pin a Node patch: browser
steps explicitly require Node 26.5.0 and pnpm 11.9.0. The public GHCR image's
contents were inspected; inspect runner logs after image changes to confirm the
separately built Gitea image too. A mismatched image fails rather than silently
using another toolchain. Local development still needs its own matching browser
installation as described above.

These workflows do not inject operator YAML/application credentials, write package
versions or deploy. Release versioning and tag pushes remain manual. PR jobs
retain `contents: read`; the public GHCR browser image requires no registry
login. The Woodpecker runner
needs pull access to the existing Gitea CI image, as for `when`. Configure read
access at the CI platform, not by exposing publishing credentials to application
commands or pull requests.

### Main and release image publication

Main pushes and validated stable web tags add image publication only after web
checks and production E2E.
Both providers also run explicit schema/config/CLI gates before publishing, so
parallel package pipelines cannot allow a failing dependency check to be bypassed.
The Docker build copies pruned production dependencies and compiled output into
the non-root image. It needs no operator YAML or auth secret at build time. See
[Docker and Compose](deployment.md) for local use and the owner's container,
bind-mount and image-size checks.

- Woodpecker uses `woodpeckerci/plugin-docker-buildx:6.0.3` to publish
  `git.eleith.com/eleith.private/directory`, matching When's plugin, registry and
  `gitea_docker_registry` secret. Main publishes `latest`; stable web tags use
  the validated `.tags` file for full/minor/major aliases. Allow this plugin in
  the runner's privileged-plugin configuration. Restrict the secret
  **server-side** to `push` and `tag` events and this exact plugin; no PR access,
  including higher-priority secret overrides. Woodpecker has no native branch
  filter for secrets: workflow branch/tag conditions are not a credential
  boundary. Trust everyone who can push workflow changes, or enforce stronger
  policy through your secret backend.
  Registry credentials belong only in plugin settings, never application commands
  or build arguments.
- GitHub's `Publish web image` job depends on checks/E2E and runs only for main
  pushes or qualified stable web tags. Only that job receives `packages: write`;
  it authenticates to GHCR with `GITHUB_TOKEN` and publishes
  `ghcr.io/eleith/directory`. `docker/metadata-action@v6` disables automatic
  `latest`, selecting it explicitly for main and full/minor/major aliases for
  validated web tags. Confirm the repository/package link and write
  authorization at the provider. Normal PR
  jobs do not run registry login or receive publication credentials.

Both publish the `prod` target for `linux/amd64`. CLI tags do not publish images;
release tags never update main's `latest`. Registry availability, token scope
and runner capability must be confirmed on the real
providers; static validation is not a successful image build or publication.

### Woodpecker email notifications

Every package pipeline has one `notify` step using
`deblan/woodpecker-email:3.3.0`, with `status: [failure, success]`. It runs only on
main pushes, never PRs. The plugin infers the result from the CI status, so no
explicit `level` setting or duplicate steps are needed. Configure or confirm these existing secret names
in the effective repository/organization/global secret scope:

- `woodpecker_email_dsn`
- `woodpecker_email_from_address`
- `woodpecker_email_from_name`
- `woodpecker_email_recipient`

Restrict all four secrets server-side to the `push` event and the email plugin
image/tag (`deblan/woodpecker-email:3.3.0`). Ensure the allowlist includes this
version; retain tags still required by other repositories sharing these secrets.
Do not enable PR access: YAML conditions alone cannot protect secrets
from a PR that changes the workflow. Bind secrets only in notification settings,
not application commands. Missing SMTP settings/delivery remain operator setup,
not a passing notification test. Common-path changes can produce three package
emails rather than one aggregate message.

Enable the repository in Woodpecker with a Linux amd64 container-backed runner
that can pull the CI images, and place/enable the workflow in the intended GitHub
repository or mirror. A Gitea pull request does not automatically create a GitHub
pull request or trigger that provider's PR event. Check actual runs on each
provider separately; YAML checks, image inspection, and local `pnpm verify` are
not successful hosted CI runs. Review branch-protection/required-check settings
before enabling path filters: GitHub can leave a required check pending when its
entire workflow is skipped. Do not blindly require every selectively triggered
package check. Distinct job names avoid ambiguous statuses but do not solve that
provider policy issue.

Schema generation, YAML loading, CLI validation and Compose commands are available.
Release commands are manual as described above. Docker execution and final
image checks, axe and PageSpeed remain owner-run manual checks, not
agent-verified gates.

## Manual checks

1. Follow the clean setup in an isolated export of the staged commit. Check root
   verification, CLI help and validation of both the production starter and demo without
   personal config. Use a disposable file with a missing environment reference
   or malformed YAML and check the failure output stays redacted. In a YAML-aware
   editor, check template syntax and required-field diagnostics.
2. After changes are authorized and pushed, inspect a Woodpecker PR
   run and a GitHub PR/main run on the configured providers. Confirm package
   routing: config/root/tooling/docs/workflow changes fan out; application-only
   changes select their own pipeline. Check pinned tools, frozen install, package
   gates, and web's preinstalled browsers/production E2E. Review required-check
   policy against skipped workflows. An absent runner or GitHub mirror remains
   an outstanding operator setup task, not a passing check.
3. Review events and permissions: PR checks must not receive SMTP or publishing/
   deployment secrets and must not send email or push images. Confirm SMTP event/
   plugin restrictions at the server, including any higher-priority secret
   overrides. On an authorized main run, check package notifications actually
   arrive. Verify failure delivery in a controlled runner test, not by breaking
   main. Do not inject operator YAML or credentials into application checks.
4. Make a disposable copy to try startup and file changes without editing the
   checked-in demo or operator configuration:

   ```sh
   preview=$(mktemp -d)
   cp demo/config/directory.yaml "$preview/directory.yaml"
   CONFIG_PATH="$preview/directory.yaml" \
     DIRECTORY_PUBLIC_DIR="$PWD/demo/public" \
     AUTH_SECRET="$(openssl rand -base64 32)" \
     ORIGIN=http://localhost:5173 AUTH_URL=http://localhost:5173 pnpm dev
   ```

   Run from the repository root; open `http://localhost:5173` and use
   **demo / directory-demo**. This generates a unique demo-only secret per run.
   Check desktop/narrow widths, OS light/dark and JavaScript disabled. Confirm
   four configured primary logos and five generated logos load on cards and
   details; service URLs are placeholders. These are primary logo fixtures, not
   service-favicon or broken-image-fallback acceptance tests. Edit the
   copied site's title/description and refresh after approximately one second.
   Try an atomic rename save, invalid YAML, deletion and restoration: the last
   good copy should remain until a valid file returns. `/healthz` exposes only
   readiness, not configuration names or paths. Configured authentication must
   require sign-in before site copy/data are returned; missing secret/origin must
   fail startup. Try a wrong password, sign-out and a direct `__data.json` request.
   Follow a bookmark to its plain `?link=<id>` details and return with Back to
   directory. Omit a bookmark's `logo_path` in the disposable copy and check that its
   prepared logo renders without JavaScript and remains protected before sign-in,
   including HEAD and `/bookmarks/<id>/logo` opened as HTML. For a configured logo,
   use a disposable public directory and set `DIRECTORY_PUBLIC_DIR` to its absolute
   path before starting. Check mounted logos on cards/details without JavaScript,
   generic 404s for unreferenced or missing files, then atomic file replacement
   and recovery. Authenticated mounted GET/HEAD work; unauthenticated requests
   return 401 even with HTML Accept, including the selected favicon's raw source.
   Before sign-in, check the tab icon and `/favicon` GET/HEAD: only the selected
   bytes are public, with private/no-store, nosniff and bodyless HEAD. Change the
   selected source and check the same alias returns new bytes after polling;
   invalid YAML and auth-changing edits must keep the last good selection. Omit
   the field to check the head uses `/favicon.svg` and the alias returns 404.
   Missing or invalid selected files must return 404, not the bundled icon. Verify
   Linux procfs availability.
   See the [owner Docker checklist](deployment.md#owner-docker-review-checklist)
   for the separate real-image/mount/procfs review. Stop the server when finished.
   For production output, after `pnpm build`, run:

   ```sh
   CONFIG_PATH="$PWD/demo/config/directory.yaml" \
     DIRECTORY_PUBLIC_DIR="$PWD/demo/public" \
     AUTH_SECRET="$(openssl rand -base64 32)" \
     ORIGIN=http://localhost:3000 AUTH_URL=http://localhost:3000 \
     HOST=127.0.0.1 PORT=3000 node apps/web/build/index.js
   ```

   Run from the repository root. Open `http://localhost:3000`, sign in with
   **demo / directory-demo**, then stop the server when finished. This production
   preview also generates a demo-only secret per run. The
   directory uses prepared bookmark logos for omitted logo paths and serves exact
   configured image references. Search, modal details and saved preferences are
   not implemented. Run
   manual axe/PageSpeed on this visible baseline when available; this slice is not
   final UI acceptance.

Complete agent review before staged owner review. Stage only one coherent commit
at a time when requested, and wait for manual review and explicit permission
before committing or pushing. A successful local check is not a hosted CI run.
