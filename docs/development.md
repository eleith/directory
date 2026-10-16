# Development

## CLI bootstrap scope

This snapshot adds `apps/cli` to the compiled config package and SSR web scaffold.
CLI help and the web page read the same supported configuration format version.
There is no YAML schema/loader/validator, authentication, dashboard, or CI yet.

## Toolchain

`mise.toml` pins Node **26.4.0** and pnpm **11.9.0**. The shared catalog pins direct
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

| Command                            | What it does                                                                |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `pnpm build`                       | Builds config, then CLI and the adapter-node production server.             |
| `pnpm check`                       | Checks config/CLI TypeScript plus web Svelte/TypeScript diagnostics.        |
| `pnpm lint` / `pnpm format`        | Checks or writes root/workspace Prettier formatting; lint also runs ESLint. |
| `pnpm test` / `pnpm test:coverage` | Runs all workspace unit/artifact tests, with diagnostic coverage.           |
| `pnpm test:e2e`                    | Runs Chromium against the existing production build.                        |
| `pnpm verify`                      | Builds, checks types/lint, runs coverage tests, then E2E.                   |
| `pnpm dev`                         | Builds config, then starts Vite on `127.0.0.1:5173`.                        |

`pnpm build:packages` rebuilds just shared output. Package exports deliberately
resolve `dist/index.js` and `dist/index.d.ts`, with no source aliases or custom
loader. Build before independent checks/tests; `pnpm verify` does this in order.
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

There are no schema/validation/image/release commands yet. Axe and PageSpeed remain
owner-run manual checks, not automated gates. Neither hosted CI nor a production
image is provided in this commit.

## Manual checks for this commit

1. Verify the exact staged snapshot in isolation, rather than the combined local
   worktree, which may contain later unstaged commits' files.
2. Run the CLI examples above. Check help wording, stdout versus stderr, and
   exit status (`echo $?` immediately after each command). Help should return 0;
   unknown arguments, no command, and `validate` should return 1.
3. Run the setup above, then `pnpm dev`. The existing placeholder should remain
   unchanged, including `Configuration format 1` when JavaScript is disabled.
4. For production output, run `pnpm build`, then from the repository root:

   ```sh
   HOST=127.0.0.1 PORT=3000 ORIGIN=http://127.0.0.1:3000 node apps/web/build/index.js
   ```

   Open `http://127.0.0.1:3000` and compare the same content. Stop the server when
   finished; no dashboard controls are expected yet.

Complete agent review before staged owner review. Stage only one coherent commit
at a time when requested, and wait for manual review and explicit permission
before committing or pushing. A successful local check is not a hosted CI run.
