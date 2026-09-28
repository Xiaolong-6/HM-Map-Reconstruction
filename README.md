# HM Map Reconstruction

Browser-based map reconstruction for raster-like time-series measurements.

The application is a static, offline-capable Web tool extracted from HappyMeasure. It has no Python, Qt, local-server, hardware or instrument-state dependency at runtime. The hosted build is available at:

https://xiaolong-6.github.io/HM-Map-Reconstruction/

The same application can also be used from the CI-produced offline ZIP by opening `index.html` directly.

## Workflow

The application is organized as four independent scientific stages:

1. **Import Data** — open HappyMeasure `single-v2` CSV, generic delimited numeric data, or an existing `.hmmap` project.
2. **Signal Preparation** — select the signal, inspect the full time trace, define dark/baseline treatment, and optionally invert or gate the signal.
3. **Reconstruction** — define geometry, register the X/Y timing, reconstruct the map, and inspect samples per pixel.
4. **Map Analysis** — apply map-level baseline/transform/normalization, set display range and palette, inspect the value distribution, and export results.

Raw imported data remains authoritative. Display controls do not mutate stored scientific arrays.

## Current reconstruction model: Phase Window

The current production reconstruction model is **Dual Offset — Phase Window**. The old Legacy Dual Offset model is not exposed for new work; old projects using it are read for compatibility and converted to the Phase Window representation.

Let:

- `YA`, `YB` be two row timing anchors separated by `N_y` rows;
- `XA`, `XB` be two point timing anchors separated by `N_x` points;
- `r_0` be the zero-based row offset associated with `YA`;
- `φ_y` be the fractional Y phase;
- `k_x` be the integer X-period offset;
- `φ_x` be the fractional X phase;
- `R` and `C` be the requested map rows and columns.

The row and point periods are

```text
T_y = (YB - YA) / N_y
T_x = (XB - XA) / N_x
```

Both must be positive.

The time origin of reconstructed row 0 is

```text
t_row0 = YA - (r_0 + φ_y) T_y
```

The first X-window center within each row is

```text
t_x0 = (k_x + φ_x) T_x
```

For row `r` and column `c`, the sampling-window center is

```text
t(r,c) = t_row0 + r T_y + t_x0 + c T_x
```

The acquisition-window width `W` is either

```text
W = f_w T_x
```

for fractional-window mode, or a user-specified fixed duration. The window is

```text
[t(r,c) - W/2, t(r,c) + W/2)
```

and all source samples whose timestamps fall inside that half-open interval are aggregated by **median** or **mean**. The sample count is retained for each pixel as a QC map. Pixels with no samples in their window remain non-finite.

For a valid Phase Window geometry, the complete X window train must fit inside one Y period:

```text
t_x0 - W/2 >= 0

t_x0 + (C - 1) T_x + W/2 <= T_y

W <= T_x
```

After the time windows are reconstructed, scan orientation is applied:

- **Same direction**: every row has the same X direction; all rows are reversed if the first row is right-to-left.
- **Serpentine**: alternating rows are reversed according to the selected first-row direction.

See [Scientific methods](docs/SCIENTIFIC_METHODS.md) for the exact implementation contract.

## What data is Phase Window suitable for?

The current algorithm is intended for **raster-like acquisitions with approximately periodic row and point timing**. It works well when:

- the scan can be described by a fixed number of rows and columns;
- successive rows have a reasonably stable period;
- successive points within a row have a reasonably stable period;
- one X-window train fits within each row period;
- each pixel contains a temporally stable region that can be sampled;
- the time axis is monotonic after import;
- sampling density is high enough that reconstruction windows usually contain one or more samples;
- the scan direction is either same-direction or serpentine.

The algorithm should be treated cautiously, or a different reconstruction strategy should be used, when the acquisition has:

- arbitrary/non-raster trajectories;
- random or event-driven point order;
- strong row-to-row speed drift that cannot be represented by one `T_y`;
- strong point-to-point timing drift that cannot be represented by one `T_x`;
- pauses, missing rows, variable-length rows, or discontinuities that move the lattice by more than a simple phase/offset;
- no stable within-pixel plateau;
- severe undersampling such that many windows contain zero or one sample;
- geometry that changes during the acquisition.

