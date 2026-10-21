# Configuration contract

The canonical [TypeBox schema](../packages/config/src/schema.ts) defines the
configuration and inferred TypeScript types. The generated
[editor JSON Schema](../packages/config/src/config.schema.json) describes authored
optionality: fields with defaults can be omitted, but link titles/URLs and auth
credentials remain required.

The shared loader and `directory validate` now read YAML, apply defaults, expand
environment values and validate the result. The web server loads a complete
immutable snapshot before serving, captures it once per request, and polls the
configuration path for changes. Groups and bookmark titles render immediately,
with plain `?link=<id>` details and external service links. Cards and details use
prepared bookmark logos when no logo path is configured. Configured image files
are served only for exact references in the captured snapshot. Omit auth for open access, or
configure shared credentials or OIDC to protect the whole directory. Enabled authentication requires
`AUTH_SECRET` and matching `ORIGIN`/`AUTH_URL` before the web server can start.

## Migrating from Where

Directory was previously named Where. The package namespace is now `@directory/*`,
the CLI executable is `directory`, the default filename is `config/directory.yaml`,
and the public-directory override is `DIRECTORY_PUBLIC_DIR`. An explicit
`CONFIG_PATH` can still point to an existing `config/where.yaml` file. Update
operator environments manually; there is no automatic fallback or migration.
The configuration format version and fields are unchanged.

## Start with the production starter

[directory.example.yml](../apps/web/config/directory.example.yml) is a minimal,
credential-free production starter. It has an empty directory and open access,
with no session secret required. **Configure authentication before publishing.**
Its schema comment points to the checked-in artifact relative to `apps/web/config`:

```yaml
# yaml-language-server: $schema=../../../packages/config/src/config.schema.json
version: 1
links: {}
```

There is no hosted schema URL. If copying the file elsewhere, update the schema
comment to the artifact's real location. The package also exports
`@directory/config/schema.json`; runtime consumers resolve compiled ESM, not TS source.

For the separate populated, authenticated local review fixture and its image
setup, use [demo/README.md](../demo/README.md). The isolated `demo/` directory is
manual-only and excluded from builds and automated checks. It is never selected automatically at runtime.
Native preview can use it directly without changing operator files; Docker
review requires a deliberate manual copy. Back up existing active configuration
before replacing it. Auth changes require a process restart, not the config poll.

## Loading and validation

```sh
pnpm cli -- validate apps/web/config/directory.example.yml
pnpm cli -- validate demo/config/directory.yaml
```

The wrapper builds the shared package and standalone CLI first. The compiled
command is `node apps/cli/dist/index.js validate [path]`; its executable is named
`directory`. Gunshi defines commands and generates help, as in When. It accepts one
leading `--` for package-manager forwarding. Use `directory --help` or
`directory validate --help` for usage; help after a path also leaves the file unread.

Path selection is explicit argument, then `CONFIG_PATH`, then
`config/directory.yaml`, relative to the working directory. There is no production-
specific path or search for nearby files. The web server pins the selected path
at startup. `pnpm dev` runs from `apps/web`, so its default is
`apps/web/config/directory.yaml`; an absolute `CONFIG_PATH` avoids working-directory
ambiguity. The deployment layout is:

```text
deployment/
  config/directory.yaml
  public/
```

The server selects the public directory once at startup through the shared
`resolvePublicDir(configPath, { env, cwd })` helper. By default it uses `public`
below the selected configuration path's grandparent, as in the layout above.
`DIRECTORY_PUBLIC_DIR` overrides this location; relative overrides resolve from
the working directory, not the YAML directory. The helper does not require the
directory to exist. Environment changes require a restart.
Validation checks image-path syntax only; neither loading nor snapshot preparation
inspects image files or contacts any destination. The resolved filesystem root
stays server-private.

Files use one YAML 1.2 core document. Mapping keys are read as strings; duplicate
keys, collection keys, unknown tags and other YAML versions are rejected. Merge
keys are disabled. Alias expansion is bounded and cycles are rejected. Arrays,
non-plain objects and unsafe keys are rejected before defaults can alter them.
Explicit nulls and wrongly typed values are errors, not requests for defaults.
Unknown fields remain errors.

