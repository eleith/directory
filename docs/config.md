# Configuration contract

The canonical [TypeBox schema](../packages/config/src/schema.ts) defines the
configuration and inferred TypeScript types. The generated
[editor JSON Schema](../packages/config/src/config.schema.json) describes authored
optionality: fields with defaults can be omitted, but link titles/URLs and auth
credentials remain required.

**Current scope:** schema, types and editor generation only. The application does
not read YAML or enforce this configuration yet. `where validate`, environment
expansion, redacted loading errors, authentication and dashboard rendering are
not implemented in this commit. CLI help still works; `validate` still fails.
Do not treat a schema-valid auth block as an active access-control feature.

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
work, not this schema-only step.

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
only literal text at this stage; C3 will expand them before runtime validation.
Editors do not expand environment values, so references in constrained URL,
image-path or color fields may be flagged until interpolation-aware tooling is
added with the loader. Never put real credentials into committed examples.

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
entry is empty and does not import the schema, format registry or a future loader.
The canonical schema's TypeBox format registry entry is namespaced
`where-http-url`; the editor copy uses standard `uri` plus the HTTP(S) pattern.
