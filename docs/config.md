# Configuration contract

The canonical [TypeBox schema](../packages/config/src/schema.ts) defines the
configuration and inferred TypeScript types. The generated
[editor JSON Schema](../packages/config/src/config.schema.json) describes authored
optionality: fields with defaults can be omitted, but link titles/URLs and auth
credentials remain required.

The shared loader and `where validate` now read YAML, apply defaults, expand
environment values and validate the result. The web page still uses no operator
configuration. Authentication, file reloads and dashboard rendering are later
work; a valid auth block does not enable access control yet.

## Start with the example

See [where.example.yml](../apps/web/config/where.example.yml). Its schema comment
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
`@where/config/schema.json`; runtime consumers resolve compiled ESM, not TS source.

## Loading and validation

```sh
pnpm cli -- validate apps/web/config/where.example.yml
```

The wrapper builds the shared package and standalone CLI first. The compiled
command is `node apps/cli/dist/index.js validate [path]`; its executable is named
`where`. Gunshi defines commands and generates help, as in When. It accepts one
leading `--` for package-manager forwarding. Use `where --help` or
`where validate --help` for usage; help after a path also leaves the file unread.

Path selection is explicit argument, then `CONFIG_PATH`, then
`config/where.yaml`, relative to the working directory. There is no production-
specific path or search for nearby files. The deployment layout is:

```text
deployment/
  config/where.yaml
  public/
```

`WHERE_PUBLIC_DIR` can override that sibling public directory. Relative overrides
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
  order: '${WHERE_ORDER:-configured}'
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
| `site`                                | Optional object. Defaults: title `Where`, description/footer empty, order `configured`.                                                                                       |
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
retains the authored string; splitting labels belongs to prepared display/search
work, not loading or validation.

`group` is an optional nonblank display label, independent of tags. If every link
omits it, the planned directory is flat. If any link has a group, ungrouped links
appear under Other. No category collection or global `group_by` selector is
needed. Configured ordering preserves declaration order; alphabetical sorts group
labels/link titles with stable ties, with the ungrouped Other bucket last. A real
group named Other remains distinct from that missing-group bucket.

The three booleans are **informational service hints only** and default to false:

- `requires_auth`: opening this service needs sign-in; not Where's auth setting.
- `internal_only`: intended for LAN/VPN access; no network detection or enforcement.
- `admin_only`: intended for administrators; no role or visibility restriction.

False means no advisory badge, not a verified claim about the service. All
visitors authorized to open Where still see the same links. These flags neither
hide links nor change the directory's actual `auth` strategy. Rendering/grouping,
badges and search are later work, not implemented by the schema.

## Authentication shapes

Declare one, never both:

```yaml
auth:
  credentials:
    username: family
    password: '${WHERE_PASSWORD}'
```

```yaml
auth:
  oidc:
    issuer: https://identity.example.com
    client_id: where
    client_secret: '${WHERE_OIDC_CLIENT_SECRET}'
```

Username/password and all three OIDC fields are required and nonempty. Empty,
null, unknown or mixed auth blocks are invalid; disabling the other strategy with
`null` is invalid too. Omit `auth` entirely for no auth. Environment references are
expanded before validation, including in OIDC issuer URLs. Editors recognize
template syntax but cannot check the environment's values. Never put real
credentials into committed examples.

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

Browser-facing code may import **types only** from `@where/config/types`. Its JS
entry is empty and does not import the schema, format registry or loader.
The canonical schema's TypeBox format registry entry is namespaced
`where-http-url`; the editor copy uses standard `uri` plus the HTTP(S) pattern.
