# Development

## Current scope

The bootstrap contains all three workspaces, local quality gates, and non-publishing
Woodpecker/GitHub workflow definitions. CLI help and the SSR placeholder read the
same supported configuration format version. The TypeBox schema, inferred types
and deterministic editor-schema generation are implemented; see
[configuration](config.md). YAML loading, CLI validation, authentication, the
dashboard, application images and releases are not implemented yet.

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
pnpm --filter @where/web exec playwright install chromium
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
loader. `@where/config/types` is a type-only entry; the schema JSON is exported
separately. Schema generation compiles fresh source into disposable output and
never relies on an existing `dist`. Build before independent workspace
checks/tests; `pnpm verify` does this in order.
After editing config source during development, rebuild shared output to make it
visible to Vite; there is no automatic config-source compiler/watch process.

### CLI help and errors

```sh
pnpm cli -- --help
pnpm cli -- -h
pnpm cli -- --unknown
```

The root command builds shared config and the CLI, then runs its compiled Node
entrypoint. Help returns 0 on stdout; missing/unsupported arguments return 1 on
stderr. The pnpm wrapper also emits build logs; these stream guarantees refer to
the compiled CLI entrypoint itself. `validate` is deliberately unsupported until the real loader/validator
exists. Exactly one leading `--` is accepted for package-manager forwarding;
extra arguments and repeated separators are rejected. No YAML or environment
configuration is read by this bootstrap command.

The package exposes a side-effect-free `runCli` API independently of its executable
entrypoint. Unit tests inject output sinks; subprocess tests invoke the built
entry from an unrelated working directory, check exits/output/shebang, and verify
importing the API does not execute main. The artifact still depends on compiled
`@where/config` in the workspace; these are not standalone-distribution tests.
Config compiled-module and CLI subprocess tests do not contribute to source
coverage; passing them is not a claim of full source coverage.

### Browser checks

Browser tests launch `node build/index.js` from the web workspace on
`127.0.0.1:4183`. They refuse to reuse an existing server and stop their server
afterwards. Build before invoking E2E independently. Tests use no personal
configuration, credentials, or development server. Unit discovery is separate
from browser specs. Coverage measures TypeScript modules, not Svelte markup;
there is no arbitrary percentage gate or claim of full UI coverage. The config
smoke test imports built output, so its pass does not imply source instrumentation
coverage of `src/index.ts`.

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

- `packages/config/**` and the shared `apps/web/config/where.example.yml` run
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

Schema generation/drift commands are available; YAML loading, CLI validation,
image and release commands are not. Axe and PageSpeed
remain owner-run manual checks, not automated gates.

## Manual checks for the bootstrap handoff

1. Follow the clean setup in an isolated export of the staged commit. Check the
   root verification and CLI help/error examples without personal config.
2. After the reviewed CI commit is authorized and pushed, inspect a Woodpecker PR
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
4. Run `pnpm dev`; check the placeholder at desktop/narrow widths, OS light/dark,
   and with JavaScript disabled. CLI behavior and the page should be unchanged by
   the CI/toolchain commit. For production output, after `pnpm build`, run:

   ```sh
   HOST=127.0.0.1 PORT=3000 ORIGIN=http://127.0.0.1:3000 node apps/web/build/index.js
   ```

   Open `http://127.0.0.1:3000`, then stop the server when finished. No dashboard
   controls are expected. Run manual axe/PageSpeed when the actual UI exists;
   placeholder scores do not establish final-app accessibility/performance.

Complete agent review before staged owner review. Stage only one coherent commit
at a time when requested, and wait for manual review and explicit permission
before committing or pushing. A successful local check is not a hosted CI run.
