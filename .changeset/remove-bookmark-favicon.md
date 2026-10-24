---
'@directory/web': patch
'@directory/cli': patch
---

Remove `links.*.favicon_path` and the small destination icon. Bookmarks retain their primary logo, and `site.favicon_path` is unchanged. Existing configurations must remove bookmark `favicon_path` fields.
