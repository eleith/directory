---
'@directory/web': minor
'@directory/cli': minor
---

Present a responsive, branded sign-in page with readable primary actions, generic error banners and desktop-only initial focus. Publish the two configured primary colors, derived button foregrounds and selected site logo bytes through a dedicated public `/logo` alias; keep source URLs and private directory/auth data protected. Use 🗂️ as the bundled application mark.

Normalize omitted site logo and favicon paths to `/favicon.svg` in the shared config loader used by both web and CLI. Both apps accept that explicit bundled site selection while bookmark image paths remain mounted-only; web maps mounted site selections to public branding aliases.
