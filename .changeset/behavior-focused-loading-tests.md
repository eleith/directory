---
'@directory/web': patch
---

Simplify browser loading tests by removing bundle-graph and generated-source assertions. Keep checks for on-demand search and opening details without additional code or page-data requests. Application behavior is unchanged.
