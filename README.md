# HM Map Reconstruction

Private standalone development repository for the browser-based Map Reconstruction application extracted from HappyMeasure.

The target is an offline-first static Web application with no Python runtime, Qt runtime, local server, network dependency, hardware access, or instrument state.

## Current prototype

Implemented on the prototype branch:

- HappyMeasure `single-v2` CSV import and raw trace preview
- Signal Preparation: none, constant, manual regions, rolling quantile
- Legacy Dual Offset reconstruction
- Dual Offset — Phase Window reconstruction
- scan orientation and sample-count QC
- map processing, normalization, log scale, color levels and histogram
- `.hmmap` v1/v2/v3 import with SHA-256 verification
- Web-created `.hmmap` export using the existing project schemas
- dependency-free Node tests

Open `index.html` directly in a modern browser. Run tests with:

```bash
npm test
```

## Migration boundary

The existing Python/Qt Map Reconstruction in `Xiaolong-6/HappyMeasure` remains the scientific reference implementation during migration and must remain untouched for now.

Only after cross-runtime parity, historical-project compatibility, browser/offline acceptance and replacement validation pass should HappyMeasure get a separate cleanup branch removing the desktop Map Reconstruction code, packaging and obsolete documentation.

See `docs/MIGRATION_PLAN.md`.
