# User guide

## 1. Import Data

### HappyMeasure CSV

Click **Open data** and select a HappyMeasure `single-v2` CSV. The application detects this format automatically, shows the source summary and selects `Current_A` by default when that signal exists.

The source summary reports file name, format, samples, duration and number of signals. Long file names are truncated visually but remain available in the tooltip.

### Generic numeric data

Generic tables can be comma-, tab-, semicolon- or whitespace-separated. Headerless data is supported.

For a generic file:

1. confirm or change the delimiter;
2. choose a time source:
   - a numeric time column, optionally multiplied into seconds; or
   - generated time from a sample interval;
3. choose one or more numeric signal columns;
4. click **Use selected data**.

Rows are retained only when the selected time and every selected signal are finite. The import status reports how many incomplete rows were dropped.

Files can also be dragged onto the Import Data drop zone.

### Open a project

Use **Open project** for an existing `.hmmap`. The embedded source hash is verified before the project is restored.

## 2. Signal Preparation

Choose the signal to reconstruct. The interactive trace shows Raw, Baseline and Prepared signals; each legend item can be hidden independently.

Navigation:

- mouse wheel: X zoom;
- Shift + mouse wheel: Y zoom;
- drag empty plot area: pan;
- double-click: autoscale;
- **Axes**: enter exact axis limits;
- **Full X**: restore the full time range.

### Baseline modes

**None**  
No baseline model is estimated.

**Constant**  
Use one fixed baseline value.

**Manual dark regions**  
Choose **Draw dark region** and drag directly on the trace, or enter `start,end` time intervals manually. Region medians are used as dark observations. The observations can be fit with a constant, linear or quadratic model.

**Rolling quantile**  
Estimate a moving dark envelope from the selected response direction, window duration and quantile. The rolling observations can be represented as piecewise-linear, linear or quadratic trend.

### Additional preparation controls

- **Subtract B(t)**: subtract the estimated baseline from the raw signal.
- **Invert**: multiply the prepared signal by -1.
- **Gate baseline candidates**: restrict samples eligible for baseline estimation to a value interval.

Signal Preparation does not alter the stored raw source.

## 3. Reconstruction

### Geometry first

Enter:

- Rows;
- Columns;
- Same direction or Serpentine;
- First-row direction.

The maximum reconstruction size is 1,000,000 pixels.

### Recommend registration

After geometry is entered, **Recommend registration** estimates an initial registration from the prepared trace.

Rows and Columns constrain the timing estimator. Scan pattern and first-row direction determine map orientation after timing reconstruction.

The result displays an estimated Y period, X period and a confidence label. Treat it as an initializer. Visually inspect the trace and map, then refine if necessary.

### Manual registration

The parameters are grouped by physical role.

**Y registration**

- YA / YB;
- Rows apart;
- Row offset;
- Y phase.

**X registration**

- XA / XB;
- Points apart;
- X offset / periods;
- X phase.

**Sampling window**

- fractional or fixed-duration window;
- window fraction/duration;
- median or mean aggregation.

YA/YB/XA/XB can be dragged directly on the timing trace. Editing any reconstruction parameter automatically recalculates the maps; there is no separate Reconstruct button.

Number inputs intentionally ignore mouse-wheel value changes to avoid accidental parameter jumps.

### Reconstruction plots

The Stage 3 workspace keeps these views together on a normal desktop viewport:

1. timing trace;
2. reconstructed value map;
3. samples-per-pixel map.

The two maps share the same zoom/pan view.

Map navigation:

- wheel: zoom;
- drag: pan;
- double-click: reset;
- **Reset map view**: restore the full map.

Always inspect the Samples / pixel map. Sparse or zero-count pixels are a direct indication that the chosen timing/window does not sample the requested lattice adequately.

## 4. Map Analysis

Map Analysis operates on reconstructed values; it does not change the reconstruction timing.

### Processing

Available operations include:

- baseline: none, manual, mean, median, minimum, maximum or percentile;
- transform: raw, absolute, negate or restricted custom expression;
- normalization: none, maximum magnitude, min-max or reference;
- linear or log10 value scale.

### Figure

Display-only controls include:

- palette;
- palette inversion;
- Y flip;
- auto / percentile / manual color range.

Display controls do not mutate the processed map array.

### Distribution

The histogram can use:

- automatic or manual displayed range;
- automatic binning;
- fixed bin count;
- fixed bin width.

## Export

Available exports include:

- prepared trace CSV;
- raw reconstructed map CSV;
- processed map CSV plus JSON sidecar;
- parameter summary text;
- self-contained HTML report;
- `.hmmap` project.

The HTML report includes current scientific outputs but is not a substitute for the `.hmmap` project when reproducible editing is required.

## Offline use

Use the CI-produced offline ZIP or copy the static repository files and open `index.html`. No local server is required.

Project SHA-256 verification includes a pure-JavaScript fallback for browser contexts where Web Crypto is unavailable under `file://`.
