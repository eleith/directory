# Docker and Compose

Directory has one web container, following When's separate development and
production Compose pattern. No host Node/pnpm installation is needed. Published
images target Linux amd64; there is no worker, database or writable data volume.
The current UI renders text-only bookmark groups and plain details with service
links. Custom images and initials are not part of this slice.

## Local production review

Run from the checkout's web directory so Compose reads the adjacent `.env`:

```sh
cd apps/web
test -e .env || cp .env.example .env
test -e config/directory.yaml || cp config/directory.example.yml config/directory.yaml
mkdir -p public
docker compose up --build --pull never
```

Open **http://localhost:3000**, not an HTTP IP address when auth is enabled.
`/healthz` returns generic readiness. Stop with Ctrl-C; `docker compose down`
removes the container, not your mounted files. Add `-d` to run in the background
and use `docker compose logs -f` for diagnostics.

The initial example has no auth and needs no secret. Edit your ignored
`config/directory.yaml`, never the tracked example, to try site-copy reloads.
The **directory** mount keeps atomic rename saves visible. Invalid later YAML
keeps the last valid snapshot; invalid initial YAML prevents startup. Auth changes
require a restart. See the [configuration contract](config.md).

The production service runs as UID/GID **1000:1000**, with a read-only root
filesystem, temporary `/tmp`, and read-only config/public mounts. Ensure this
identity can read the mounted files and traverse their directories. Do not fix
permissions with a recursive world-writable change. Nothing writes to your
configuration or assets. The `public` mount is reserved for the later protected
image endpoint; **do not serve it directly through a proxy**.

## Authentication and HTTPS

