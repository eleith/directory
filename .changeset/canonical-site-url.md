---
'@directory/web': minor
'@directory/cli': minor
---

Use canonical `site.url` for public metadata and auth; migrate `auth.origin` to `site.url`. Default to localhost with the runtime port (development 5173, otherwise 3000).
