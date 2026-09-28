# File formats and compatibility

## HappyMeasure single-v2 CSV

The Web application auto-detects HappyMeasure `single-v2` exports.

Required scientific content:

- `Elapsed_s`;
- one or more numeric signal columns.

The parser:

- accepts UTF-8 BOM;
- reads metadata JSON;
- requires unique headers;
- requires finite numeric values;
- sorts stably by time.

Combined HappyMeasure exports are not treated as the canonical single-source reconstruction input.

## Generic delimited input

Accepted delimiter families:

- comma;
- tab;
- semicolon;
- whitespace.

Blank lines and lines beginning with `#` or `//` are ignored during generic-table inspection.

The first retained row is interpreted as a header when any cell is non-numeric. Otherwise names `Column_1`, `Column_2`, ... are generated.

### Time mapping

Time can be:

- taken from a selected numeric column and multiplied into seconds; or
- generated from sample index and a positive sample interval.

### Signal mapping

One or more signal columns can be selected.

Rows are retained only when time and all selected signals are finite. The canonicalized metadata records:

- original row count;
- retained row count;
- dropped row count;
- original time column;
- imported signal columns;
- delimiter.

After canonicalization, the scientific pipeline sees the same time/signal contract as a HappyMeasure `single-v2` source.

## .hmmap project container

`.hmmap` is a ZIP container with:

```text
project.json
source/raw_timeseries.csv
```

The source bytes are embedded and protected by SHA-256 stored in `project.json`.

The Web loader:

1. reads the ZIP central directory;
2. extracts `project.json` and the embedded source;
3. validates the project schema and values;
4. verifies source SHA-256;
5. parses the embedded CSV;
6. restores preparation, registration, processing and display state.

Stored and DEFLATE-compressed ZIP entries are readable. The Web writer produces a deterministic stored ZIP without adding a new project-schema family.

## Project schemas

### v1 — `map-reconstruction-project-v1`

Historical Legacy Dual Offset project.

Readable for compatibility. The current UI does not expose Legacy Dual Offset for new reconstruction. On open, legacy registration is converted to the current Phase Window representation.

### v2 — `map-reconstruction-project-v2`

Phase Window project with default Signal Preparation.

This is the normal schema for new Phase Window projects when preparation remains at its default state.

### v3 — `map-reconstruction-project-v3`

Project with persisted non-default Signal Preparation.

v3 contains both the reconstruction/map-processing state and preparation state required to reproduce the prepared signal.

## Web save behavior

The Web application writes:

- v2 when the current method is Phase Window and preparation is default;
- v3 when preparation is non-default.

New Web work does not write a new Legacy v1 project.

## SHA-256 verification

The preferred path uses browser Web Crypto. A pure-JavaScript SHA-256 implementation is used as an offline fallback when Web Crypto is unavailable under `file://`.

A hash mismatch rejects the project rather than silently loading different source data.

## Compatibility rule

Do not change the meaning of an existing schema field to add new functionality.

If a future reconstruction strategy cannot be represented without ambiguity by v1/v2/v3, add a deliberately versioned schema extension and preserve the old readers.
