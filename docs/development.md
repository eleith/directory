# Development

## Current scope

The bootstrap contains all three workspaces, local quality gates, and non-publishing
Woodpecker/GitHub workflow definitions. CLI help and the SSR placeholder read the
same supported configuration format version. The TypeBox schema, inferred types
and deterministic editor-schema generation are implemented, along with YAML
loading, environment interpolation and standalone CLI validation; see
[configuration](config.md). The web server now loads before serving, polls the
configuration path, and captures one immutable snapshot per request. The shell
shows configured site copy; dashboard links and image serving are still later
work. Optional credentials or OIDC authentication gates the entire directory;
no-auth mode stays open and requires no session secret. Application images and
releases are not implemented yet.

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

The web server now needs configuration at runtime, not at build time. To preview
without creating operator configuration:

```sh
CONFIG_PATH="$PWD/apps/web/config/directory.example.yml" pnpm dev
```

`pnpm dev` runs Vite from `apps/web`, so its default path is
`apps/web/config/directory.yaml`. Absolute `CONFIG_PATH` values work independently of
the command's working directory. Never overwrite an existing operator file with
the example. With auth enabled, also supply a random `AUTH_SECRET` and matching
`ORIGIN`/`AUTH_URL`; see [authentication setup](config.md#authentication-shapes).
Use HTTPS or `http://localhost:5173` for local development, updating both URL
settings if the development port changes.

### CLI validation

```sh
pnpm cli -- --help
pnpm cli -- validate apps/web/config/directory.example.yml
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
asset lists, then freezes the complete snapshot. Only its `display` member may
be sent to the browser. The client-facing interfaces in `src/lib/display/types.ts`
contain no server imports. Snapshot IDs are fresh random UUIDs, not hashes of
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
report `auth_failed`; no mode falls back to open access after an auth failure.

Only a valid startup installs `watchConfig`, a non-persistent one-second path
poll. Inode, modification-time or size changes request a serialized reload;
editor atomic rename saves and deletion/recreation keep working. Boot requests
one additional reload after watcher installation to catch saves during setup.
Invalid later edits keep the last good snapshot and generic health readiness.

The request hook captures `directory.currentSnapshot()` once into
`event.locals.snapshot`; nested loaders use that reference even if a reload
publishes meanwhile. The shell returns only the captured public site title and
description plus the format version, not private configuration or link metadata.
`/healthz` returns only `{ "status": "ok" }` after initialization. Requests load
neither YAML nor asset fallbacks. Shutdown stops the watcher and blocks pending
publication. Polling/config preparation are not browser code.

Production lifecycle handling uses adapter-node's `sveltekit:shutdown` event.
Development lifecycle handling separately owns replacement of previous instances,
pending-startup cleanup, and the small serve-only Vite close bridge. Kit's pinned
SSR loader does not run `import.meta.hot.dispose`, so that bridge remains
application-specific. Development cleanup happens at the next initialization or
server close, not immediately when source is invalidated.

### Authentication boundary

The running application owns its directory and one boot-created Auth.js instance
when auth is configured. Providers and seven-day JWT session policy do not change
on display reloads. The request hook captures the application and one snapshot,
then runs Auth.js and the whole-directory access checks. Only a signed-in boolean is
added to the directory page data; sessions, provider configuration and Auth.js handles
remain server-side.

Sign-in uses native SvelteKit form actions, as in When, with a server-selected
provider and an allowlist of submitted fields. Return URLs are reduced to safe
local paths. Sign-out is the root page's named POST action. Login forms work
without JavaScript. Auth.js owns session encryption/cookies and OIDC callbacks;
Directory owns default-deny routing, safe diagnostics and fixed-origin policy.

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
private data routes and cross-origin/redirect attacks. No live IdP or operator
config is used; real HTTPS/proxy and provider registration remain manual checks.

Root commands cover all three workspaces, ordered by their declared package
dependencies. Each workspace's lint/format commands explicitly share the root
ignore file, so formatting after a build/test run must not rewrite generated
output. Build output, coverage, operator configuration, local plans, and
prototypes remain outside formatting.

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

- `packages/config/**` and the shared `apps/web/config/directory.example.yml` run
  config, CLI, and web checks.
- `apps/cli/**` or `apps/web/**` selects that application's pipeline.
- Root files (`'*'`, including dotfiles), `docs/**`, and both workflow directories
  run all three. This covers the lockfile, catalog, package manager/Node pins,
  base TypeScript, ESLint/Prettier settings, docs, and workflow changes.

Both providers check main pushes and pull requests. Keep these filters and the
package gates current when adding shared tools or commands.

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

These workflows do not inject operator YAML or application credentials, write
package versions, publish images, or deploy. Release/tag jobs remain deferred.
GitHub's checkout token has only `contents: read`; the public GHCR image requires
no registry login. The Woodpecker runner needs pull access to the existing Gitea
CI image, as for `when`. Configure read access at the CI platform, not by exposing
publishing credentials to application commands or pull requests.

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

Schema generation, YAML loading and CLI validation are available. Image and
release commands remain deferred. Axe and PageSpeed remain owner-run manual
checks, not automated gates.

## Manual checks

1. Follow the clean setup in an isolated export of the staged commit. Check root
   verification, CLI help and validation of the documented example without
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
   checked-in example or operator configuration:

   ```sh
   preview=$(mktemp -d)
   cp apps/web/config/directory.example.yml "$preview/directory.yaml"
   CONFIG_PATH="$preview/directory.yaml" pnpm dev
   ```

   Check desktop/narrow widths, OS light/dark and JavaScript disabled. Edit the
   copied site's title/description and refresh after approximately one second.
   Try an atomic rename save, invalid YAML, deletion and restoration: the last
   good copy should remain until a valid file returns. `/healthz` exposes only
   readiness, not configuration names or paths. Configured authentication must
   require sign-in before site copy/data are returned; missing secret/origin must
   fail startup. Try a wrong password, sign-out and a direct `__data.json` request.
   Links and mounted images are not rendered yet. Stop the server when finished.
   For production output, after `pnpm build`, run:

   ```sh
   CONFIG_PATH="$PWD/apps/web/config/directory.example.yml" \
     HOST=127.0.0.1 PORT=3000 ORIGIN=http://127.0.0.1:3000 node apps/web/build/index.js
   ```

   Open `http://127.0.0.1:3000`, then stop the server when finished. Only the site
   copy is configured; no dashboard controls are expected. Run manual axe/PageSpeed when the actual UI exists;
   placeholder scores do not establish final-app accessibility/performance.

Complete agent review before staged owner review. Stage only one coherent commit
at a time when requested, and wait for manual review and explicit permission
before committing or pushing. A successful local check is not a hosted CI run.