Enable exactly one [auth strategy](config.md#authentication-shapes) in your
mounted YAML. Set a fresh session secret and the YAML's environment references in
`.env`; generate `AUTH_SECRET` with:

```sh
openssl rand -base64 32
```

For example, shared credentials use:

```yaml
auth:
  credentials:
    username: family
    password: '${DIRECTORY_PASSWORD}'
```

Set `AUTH_SECRET` and `DIRECTORY_PASSWORD` in `.env`. Do not put real credentials
in the image, build arguments, tracked examples or shell history. Compose injects
`.env` at runtime; YAML references are expanded by Directory, not Compose.

For your production HTTPS proxy, also set the canonical public root origin:

```dotenv
ORIGIN=https://directory.example.com
```

Compose sets **both `ORIGIN` and `AUTH_URL`** to this value. Do not include a
trailing slash or path. Without an override, local production review uses
`http://localhost:3000`. If you change `DIRECTORY_PORT`, set `ORIGIN` to the URL
you actually open. Production Node trusts that fixed origin rather than
client-supplied forwarding headers.

The host binding defaults to `127.0.0.1`. A host reverse proxy can reach port
3000; a containerized proxy needs an operator-configured shared network, or an
appropriately restricted host binding through `DIRECTORY_BIND`. Keep direct
access restricted to your proxy/firewall. The image itself listens on
`0.0.0.0:3000` and does not terminate TLS. Root-path hosting only; subpaths are
not supported. Shared credentials need proxy throttling. OIDC also needs the
registered `${ORIGIN}/auth/callback/oidc` callback and provider admission rules.

After changing `.env`, recreate rather than merely restart the existing container:

```sh
docker compose up -d --no-build --force-recreate
```

For YAML-only auth changes, `docker compose restart` reloads the boot policy.
Keep `AUTH_SECRET` stable to preserve sessions; rotate it to revoke them. Actual
HTTPS/cookie/proxy and external-provider behavior still need deployment testing.

## Development container

Use the same `.env`, YAML and public directory. If your host identity is not
1000:1000, set `LOCAL_UID`/`LOCAL_GID` in `.env` using `id -u` and `id -g`.
These settings control both image-generated directory ownership and the running
user. Rebuild after changing them.

```sh
ORIGIN=http://localhost:5173 docker compose -f docker-compose.dev.yml up --build
```

With mise and fnox installed, `ORIGIN=http://localhost:5173 mise docker up --build`
is an optional shortcut from this directory. It uses `docker-compose.dev.yml`.
The `*.local.toml` files stay outside Git, formatting and the Docker build context.

The shared fnox config has no session-secret default. Supply a random
`AUTH_SECRET` through your local fnox provider, shell or `.env` when enabling
authentication. Compose passes that value into the container; the app still
rejects missing or short secrets when auth is enabled. Other YAML environment
references remain configured in `.env`.

Open **http://localhost:5173**. The explicit origin in the direct command above
overrides a production HTTPS origin in `.env` for this local dev session. Web source/static/config binds are
read-only to the container; Vite caches and generated files stay inside it.
Host source edits trigger Vite reloads. Config YAML is polled as in production.
Shared config TypeScript is compiled at container startup; restart the dev
container after changing that source. Dependency/lockfile changes require a
rebuild. There is no separate compiler watcher or source-export alias.

Validate the mounted YAML with the existing CLI inside the dev image:

```sh
docker compose -f docker-compose.dev.yml run --build --rm directory-app \
  node /m/apps/cli/dist/index.js validate /m/apps/web/config/directory.yaml
```

The dev image includes the standalone CLI; the production image does not. It
checks YAML/interpolation, not web runtime prerequisites or provider reachability. To stop this setup:

```sh
docker compose -f docker-compose.dev.yml down
```

Dev and production use the same Compose project/service name; stop one before
switching to the other. Dev is a local source-preview server, not the recommended
public HTTPS deployment.

## Published production images

Successful main builds publish `latest` to:

- `git.eleith.com/eleith.private/directory:latest`
- `ghcr.io/eleith/directory:latest`

Manually authorized stable web tags publish versioned images to the same two
repositories. For example, `@directory/web@1.2.3` creates `:1.2.3`, `:1.2` and
`:1` aliases, never `:latest`. The tag must be a complete stable version with no
leading zeroes and exactly match the web manifest; validation happens before
registry login/publication. CLI tags do not publish another image. See the
[manual release workflow](development.md#manual-app-releases) for Changesets,
version review and separately authorized tag pushes.

Image availability and registry read permissions are operator setup. Before the
first successful publishing run, build locally as above. Afterwards, with `.env`
and mounts already prepared:

```sh
docker login git.eleith.com
docker compose pull
docker compose up -d --no-build
```

To choose GHCR, set `DIRECTORY_IMAGE=ghcr.io/eleith/directory:latest` in `.env`
and authenticate there if required. To select a published release instead, set
`DIRECTORY_IMAGE=git.eleith.com/eleith.private/directory:1.2.3` (or the GHCR
equivalent); use a real published version, not this illustrative value. Minor
and major aliases move with releases; use a full version or digest for pinning.
Pulling does not apply an update until you recreate the container. There is no
automatic homelab deployment or separately published CLI image.

Both providers keep PRs non-publishing. Main and stable web-tag publication wait
for web checks/E2E and explicit schema/config/CLI gates. On Woodpecker, authorize
`gitea_docker_registry` server-side for `push` and `tag` events and the exact
`woodpeckerci/plugin-docker-buildx:6.0.3` image, never PRs. There is no native
branch filter for secrets; workflow conditions do not replace trusting push
writers or stronger secret-backend policy. SMTP stays main-push-only, unchanged
by release tags. Confirm provider permissions and actual runs as described in
[development](development.md#main-and-release-image-publication).

The Docker build copies compiled output and pruned production dependencies into
the non-root runtime image. Operator
YAML, secrets and mounted public files are excluded from the build context.
The runtime contains no application source, build toolchain or browser installation.
Final container behavior, mounts and image size are owner-run manual checks.

## Owner Docker review checklist

These checks require your Docker installation; source/Node checks alone are not
a Docker pass. Use disposable copies of any real configuration.

1. Run `docker compose config --quiet` and the equivalent with
   `-f docker-compose.dev.yml`. Build/start each setup above; confirm health,
   configured copy, logs, Ctrl-C and restart. Try source reloads in dev and ensure
   no root-owned files appear in the host checkout.
2. After the production build, check the **actual image**, not compressed download
   size (adjust the image name if overridden):

   ```sh
   docker image inspect git.eleith.com/eleith.private/directory:latest \
     --format '{{.Size}} bytes; user={{.Config.User}}; arch={{.Architecture}}'
   docker compose exec directory-app id
   ```

   Require **less than 400000000 bytes**, non-root UID/GID 1000 and amd64 before
   approving publication. Inspect that the final image contains only runtime
   output/dependencies, not source, compiler, browser, fixtures or operator files.
   Check the effective root filesystem and bind-mount settings too:

   ```sh
   docker inspect "$(docker compose ps -q directory-app)" \
     --format 'read-only-root={{.HostConfig.ReadonlyRootfs}}{{range .Mounts}}; {{.Destination}} writable={{.RW}}{{end}}'
   docker compose exec directory-app node --eval \
     "require('node:fs').openSync('/app/config/directory.yaml','r+')"
   ```

   Require `read-only-root=true` and `writable=false` for `/app/config` and
   `/app/public`. The write-open command must fail; it requests write access
   without changing file bytes. Only `/tmp` is intended to be writable.

3. Edit site copy, save by atomic rename, then try invalid YAML and deletion/
   restoration. Last-good copy and generic health must survive later failures.
   With the container stopped, invalid YAML or enabled auth with a missing secret
   or invalid origin must fail closed on startup. Restore valid settings afterwards.
4. In credentials mode, try wrong/right passwords, JavaScript disabled, sign-out,
   and a private `__data.json` URL without a session. Only the signed-in session
   should reach bookmark cards, details and directory data. Click a card to its
   real `?link=<id>` details, use the separate new-tab service link and return with
   Back to directory. Try JavaScript disabled. Changing auth must require a
   restart, not silently alter a running session policy.
5. In the normal HTTPS/proxy setup, verify redirects, Secure cookies, CSRF,
   configured OIDC callback and proxy throttling. Rotate the session secret and
   confirm old sessions stop working. Do not treat local HTTP smoke or a fake
   issuer as a verified external-provider deployment.
