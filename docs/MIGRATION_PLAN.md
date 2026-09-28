# Map Reconstruction Web migration plan

## Status

The standalone Web replacement is in late acceptance.

Repository: `Xiaolong-6/HM-Map-Reconstruction`

Current workflow:

1. Import Data
2. Signal Preparation
3. Reconstruction
4. Map Analysis

The repository is public. The Web runtime is static and offline-capable.

## Scientific reference

Pinned HappyMeasure oracle:

- repository: `Xiaolong-6/HappyMeasure`
- commit: `402b88f1c42cff41bf6054e1724bc62b4deb7af3`
- reference implementation: `src/map_reconstruction/`
- reference tests: `tests/map_reconstruction/`

Do not silently move this pin. If the desktop scientific behavior changes before final cutover, update the pin deliberately and regenerate parity expectations.

## Completed

### Import

- HappyMeasure `single-v2`;
- generic numeric table mapping;
- generated or explicit time;
- multi-signal selection;
- incomplete-row filtering;
- drag/drop;
- project open.

### Signal Preparation

- none;
- constant;
- manual dark regions;
- rolling quantile;
- constant/linear/quadratic manual-region fit;
- response-direction handling;
- value gate;
- independent baseline subtraction and inversion;
- interactive trace and draggable dark regions.

### Reconstruction

- Phase Window user workflow;
- Legacy Dual Offset compatibility conversion;
- same-direction and serpentine orientation;
- mean/median aggregation;
- sample-count QC;
- draggable YA/YB/XA/XB;
- automatic reconstruction on edits;
- geometry-driven registration recommendation;
- interactive map axes, colorbar, zoom and pan.

### Analysis

- map baseline;
- transform;
- normalization;
- log10;
- palette and range controls;
- histogram;
- processed exports and report.

### Project compatibility

- read v1/v2/v3;
- source SHA-256 verification;
- Python-created → Web compatibility;
- Web-created → Python validation;
- browser Save → reopen round-trip.

### Browser/offline acceptance

- direct `file://` boot;
- fixed-viewport desktop workflow;
- 120,000-point browser gate;
- offline ZIP;
- self-contained static runtime.

### Real-data acceptance

Private historical acceptance has covered 5 projects and 7 HappyMeasure CSV files, including 36×36 / 50×50 geometry and manual-region preparation. The measurement corpus is not committed publicly.

## Remaining replacement gate

Before deleting desktop Map Reconstruction from HappyMeasure:

- user accepts the current browser workflow on representative real measurements;
- no unresolved scientific parity discrepancy remains;
- offline/browser packaging is accepted;
- public documentation accurately describes the supported-data boundary.

After acceptance, create a separate HappyMeasure cleanup branch/PR to remove:

- desktop Map Reconstruction Python/Qt UI and application code;
- desktop Map Reconstruction packaging/build path;
- obsolete desktop-only tests;
- obsolete desktop documentation.

Retain interoperability contracts still needed by the Web application, especially HappyMeasure CSV and `.hmmap` compatibility references.

## Stop conditions

Investigate instead of compensating in UI code when:

- Python/Web scientific output diverges for the same covered input/configuration;
- a new acquisition cannot be represented by the Phase Window assumptions;
- project compatibility would require silently changing existing schema meaning;
- browser numeric behavior creates a reproducibility concern;
- large-data handling creates avoidable authoritative-array copies.
