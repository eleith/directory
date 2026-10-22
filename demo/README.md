# Isolated local review demo

This is a **manual, local-only** preview, not production configuration. Sign in
with **demo / directory-demo** using real Auth.js credentials authentication.
Never publish these known credentials. A unique generated `AUTH_SECRET` is still
required; there is no shared secret fallback.

The 32 bookmarks span five uneven groups (10, 7, 6, 5 and 4 links), with short,
long and unbroken titles for layout review. All bookmarks use generated default
logos; the header, sign-in mark and tab icon use bundled default branding. No
image mounts or asset copies are needed. Existing SVGs in `public/demo` are
optional, unreferenced media, not preview requirements. Destinations are reserved
example.com placeholders, not live integrations.

Check the overall centered canvas at desktop widths: header, group headings,
first grid column and footer share a left edge. Short groups and incomplete rows
start at that same column rather than centering separately. Check phone widths,
light/dark themes, long titles and search results too. All 32 cards and plain
`?link=<id>` details should work with JavaScript on and off; generated bookmark
images must stay private after sign-out. The header title should wrap without
hiding Sign out. Dialog and form redesign are outside this page-layout review.

## Preferred native preview

With the [development prerequisites](../docs/development.md#setup-and-commands)
installed, run from the repository root:

```sh
CONFIG_PATH="$PWD/demo/config/directory.yaml" \
  AUTH_SECRET="$(openssl rand -base64 32)" \
  ORIGIN=http://localhost:5173 AUTH_URL=http://localhost:5173 pnpm dev
```

Open **http://localhost:5173**, sign in, and stop with Ctrl-C when finished. This
command writes no operator configuration or media. Each run generates an ephemeral
secret and invalidates previous sessions; real deployments should keep their own
generated secret stable. Use localhost, not an HTTP IP address. If changing the
port, update both `ORIGIN` and `AUTH_URL` to match.

For a production-server preview after `pnpm build`, from the repository root:

```sh
CONFIG_PATH="$PWD/demo/config/directory.yaml" \
  AUTH_SECRET="$(openssl rand -base64 32)" \
  ORIGIN=http://localhost:3000 AUTH_URL=http://localhost:3000 \
  HOST=127.0.0.1 PORT=3000 node apps/web/build/index.js
```

Open **http://localhost:3000** with the same demo credentials. To test reloads,
copy `demo/config/directory.yaml` to a disposable directory and point `CONFIG_PATH`
to that absolute copy. Invalid edits keep the last good snapshot. Auth changes
require a process restart.

Validate both the empty production starter and this demo manually from the repository root:

```sh
pnpm cli -- validate apps/web/config/directory.example.yml
pnpm cli -- validate demo/config/directory.yaml
```

The CLI validates YAML/interpolation, not web auth prerequisites or image bytes.

## Optional Docker review

Use the existing Compose files; there is no demo-specific Compose configuration.
From `apps/web`, create `.env` only if absent:

```sh
test -e .env || cp -n .env.example .env
openssl rand -base64 32
```

Manually save that result as `AUTH_SECRET=<result>` in your ignored `.env`, or
keep a valid unique secret already supplied by your environment/fnox. Do not
replace an existing stable secret just for setup.

**Stop the server and back up any existing `config/directory.yaml` yourself
before explicitly choosing the following replacement.** This is a manual demo
opt-in, not an automatic bootstrap. The native preview above leaves active files
alone. Still in `apps/web`, copy only the configuration; no images are required:

```sh
cp ../../demo/config/directory.yaml config/directory.yaml
ORIGIN=http://localhost:3000 docker compose up --build --pull never --force-recreate
```

Open **http://localhost:3000** and sign in with **demo / directory-demo**. The
explicit origin overrides any production HTTPS origin in `.env` for local review.
For the existing dev-container workflow instead, use:

```sh
ORIGIN=http://localhost:5173 docker compose -f docker-compose.dev.yml up --build --force-recreate
```

With mise/fnox already configured, the equivalent dev shortcut from `apps/web` is
`ORIGIN=http://localhost:5173 mise docker up --build --force-recreate`; keep the
existing valid secret supply. Stop one Compose setup before starting the other.
See [deployment](../docs/deployment.md) for shutdown, mounts and HTTPS setup.
Leave existing operator images untouched.

## Scope and automated-check exclusion

`demo/` is tracked for manual local previews only. It has no package and is
outside the `apps/*` and `packages/*` workspaces. Automated tests use their own
fixtures, never this demo. It is not an automated test, build, lint, formatting or
package input, does not trigger CI, and is excluded from the Docker build context.
The minimal, credential-free production starter remains in `apps/web/config` for
operator bootstrap; it is not this demo. Enable your own authentication before
publishing.
