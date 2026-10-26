---
'@directory/web': minor
'@directory/cli': minor
---

Configure authentication entirely in YAML: `auth.origin` is required when authentication is enabled, and `auth.secret` is optional. Directory generates a session secret at startup by default; set an explicit secret to keep sessions across restarts. Ordinary configuration reloads preserve sessions.

Docker Compose no longer requires `.env`, `AUTH_SECRET`, `ORIGIN`, or `AUTH_URL`. Existing authenticated deployments must move their origin into YAML and explicitly reference or set a secret if they need persistent sessions.
