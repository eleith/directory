---
'@directory/web': patch
'@directory/cli': patch
---

Require YAML lists for bookmark tags, defaulting to an empty list. Commas inside a label are literal. Replace old comma-separated tag strings with explicit lists.
