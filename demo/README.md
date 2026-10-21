# Isolated local review demo

This is a **manual, local-only** preview, not production configuration. Sign in
with **demo / directory-demo** using real Auth.js credentials authentication.
Never publish these known credentials. A unique generated `AUTH_SECRET` is still
required; there is no shared secret fallback.

The nine bookmarks span three groups: four use the original project-authored MIT
SVGs in `public/demo`, and five use generated bookmark logos. A fifth original
SVG is the site favicon; the 48px directory header reuses `home.svg` as its site
logo beside the title and description after sign-in. Destinations are reserved
example.com placeholders, not live
integrations. Check all nine cards and plain `?link=<id>` details with JavaScript
on and off; after sign-out, mounted and generated bookmark images must be private.
Before sign-in, check the tab icon: `/favicon` publicly serves the selected image's
bytes, while its raw `/public/demo/favicon.svg` URL still returns 401 (GET/HEAD,
even with HTML Accept). Bookmark images and the raw `/public/demo/home.svg` site
logo URL stay private. The sign-in mark always uses bundled `/favicon.svg`, with
no configured site logo URI in public HTML or layout data. Mounted-image reads
require Linux procfs.

After sign-in, check the header at desktop and 360px widths: the title wraps and
Sign out stays visible beside or below it. In a disposable config copy, omit
`site.logo_path` and refresh to see the bundled default; a broken configured logo
switches once to the bundle with JavaScript, but stays broken without JavaScript.
The independent site favicon selection is unchanged.

## Preferred native preview

With the [development prerequisites](../docs/development.md#setup-and-commands)
installed, run from the repository root:

```sh
CONFIG_PATH="$PWD/demo/config/directory.yaml" \
  DIRECTORY_PUBLIC_DIR="$PWD/demo/public" \
  AUTH_SECRET="$(openssl rand -base64 32)" \
  ORIGIN=http://localhost:5173 AUTH_URL=http://localhost:5173 pnpm dev
```

Open **http://localhost:5173**, sign in, and stop with Ctrl-C when finished. This
command writes no operator configuration or media. Each run generates an ephemeral
secret and invalidates previous sessions; real deployments should keep their own
generated secret stable. Use localhost, not an HTTP IP address. If changing the
port, update both `ORIGIN` and `AUTH_URL` to match.

Without an override, the public directory resolves from the config path's
grandparent: `demo/config/directory.yaml` selects `demo/public`. The explicit
`DIRECTORY_PUBLIC_DIR` above also overrides any operator environment value.
Source image URIs stay `/public/demo/*.svg`, matching the runtime public mount;
the shared head uses only `/favicon`, never the configured source URI.

For a production-server preview after `pnpm build`, from the repository root:

```sh
CONFIG_PATH="$PWD/demo/config/directory.yaml" \
  DIRECTORY_PUBLIC_DIR="$PWD/demo/public" \
  AUTH_SECRET="$(openssl rand -base64 32)" \
  ORIGIN=http://localhost:3000 AUTH_URL=http://localhost:3000 \
  HOST=127.0.0.1 PORT=3000 node apps/web/build/index.js
```

Open **http://localhost:3000** with the same demo credentials. To test reloads,
copy `demo/config/directory.yaml` to a disposable directory, point `CONFIG_PATH` to
that absolute copy and keep `DIRECTORY_PUBLIC_DIR` set to the repository's
`demo/public`. Invalid edits keep the last good snapshot. Auth changes require
a process restart.

Validate both the empty production starter and this demo from the repository root:

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
alone. Still in `apps/web`:

```sh
cp ../../demo/config/directory.yaml config/directory.yaml
mkdir -p public/demo
cp -n ../../demo/public/demo/*.svg public/demo/
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
The copy supplies five assets: four bookmark primary logos and one site favicon;
the nine bookmarks still use four provided and five generated logos. `cp -n`
preserves existing images; use an isolated checkout if these destination names
are already occupied. For an existing active demo copy, manually add
`site.favicon_path: /public/demo/favicon.svg` and copy the new SVG to opt in;
otherwise the bundled icon remains. The field reloads without an auth restart.

## Scope and automated-check exclusion

`demo/` is tracked for manual local previews only. It has no package and is
outside the `apps/*` and `packages/*` workspaces. Automated tests use their own
fixtures, never this demo. It is not an automated test, build, lint, formatting or
package input, does not trigger CI, and is excluded from the Docker build context.
Docker uses its images only after the explicit manual copy into the runtime mount
above. The minimal, credential-free production starter remains in
`apps/web/config` for operator bootstrap; it is not this demo. Enable your own
authentication before publishing.
