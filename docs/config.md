# Configuration contract

The canonical [TypeBox schema](../packages/config/src/schema.ts) defines the
configuration and inferred TypeScript types. The generated
[editor JSON Schema](../packages/config/src/config.schema.json) describes authored
optionality: fields with defaults can be omitted, but link titles/URLs and auth
credentials remain required.

The shared loader and `directory validate` now read YAML, apply defaults, expand
environment values and validate the result. The web server loads a complete
immutable snapshot before serving, captures it once per request, and polls the
configuration path for changes. The shell renders configured site copy; dashboard
links and images are not served yet. Omit auth for open access, or configure shared
credentials or OIDC to protect the whole directory. Enabled authentication requires
`AUTH_SECRET` and matching `ORIGIN`/`AUTH_URL` before the web server can start.

## Migrating from Where

Directory was previously named Where. The package namespace is now `@directory/*`,
the CLI executable is `directory`, the default filename is `config/directory.yaml`,
and the public-directory override is `DIRECTORY_PUBLIC_DIR`. An explicit
`CONFIG_PATH` can still point to an existing `config/where.yaml` file. Update
operator environments manually; there is no automatic fallback or migration.
The configuration format version and fields are unchanged.

## Start with the example

See [directory.example.yml](../apps/web/config/directory.example.yml). Its schema comment
points to the actual checked-in artifact relative to `apps/web/config`:

```yaml
# yaml-language-server: $schema=../../../packages/config/src/config.schema.json
links:
  photos:
    title: Photos
    url: https://photos.example.com
```

There is no hosted schema URL. If copying the file elsewhere, update the schema
comment to the artifact's real location. The package also exports
`@directory/config/schema.json`; runtime consumers resolve compiled ESM, not TS source.

## Loading and validation

```sh
pnpm cli -- validate apps/web/config/directory.example.yml
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

`DIRECTORY_PUBLIC_DIR` can override that sibling public directory. Relative overrides
resolve from the working directory. Validation checks image-path syntax only;
it does not inspect this directory or contact any destination.

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

| Field                                 | Contract                                                                                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`                             | Only `1`; defaults to `1`. This is the file format, not the app release.                                                                                                      |
| `site`                                | Optional object. Defaults: title `Directory`, description/footer empty, order `configured`.                                                                                   |
| `site.logo_path`, `site.favicon_path` | Optional independent local images; omission leaves bundled branding to the future UI.                                                                                         |
| `site.order`                          | `configured` or `alphabetical`; defaults to `configured`.                                                                                                                     |
| `appearance`                          | Optional object. `primary_light_color` defaults to `#0f766e`, `primary_dark_color` to `#5eead4`. Colors use three or six hex digits.                                          |
| `auth`                                | Omit for no auth; otherwise exactly one complete strategy below. No default strategy or credentials.                                                                          |
| `links`                               | Required keyed map; `{}` is an explicitly empty directory. Each value requires `title` and `url`; `tags` defaults to `''` and the three advisory booleans default to `false`. |

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
hide links nor change the directory's actual `auth` strategy. Prepared grouping
and ordering are implemented; rendering, badges and search remain later work.
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
directory HTML, Kit data responses and future service assets require a session.
The sign-in page exposes only the site title and sign-in strategy, not links or
private configuration. Mounted branding/images remain later work.

When auth is enabled, set these server environment variables:

- `AUTH_SECRET`: a random string of at least 32 characters, generated with
  `openssl rand -base64 32`. It protects encrypted, seven-day JWT session cookies.
- `ORIGIN`: the fixed public root origin, for example
  `https://directory.example.com`, with no path, query, credentials or trailing slash.
  Enabled auth uses HTTPS, with HTTP allowed only on `localhost` for local
  development, such as `http://localhost:5173`.
- `AUTH_URL`: the same value as `ORIGIN`. This is Auth.js's standard URL setting;
  callbacks do not depend on client-supplied Host or forwarded headers. The proxy
  must still use the configured public origin. Legacy Auth.js URL settings, if
  present, must not conflict.

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

Images are decoded `/public/...` paths with SVG/PNG/JPEG/GIF/WebP extensions.
Unicode/spaces and nested directories are allowed; empty/dot segments, percent
escapes, backslashes, queries, fragments and control characters are not. This is
syntactic validation, not filesystem access or MIME inspection. Containment,
symlink/type checks and private-asset authentication are later server work. SVG
files are trusted operator content, not uploads; mounted assets must never be
served directly by a proxy merely because the directory is named public.

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
