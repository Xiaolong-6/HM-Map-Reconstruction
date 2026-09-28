# Architecture and extension model

## Design goal

The application separates four concerns:

```text
Import → Preparation → Reconstruction → Analysis
```

A new reconstruction model should not require rewriting the other three stages.

## Modules

### Import

- `src/csv.js` — HappyMeasure `single-v2` parser
- `src/importing.js` — generic delimited-table inspection and canonicalization

Output: sorted time array + named signal arrays + metadata.

### Preparation

- `src/preparation.js`

Output: prepared signal, baseline and normalized preparation configuration.

### Reconstruction

- `src/reconstruction.js` — reconstruction strategy implementations and timing semantics
- `src/registration.js` — geometry-driven registration recommendation

Current user-facing strategy: `dual_offset_phase_window`.

Legacy Dual Offset remains only as a compatibility implementation for old projects and parity tests.

### Analysis

- `src/processing.js` — map-level processing and histogram
- `src/plotting.js` — scientific rendering primitives
- `src/interactive_plot.js` — trace and heatmap interaction controllers
- `src/exporting.js` — reproducibility/data/report exports

### Project persistence

- `src/project.js`

Owns `.hmmap` read/write, schemas and source SHA-256.

## Adding a future reconstruction strategy

A future strategy is appropriate when the acquisition cannot be represented honestly by the current constant-period raster lattice.

Examples may include:

- variable row periods;
- time-warped/accelerating scans;
- multiple raster segments;
- explicit XY-position trajectories;
- event-triggered acquisition.

The new strategy should:

1. have a distinct method identifier;
2. define and validate its own parameter schema;
3. consume the common prepared time/signal contract;
4. return the common map result contract:
   - rows;
   - columns;
   - values;
   - sample counts or an equivalent QC representation;
   - method-specific timing/diagnostics;
5. define scan orientation explicitly;
6. provide deterministic tests and scientific validation;
7. define project persistence without changing the meaning of existing v1/v2/v3 fields;
8. expose UI controls only when that strategy is selected.

Do not force fundamentally different data into Phase Window by adding increasingly opaque exceptions. The strategy boundary should remain scientifically explicit.

## Display separation

Trace/map zoom, axis ranges, palette, color limits and legend visibility are UI state. They should not alter scientific arrays.

The current `flip_y` field is persisted as display state.

## Offline boundary

Runtime code must remain browser-native and static. Any future dependency must be evaluated for:

- offline use;
- bundle size;
- deterministic scientific behavior;
- `file://` support;
- long-term maintainability.