A valid file prints `Configuration is valid.` and exits 0. Invalid or unreadable
input exits 1. Errors contain fixed messages, codes and field paths such as
`/auth/credentials/password` or `/links/*/url`. Link IDs and unknown field names
are replaced with `*`; filenames, values, environment-variable names, parser
snippets and original exceptions are not printed.

### File changes and last-good state

The web server polls inode, modification time and size approximately once per
second. Mount the config directory rather than a single file so editor atomic
rename saves remain visible. Invalid edits and deletion keep the previous
snapshot; a later valid replacement recovers automatically. Ordinary requests do
not read YAML or prepare snapshots. `/healthz` stays generic and ready while a
last-good snapshot is serving.

An auth change rejects the entire replacement and reports `restart_required`,
including changes that enable or disable auth. It never partially accepts the
candidate's display changes or restarts the process automatically. Restore the
original auth to resume display reloads. Providers and session policy are captured
at startup; environment files are not polled.

## Environment values

Interpolation happens in string values **after YAML parsing**, not in keys. Values
from the environment are not parsed as YAML, expanded again, or converted to
booleans/numbers. Injecting an environment map through the loader API avoids
reading the process environment; the CLI normally uses its process environment.

| Syntax             | Meaning                                                                         |
| ------------------ | ------------------------------------------------------------------------------- |
| `${VAR}`           | Use a set environment value; otherwise fail validation.                         |
| `${VAR:-fallback}` | Use the fallback only when the variable is unset. An empty value counts as set. |
| `$$`               | A literal `$`; `$${VAR}` produces literal `${VAR}`.                             |

Names use uppercase ASCII letters, digits and underscores, starting with a
letter or underscore. Fallbacks are literal text ending at the first `}`. Other
dollar text is unchanged. Quote templates in YAML when punctuation could affect
YAML parsing.

For example:

```yaml
site:
  order: '${DIRECTORY_ORDER:-configured}'
links:
  photos:
    title: Photos
    url: '${PHOTOS_URL:-https://photos.example.com}'
```

The editor schema accepts supported templates in constrained string fields;
actual URLs, paths, colors and string choices are checked after expansion by the
loader. Required fields remain required. Booleans and numbers must be authored
with their actual YAML types.

**Public text stays public.** Using an environment variable in a title,
description, URL, tag or other display field does not make it secret. The future
dashboard will expose those values. Authentication configuration and session
secrets stay outside its display model. The validator prints neither kind.

## Fields and defaults

| Field                                 | Contract                                                                                                                                                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`                             | Only `1`; defaults to `1`. This is the file format, not the app release.                                                                                                                                                                                    |
| `site`                                | Optional object. Defaults: title `Directory`, description/footer empty, order `configured`.                                                                                                                                                                 |
| `site.logo_path`, `site.favicon_path` | Independent site images, normalized by the shared loader to bundled `/favicon.svg` when omitted. Explicit `/favicon.svg` is also valid. Header and sign-in show the logo at 48px. Mounted selections publish bytes at `/logo` and `/favicon` independently. |
| `site.order`                          | `configured` or `alphabetical`; defaults to `configured`.                                                                                                                                                                                                   |
| `appearance`                          | Optional object. `primary_light_color` defaults to `#0f766e`, `primary_dark_color` to `#5eead4`. Colors use three or six hex digits.                                                                                                                        |
| `auth`                                | Omit for no auth; otherwise exactly one complete strategy below. No default strategy or credentials.                                                                                                                                                        |
| `links`                               | Required keyed map; `{}` is an explicitly empty directory. Each value requires `title` and `url`; `tags` defaults to `''` and the three advisory booleans default to `false`.                                                                               |

Appearance colors are public branding: they accent keyboard focus, the directory's
Back-link underline and the filled sign-in action. Server-owned appearance emits
only these validated colors and derived readable foregrounds as semantic CSS in
the document head. The root layout sends only constant logo/favicon URIs. Page
surfaces stay unchanged. Sign-in foregrounds meet 4.5:1 contrast against
the configured primary; operators should still choose accessible focus accents.
Without JavaScript, colors follow the OS scheme. Refresh the document after
configuration reloads to update branding inputs.

