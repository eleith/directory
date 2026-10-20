# Docker and Compose

Directory has one web container, following When's separate development and
production Compose pattern. No host Node/pnpm installation is needed. Published
images target Linux amd64; there is no worker, database or writable data volume.
The UI renders bookmark groups and plain details with service links and prepared
bookmark logos when no logo path is configured. Configured image files are now
served only for exact snapshot references, with bounded 5 MiB reads and the
directory's authentication policy, including configured site favicons.

## Local production review

From the repository root, prepare files in the web directory so Compose reads
the adjacent `.env`. These commands create only missing config/env files and
preserve any existing operator configuration:

```sh
cd apps/web
test -e .env || cp -n .env.example .env
test -e config/directory.yaml || cp -n config/directory.example.yml config/directory.yaml
mkdir -p public
```

The production starter is empty and has **open access**, with no session secret
required. Enable your own [authentication](#authentication-and-https) before
publishing. Existing active YAML remains unchanged and may have different auth
requirements. If auth is enabled, set a unique random `AUTH_SECRET` of at least
32 characters and a matching origin before starting; there is no fallback.

For the populated local-only review instead, follow [demo/README.md](../demo/README.md).
It documents explicit configuration replacement after backup, non-overwriting
image copies into the runtime mount, and the required secret. Its preferred
native preview leaves operator configuration and media untouched. Demo files
are excluded from the Docker build context, not copied into the image.

Once the configuration choice and any auth settings are ready, still in `apps/web`:

```sh
docker compose up --build --pull never
```

Open **http://localhost:3000**, not an HTTP IP address when auth is enabled.
`/healthz` returns generic readiness. Stop with Ctrl-C; `docker compose down`
removes the container, not your mounted files. Add `-d` to run in the background
and use `docker compose logs -f` for diagnostics.

Edit your ignored `config/directory.yaml`, never the tracked starter or demo, to try
site-copy reloads. The **directory** mount keeps atomic rename saves visible.
Invalid later YAML keeps the last valid snapshot; invalid initial YAML prevents
startup. Auth changes require a process restart, not just a polling interval.
See the [configuration contract](config.md).

The production service runs as UID/GID **1000:1000**, with a read-only root
filesystem, temporary `/tmp`, and read-only config/public mounts. Ensure this
identity can read the mounted files and traverse their directories. Do not fix
permissions with a recursive world-writable change. Nothing writes to your
configuration or assets. The `public` mount supplies the protected image endpoint;
**do not serve it directly through a proxy**. Only trusted operator SVGs belong
here: image recognition is not sanitization or a full decoder. Missing directories
or files do not prevent startup; unavailable images return generic 404s.

Mounted-file reads require Linux `/proc/self/fd` access to validate the opened
inode. This applies to the container and native Node; missing procfs fails closed
with 404. The root is resolved once at boot, by default as `public` below the
selected config path's grandparent (`/app/public` in production Compose).
`DIRECTORY_PUBLIC_DIR` can override it; relative values use the process working
directory. This selects the root, not permission to serve arbitrary files under
it. See [image behavior](config.md#urls-and-images).

## Authentication and HTTPS

The production starter has no auth. Before publishing, configure your own
[credentials or OIDC strategy](config.md#authentication-shapes) in the mounted YAML;
never use the isolated demo's known credentials for a deployment.
Set a unique generated session secret and any custom YAML environment references in
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

This custom YAML needs `DIRECTORY_PASSWORD` in `.env`, in addition to `AUTH_SECRET`.
Only YAML that references it needs that variable. Do not put real credentials
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
client-supplied forwarding headers. Invalid auth environment settings stop
startup with `auth_failed` and a fixed, value-free hint naming the setting to fix.

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

First complete the configuration choice and, if enabling auth, the stable
`AUTH_SECRET` setup above. Use the same `.env`, YAML and public directory. If your host identity is not
1000:1000, set `LOCAL_UID`/`LOCAL_GID` in `.env` using `id -u` and `id -g`.
These settings control both image-generated directory ownership and the running
user. Rebuild after changing them.

```sh
ORIGIN=http://localhost:5173 docker compose -f docker-compose.dev.yml up --build
```

With mise and fnox installed, `ORIGIN=http://localhost:5173 mise docker up --build`
is an optional shortcut from this directory. It uses `docker-compose.dev.yml`.
The `*.local.toml` files stay outside Git, formatting and the Docker build context.

The shared fnox config has no session-secret default. If auth is enabled, supply
a random `AUTH_SECRET` through your local fnox provider, shell or `.env`. No-auth
configurations need no secret. If your existing `mise docker` workflow supplies
that secret through fnox, keep using it. Compose passes that value into the container; the app still
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
YAML, secrets, mounted public files and the isolated `demo/` directory are excluded
from the build context.
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
5. In a disposable public mount, configure a bookmark's `logo_path` to a small
   trusted SVG. With JavaScript disabled, check its card and details render after
   sign-in. Without a session, GET/HEAD requests to both mounted files and
   `/bookmarks/<id>/logo` must return 401 even with `Accept: text/html`; configured
   site favicons are private too. Check private/no-store and nosniff headers,
   bodyless HEAD, unreferenced and escaping-symlink 404s, missing-file recovery,
   atomic image replacement, and valid/invalid YAML reference reloads. Omit
   `logo_path` to check the prepared logo remains usable. Verify the actual
   container's procfs descriptor lookup as its non-root runtime user:

   ```sh
   docker compose exec directory-app node --input-type=module --eval \
     "import {open,realpath} from 'node:fs/promises'; const f=await open('/app/config/directory.yaml'); try { await realpath('/proc/self/fd/'+f.fd); console.log('procfs descriptor lookup available'); } finally { await f.close(); }"
   ```

   Do not replace this owner-run image/mount check with a host-only Node result.

6. In the normal HTTPS/proxy setup, verify redirects, Secure cookies, CSRF,
   configured OIDC callback and proxy throttling. Rotate the session secret and
   confirm old sessions stop working. Do not treat local HTTP smoke or a fake
   issuer as a verified external-provider deployment.
