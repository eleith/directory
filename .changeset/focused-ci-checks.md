---
'@directory/web': patch
'@directory/cli': patch
---

Remove duplicate package linting from CI. Keep web publication gated on its shared configuration dependency without rebuilding or testing the unrelated CLI, and avoid repeated coverage collection in that gate. CLI checks remain in its own pipeline.