Site copy and optional link `description` are plain strings. Description supports
multiline guidance; there is no separate `good_to_know` field. Logo and favicon
are independent optional fields too. Unknown structural fields are errors, not
ignored extras; the old `site.group_by`, `sign_in` and `works_from` fields are not
supported.

Link keys are lowercase letters/digits separated by single hyphens; a numeric-only
key is not a slug. `constructor`, `prototype` and `__proto__` are forbidden keys.

### Tags, groups and service hints

```yaml
tags: photos, videos, backup
group: Photos & files
requires_auth: true
internal_only: false
admin_only: false
```

`tags` is a simple comma-separated string, not a map or YAML list. It defaults to
an empty string. Commas separate labels; surrounding spaces and empty segments
are ignored for display/search. This is not a quoted CSV dialect, so a comma is
always a separator. Control characters/newlines are invalid. The configuration
retains the authored string. Snapshot preparation now produces display labels
by splitting commas, trimming spaces and dropping empty parts; loading and
validation leave the original string alone.

`group` is an optional nonblank display label, independent of tags. If every link
omits it, the planned directory is flat. If any link has a group, ungrouped links
appear under Other. No category collection or global `group_by` selector is
needed. Configured ordering preserves declaration order; alphabetical sorts group
labels/link titles with stable ties, with the ungrouped Other bucket last. A real
group named Other remains distinct from that missing-group bucket.

The three booleans are **informational service hints only** and default to false:

- `requires_auth`: opening this service needs sign-in; not Directory's auth setting.
- `internal_only`: intended for LAN/VPN access; no network detection or enforcement.
- `admin_only`: intended for administrators; no role or visibility restriction.

False means no advisory badge, not a verified claim about the service. All
visitors authorized to open Directory still see the same links. These flags neither
hide links nor change the directory's actual `auth` strategy. Grouping,
ordering and informational detail labels are rendered; search remains later work.
All advisory flag combinations preserve the same link inclusion.

## Authentication shapes

Declare one, never both:

```yaml
auth:
  credentials:
    username: family
    password: '${DIRECTORY_PASSWORD}'
```

```yaml
auth:
  oidc:
    issuer: https://identity.example.com
    client_id: directory
    client_secret: '${DIRECTORY_OIDC_CLIENT_SECRET}'
```

Username/password and all three OIDC fields are required and nonempty. Empty,
null, unknown or mixed auth blocks are invalid; disabling the other strategy with
`null` is invalid too. Omit `auth` entirely for no auth. Environment references are
expanded before validation, including in OIDC issuer URLs. Editors recognize
template syntax but cannot check the environment's values. Never put real
credentials into committed examples.

### Sessions and deployment

Auth is all-or-nothing: a valid session opens the same directory for everyone.
The service hints never become roles or per-link access rules. Sign-in and the
required OIDC callback, generic health status and bundled resources are public;
directory HTML, Kit data responses, generated bookmark logos and all mounted
source URLs require a session, including the selected favicon's `/public/...`
source. Image GET and HEAD requests return 401 before sign-in even with HTML
Accept, rather than redirecting to an HTML sign-in page.
The sign-in page exposes the site title, sign-in strategy, two primary colors,
derived button foregrounds and constant logo/favicon URIs, not links, descriptions,
sessions or private configuration. Dedicated public `/logo` and `/favicon` GET/HEAD
endpoints publish only the selected site's logo and favicon bytes respectively,
regardless of session. Selecting a bookmark/service image deliberately publishes
those same bytes through the selected alias; its raw source URL stays protected.
No configured source URI, filesystem path or image bytes enter public layout data.

When auth is enabled, set these server environment variables:

- `AUTH_SECRET`: a random string of at least 32 characters, generated with
  `openssl rand -base64 32`. It protects encrypted, seven-day JWT session cookies.
- `ORIGIN`: the fixed public root origin, for example
  `https://directory.example.com`, with no path, query, credentials or trailing slash.
  Enabled auth uses HTTPS, with HTTP allowed only on `localhost` for local
  development, such as `http://localhost:5173`.