The software validates the hard mathematical constraints above, but it cannot prove that a periodic model is physically appropriate for a particular experiment. The **Samples / pixel** map, timing trace and reconstructed image should therefore be inspected together.

## Registration recommendation

After entering the map geometry, **Recommend registration** estimates an initial Y period, X period and sampling phase from the prepared trace.

The recommendation is intentionally a starting point, not an oracle:

1. the trace is resampled to a bounded uniform representation;
2. an edge-strength trace is derived from the normalized signal;
3. Y-period autocorrelation is searched near `duration / rows`;
4. X-period autocorrelation is searched near `T_y / columns`;
5. candidate phases are scored to prefer stable pixel centers with transitions around them;
6. the result is converted to YA/YB/XA/XB, phase and X-offset parameters.

A confidence label is shown. The user can then refine anchors numerically or by dragging YA/YB/XA/XB on the trace. The recommendation does not continuously overwrite manual edits.

## Import support

The Import Data stage supports:

- HappyMeasure `single-v2` CSV;
- CSV, TSV, semicolon-separated and whitespace-separated numeric tables;
- files with or without a header;
- explicit time-column mapping or generated time from a sample interval;
- one or more signal columns;
- incomplete generic rows, which are dropped when the selected time/signal values are not all finite;
- `.hmmap` project files.

Generic data is canonicalized internally into the same time + signal contract used by the scientific pipeline.

## Interactive scientific plots

Signal and reconstruction traces support:

- wheel X zoom;
- Shift + wheel Y zoom;
- drag pan;
- double-click autoscale;
- explicit axis ranges;
- clickable legends;
- draggable manual dark regions;
- draggable YA/YB/XA/XB registration markers.

Trace rendering uses a per-pixel min/max envelope rather than stride sampling, so narrow peaks and valleys are preserved when large traces are displayed.

Maps support:

- Row / Column axes;
- numeric color bars;
- Pixel and display-only Smooth rendering for value maps;
- wheel zoom;
- drag pan;
- double-click/reset view;
- synchronized Raw map / Samples-per-pixel navigation.

Smooth view uses bilinear interpolation in value space for visualization only. It does not modify reconstructed/processed arrays or exports, and it does not interpolate across non-finite pixels. Samples / pixel remains a discrete Pixel view.

## Projects and compatibility

`.hmmap` is a ZIP-based project container containing `project.json` and the embedded raw source CSV. The Web application reads project schemas v1, v2 and v3 and verifies the embedded source SHA-256.

New projects use the existing schema family:

- v2 for Phase Window with default Signal Preparation;
- v3 when non-default Signal Preparation must be persisted.

Legacy v1 projects are accepted for compatibility and translated to the current Phase Window representation in the UI.

See [File formats and compatibility](docs/FILE_FORMATS.md).

## Validation

Scientific parity is checked against the pinned HappyMeasure Python implementation at commit:

`402b88f1c42cff41bf6054e1724bc62b4deb7af3`

CI also checks browser `file://` operation, project save/reopen, interactive plots, fixed-viewport layout, 120,000-point browser performance, offline packaging and Python/Web project compatibility.

A private real-data acceptance corpus has additionally covered historical 36×36 and 50×50 projects, including manual-region preparation, without committing measurement data to this public repository.

See [Validation](docs/VALIDATION.md).

## Documentation

- [User guide](docs/USER_GUIDE.md)
- [Scientific methods](docs/SCIENTIFIC_METHODS.md)
- [File formats and compatibility](docs/FILE_FORMATS.md)
- [Validation](docs/VALIDATION.md)
- [Architecture and extension model](docs/ARCHITECTURE.md)
- [Migration plan](docs/MIGRATION_PLAN.md)

## Development

No runtime build step is required. For local use, open `index.html` directly in a modern browser.

Run the automated test suite with:

```bash
npm test
```

The production artifact is intentionally static and dependency-light.
