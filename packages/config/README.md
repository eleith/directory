# @directory/config

Shared configuration for Directory. The [contract](../../docs/config.md) lists fields,
defaults, paths and environment syntax.

```ts
import { loadConfigFile } from '@directory/config';

const config = await loadConfigFile('config/directory.yaml', { env: process.env });
```

`loadConfigFile(path?, { env }?)` reads YAML and calls
`validateConfig(raw, { env }?)`. Both apply defaults, interpolate string values,
and check the canonical TypeBox schema. Loaded `site.logo_path` and
`site.favicon_path` are required strings, defaulting independently to bundled
`/favicon.svg`. Site images accept that explicit bundle or a strict mounted
`/public/` image path; bookmark image fields stay optional and mounted-only.
Omitting `env` uses `process.env`; an
injected map is used on its own. Neither function watches files or publishes
state. The loader returns a fresh private configuration without changing the
input. Preparing the browser's directory data and immutable snapshots belongs
to the web server.

Input is checked before defaulting: arrays, nulls, non-plain or cyclic objects,
accessors, hidden/symbol properties and unsafe keys are rejected. This prevents
TypeBox object defaults from changing invalid input into valid objects. Fields
are never silently removed.

Failures throw `ConfigError` with a safe message and readonly `issues` containing
`code`, `path` and `message`. Values, filenames, variable names and original
exceptions are excluded. Known field names remain visible; link IDs and unknown
names become `*`. Catch unexpected errors without printing their raw contents.

The package also exports `resolveConfigPath`, `resolveDeploymentRoot` and
`resolvePublicDir`. These resolve operational paths without reading assets.
The default layout has sibling `config/` and `public/` directories.

Directory state, snapshot preparation and reload policy belong to the web server.
The shared loader keeps no cached configuration. See the web server's
[directory API](../../docs/development.md#prepared-configuration-snapshots).

Browser code must use **type-only** imports from `@directory/config/types`; the main
entry imports filesystem and validation code. `@directory/config/schema.json` is the
generated text-editor schema. See [development](../../docs/development.md) for
build, schema-drift and test commands.