- `AUTH_URL`: the same value as `ORIGIN`. This is Auth.js's standard URL setting;
  callbacks do not depend on client-supplied Host or forwarded headers. The proxy
  must still use the configured public origin.
- `NEXTAUTH_URL`: leave unset, or match `ORIGIN` exactly.
- `AUTH_REDIRECT_PROXY_URL`: unsupported; leave unset.

Invalid auth environment settings fail startup with `auth_failed` and a fixed
hint naming the failing variable and its requirement. Diagnostics never include
its value or raw error details. The standalone CLI does not check these web
runtime settings.

No-auth mode requires none of these variables. Production Node does not automatically
read `.env`; inject the environment through the process/container or Node's
`--env-file`. Cookies are HTTP-only and SameSite=Lax, and are Secure for HTTPS
origins. Protected/auth responses use private, no-store caching.

Register `${ORIGIN}/auth/callback/oidc` with your OIDC provider. Admission belongs
to that provider's application assignments, not local accounts or role mappings.
The app uses state, PKCE and nonce checks; do not turn them off for a provider.
Shared credentials have no built-in rate limiting or lockout: use reverse-proxy
throttling on sign-in or prefer OIDC for an internet-facing deployment.

Sign-out clears the browser's cookie. Restarting with the same `AUTH_SECRET` does
not revoke existing sessions; rotate it when changing access policy must end
existing access. No session database or revocation list is maintained. Loader/CLI
validation checks configuration shape and interpolated values, not provider
availability or these runtime environment prerequisites.

## URLs and images

Destinations and OIDC issuer URLs must be absolute HTTP(S), including local HTTP
hosts/ports when appropriate. Relative, protocol-relative, executable, malformed
or whitespace-containing URLs are rejected by the runtime schema.

Mounted images are decoded `/public/...` paths with SVG/PNG/JPEG/GIF/WebP extensions.
Unicode/spaces and nested directories are allowed; empty/dot segments, percent
escapes, backslashes, queries, fragments and control characters are not. This is
syntactic validation, not filesystem access or MIME inspection. Site logo and favicon
fields also accept the exact bundled `/favicon.svg` URI. The shared loader supplies
that URI independently for omitted site fields; normalized site paths are required
strings for both web and CLI consumers. Bookmark image fields stay optional and
mounted-only, with no bundled URI selection.

`links.*.favicon_path` optionally renders a decorative 24×24 icon inside the details'
Open service link. Omission renders no service icon. It is independent of the 64px
primary `links.*.logo_path`: with JavaScript, a failed service icon switches once
to `/bookmarks/<id>/logo`, not to the configured primary logo. A failed fallback
stops. Source or selected-link changes reset the attempt in place; repairing bytes
at an unchanged URL requires refresh. Without JavaScript, a broken icon stays
broken but the service link remains usable. Mounted source URLs and prepared
fallback endpoints require a session when auth is enabled. This field does not
select public branding; only `site.logo_path` and `site.favicon_path` publish
selected bytes through their separate public aliases.

`site.logo_path` renders a decorative, eager 48×48 image beside the directory title
and description. Omission uses bundled `/favicon.svg` directly in server-rendered
HTML, independently of `site.favicon_path`. With JavaScript, a failed configured
image switches once to the bundle, including failures before hydration; a failed
bundle stops without retrying. Without JavaScript, a broken configured image stays
broken while the title and navigation remain usable. Changing the source URL
allows a fresh primary attempt; repairing bytes at an unchanged URL requires a
refresh. With auth enabled, the configured source URL requires a session.
Sign-in uses public `/logo` for the same selection, with the same 48px/default/
fallback behavior. The bundled mark is 🗂️ (card index dividers). `/logo` reads only
the captured mounted `site.logo_path`, ignoring query selectors. A bundled selection
(default or explicit) returns 404 before image I/O; missing or invalid mounted
bytes return generic 404. A full document
refresh accepts new selection/bytes. Raw sources and nonselected assets stay private.

