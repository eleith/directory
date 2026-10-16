# Development

## Web bootstrap scope

This snapshot adds `apps/web`: a SvelteKit placeholder that renders title and copy
on the server. There is no YAML loader, shared configuration package, CLI,
authentication, dashboard, or CI yet. Those arrive in separate commits.

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
| `pnpm build`                       | Builds the adapter-node production server.                                  |
| `pnpm check`                       | Runs SvelteKit sync and Svelte/TypeScript diagnostics.                      |
| `pnpm lint` / `pnpm format`        | Checks or writes root/workspace Prettier formatting; lint also runs ESLint. |
| `pnpm test` / `pnpm test:coverage` | Runs the route-load unit test with diagnostic coverage.                     |
| `pnpm test:e2e`                    | Runs Chromium against the existing production build.                        |
| `pnpm verify`                      | Builds, checks types/lint, runs coverage tests, then E2E.                   |
| `pnpm dev`                         | Starts Vite on `127.0.0.1:5173`.                                            |

Browser tests launch `node build/index.js` from the web workspace on
`127.0.0.1:4183`. They refuse to reuse an existing server and stop their server
afterwards. Build before invoking E2E independently. Tests use no personal
configuration, credentials, or development server. Unit discovery is separate
from browser specs. Coverage measures TypeScript modules, not Svelte markup;
there is no arbitrary percentage gate or claim of full UI coverage.

Root commands cover the workspaces that actually exist. The web workspace's own
lint/format commands explicitly share the root ignore file, so formatting after a
build/test run must not rewrite generated output. Build output, coverage,
operator configuration, local plans, and prototypes remain outside formatting.

There are no schema/CLI/image/release commands yet. Axe and PageSpeed remain
owner-run manual checks, not automated gates. Neither hosted CI nor a production
image is provided in this commit.

## Manual checks for this commit

1. Verify the exact staged snapshot in isolation, rather than the combined local
   worktree, which may contain later unstaged commits' files.
2. Run the setup above, then `pnpm dev`. Open the placeholder at desktop and
   narrow widths, check wrapping/overflow and the map-pin favicon, and switch OS
   light/dark settings.
3. Disable JavaScript and reload: the title and description should remain visible.
4. For production output, run `pnpm build`, then from the repository root:

   ```sh
   HOST=127.0.0.1 PORT=3000 ORIGIN=http://127.0.0.1:3000 node apps/web/build/index.js
   ```

   Open `http://127.0.0.1:3000` and compare the same content. Stop the server when
   finished; no dashboard controls are expected yet.

Complete agent review before staged owner review. Stage only one coherent commit
at a time when requested, and wait for manual review and explicit permission
before committing or pushing. A successful local check is not a hosted CI run.
