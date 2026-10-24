---
'@directory/web': patch
'@directory/cli': patch
---

Remove `site.order` and automatic alphabetical sorting. Groups and bookmarks follow YAML declaration order, with ungrouped bookmarks last. Existing configurations must remove `site.order`.
