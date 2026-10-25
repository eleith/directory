---
'@directory/cli': major
'@directory/web': patch
---

Replace `directory validate [path]` with `directory-cli config validate [path]`. Remove the unused JavaScript package API and standalone artifact tests; retain focused tests for command behavior and safe diagnostics.

Provide a dedicated CLI image and a one-shot `directory-cli` Compose tools service sharing the app's configuration and environment. Run `docker compose run --rm directory-cli config validate` without starting the app. The web development image no longer packages the CLI.