`site.favicon_path` selects a source image, not the public alias. The shared layout
maps validated mounted paths to `/favicon` and passes the resolved bundled URI
through unchanged; it does not choose defaults or send mounted source URIs or
private configuration. `/favicon` reads exactly the mounted source from the
request's captured snapshot using the same bounded reader and GET/HEAD response
headers below. A bundled selection (default or explicit) returns 404 before I/O. A missing, invalid or unavailable selected file also returns generic 404,
without redirecting or falling back to the bundle. Valid configuration reloads
change the selected bytes without changing the alias; invalid or auth-changing
candidates retain the last good selection. No auth hook exceptions are involved.

The mounted-file endpoint serves only exact `assets.referencedPaths` from the request's
captured snapshot: mounted site and bookmark logo/favicon paths, not bundled URIs or an
arbitrary directory listing or static file tree. GET and HEAD use private,
no-store and nosniff headers; HEAD has the same status/headers without a body.
There are no range or conditional-cache responses. Missing, unreferenced,
escaping, unreadable, unstable, oversized or unrecognized files receive a generic
404 without filesystem details. A missing public directory is valid at startup.
Accepted YAML reloads replace references; invalid or auth-changing candidates
retain the last good set. Image bytes are read on request, so missing files and
atomic image replacements recover without a YAML change.

Reads are bounded to 5 MiB per file. The reader checks canonical containment,
regular-file type, the opened descriptor's Linux `/proc/self/fd` location and file
stability. Symlinks resolving inside the selected root are allowed; escapes are
not. File signatures must match the supported extension; this is not a full image
decoder or XML validator. SVGs must be UTF-8 with an SVG root and no DTD/entity
markup. They are **trusted operator content**, not sanitized uploads or a safe
active-content boundary. Use only trusted files and do not expose the mounted
directory directly through a proxy. Mounted-file serving needs Linux with procfs;
without descriptor lookup it fails closed with 404, including in native Node.

### Prepared bookmark logos

The logo API at `/bookmarks/<id>/logo` currently returns a generated image, prepared
server-side with the snapshot, not during page or image requests. Display links
carry one resolved `logo_path`: the configured path when provided, otherwise this
logo API URL. Cards and details render that value in the initial HTML. With
JavaScript, a failed configured bookmark logo switches once to the same private
logo API, including when the image failed before hydration. A failed fallback
stops; an omitted primary already uses the API and is not retried on failure.
Without JavaScript, valid configured and prepared logos still render, but a broken
configured image cannot switch; text and navigation remain usable. Changing the
primary URL or selected link allows a fresh primary attempt in the existing image.
Repairing file bytes at the same URL does not trigger a browser retry: refresh the
document to try again. No second image field or client-side generator is involved.

The current internal renderer uses DiceBear core 10.4.0 and a matching local
Initials definition; no remote image service or browser generator is involved.
Letters come from the title, falling back to its slug when the title has no usable
letters. A stable group/link palette keeps the 64×64 images readable. The renderer
can change without changing display fields or logo API URLs.

Bookmark logos use the directory's authentication policy, including GET and HEAD.
A missing or removed bookmark gets a generic 404; responses are private/no-store
and nosniff. Only the local URL is page data, never SVG bytes or private config.

## Maintaining the contract

```sh
pnpm schema:generate
pnpm schema:check
pnpm verify
```

The generator compiles fresh canonical TS using the pinned compiler into a
clean, disposable directory, then emits deterministic JSON with local `$defs`
references. It walks maps/unions/nested schemas and removes only defaulted
properties from `required`; it does not alter runtime types or literal annotation
data. No generated TypeScript types or second runtime validator are maintained.

`schema:check` compares bytes without writing. It works before any build and is
the first gate in local `verify` and both providers' config pipeline. Build does
not regenerate the artifact or mask drift. Regenerate intentionally after schema
changes, review the JSON diff, and update examples/tests together.

Browser-facing code may import **types only** from `@directory/config/types`. Its JS
entry is empty and does not import the schema, format registry or loader.
The canonical schema's TypeBox format registry entry is namespaced
`directory-http-url`; the editor copy uses standard `uri` plus the HTTP(S) pattern.
