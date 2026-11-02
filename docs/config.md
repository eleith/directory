# Configuration

your `config/directory.yaml` controls the behavior and appearance of your
directory. craft it with care as yaml is powerful but unforgiving...

## Config

Start with the [example](directory.example.yaml). The tables below follow the
YAML headings; `credentials.username` means `username` inside `credentials`.
Defaults apply when you leave a field out. Unknown fields and `null` are errors.

[version](#version) · [site](#site) · [appearance](#appearance) ·
[links](#links) · [auth](#auth) · [Images](#images) · [Environment values](#environment-values)

### version

| Field     | Value                         | Default |
| --------- | ----------------------------- | ------- |
| `version` | `1`. The file format version. | `1`     |

### site

| Field                   | Value                                                                                                   | Default                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `url`                   | Public HTTP(S) origin; no credentials, path, query, fragment or trailing slash. Restart after changing. | `http://localhost:PORT` (dev `5173`, otherwise `3000`) |
| `title`                 | Nonblank text, e.g. `Home`.                                                                             | `Directory`                                            |
| `description`           | Text below the title; public in Open Graph previews.                                                    | Empty                                                  |
| `footer`                | Text at the bottom of the page.                                                                         | Empty                                                  |
| `logo_path`             | [Image path](#images), e.g. `/public/house.svg`, or `/favicon.png`.                                     | `/favicon.png`                                         |
| `favicon_path`          | Browser tab icon. Same path options as `logo_path`.                                                     | `/favicon.png`                                         |
| `og_image_path`         | Public Open Graph [image path](#images), e.g. `/public/share.png`.                                      | Auto-generated                                         |
| `open_links_in_new_tab` | `true` or `false`. Applies to every destination.                                                        | `true`                                                 |

### appearance

| Field                 | Value                                           | Default     |
| --------------------- | ----------------------------------------------- | ----------- |
| `primary_light_color` | Quoted hex color, e.g. `'#087'` or `'#008877'`. | `'#0f766e'` |
| `primary_dark_color`  | Quoted hex color.                               | `'#5eead4'` |

Quote the `#`, or YAML will helpfully turn your color into a comment.

### links

Required. Use `links: {}` for an empty page, or give each link an id (using only
lowercase letters and hyphens if you must):

```yaml
links:
  lights:
    title: Lights
    url: http://homeassistant.local:8123
    group: Around the house
    tags: [lights, home]
```

| Field           | Value                                               | Default            |
| --------------- | --------------------------------------------------- | ------------------ |
| `title`         | Nonblank name.                                      | Required           |
| `url`           | Full `http://` or `https://` address.               | Required           |
| `description`   | Plain-text notes; use YAML `\|` for multiple lines. | None               |
| `group`         | Nonblank heading, e.g. `Around the house`.          | Ungrouped          |
| `tags`          | List of text labels, e.g. `[family, photos]`.       | `[]`               |
| `logo_path`     | [Image path](#images), e.g. `/public/lights.png`.   | Generated initials |
| `requires_auth` | `true` if the service needs sign-in.                | `false`            |
| `internal_only` | `true` if intended for LAN/VPN access.              | `false`            |
| `admin_only`    | `true` if intended for administrators.              | `false`            |

The three flags are labels only. They do not restrict access or hide links.

### auth

Omit this section to share your directory with the world.

Use `credentials` for a basic username and password or `oidc` to turn it up to
11 and wire into your authentication fiefdom. Choose one.

| Field                  | Value                                                                             | Default                   |
| ---------------------- | --------------------------------------------------------------------------------- | ------------------------- |
| `secret`               | Optional random string of at least 32 characters. Keeps sessions across restarts. | Generated at each startup |
| `credentials.username` | Shared username, e.g. `family`.                                                   | Required for credentials  |
| `credentials.password` | Password, or `'${DIRECTORY_PASSWORD}'`.                                           | Required for credentials  |
| `oidc.issuer`          | Your provider’s full HTTP(S) issuer URL.                                          | Required for OIDC         |
| `oidc.client_id`       | Client ID registered with your provider.                                          | Required for OIDC         |
| `oidc.client_secret`   | Secret, or `'${DIRECTORY_OIDC_CLIENT_SECRET}'`.                                   | Required for OIDC         |

## Images

Put `photos.png` in `public/` beside your Compose file and use
`/public/photos.png` in YAML.

Use SVG, PNG, JPEG, GIF, or WebP, at most **5 MiB** each.

## Environment values

The config supports interpolation so you can keep secrets out of your config or
just add a little dynamicness to your staticness.

This is optional. Create `.env` beside your Compose file with only the values
you want to keep there:

```dotenv
DIRECTORY_PASSWORD=replace-with-your-own-password
```

Then use `password: '${DIRECTORY_PASSWORD}'` in your YAML auth block.
Compose passes the value to Directory. Keep `.env` private and out of Git.
After editing it, run `docker compose up -d --force-recreate` to apply the change.

| Syntax             | Meaning                                            |
| ------------------ | -------------------------------------------------- |
| `${VAR}`           | Required value; missing is an error.               |
| `${VAR:-fallback}` | Fallback when unset. An empty value counts as set. |
| `$$`               | Literal `$`. `$${VAR}` displays `${VAR}`.          |

## Validation

We all could use a little validation every now and then.

We publish a json schema to give you little red squigglies but you can also use
our cli when you are in a pinch.

Find the schema at `/schema.json`:

```yaml
# yaml-language-server: $schema=http://localhost:3000/schema.json
```

From the folder containing `compose.yaml`:

```sh
docker compose run --rm directory-cli config validate
```
