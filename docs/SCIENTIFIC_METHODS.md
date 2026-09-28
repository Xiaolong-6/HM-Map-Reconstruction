# Scientific methods

This document describes the scientific contract implemented by the current Web application. It is intended to be read together with the source and parity tests.

## Data model

The scientific pipeline operates on:

- a monotonically non-decreasing time array in seconds;
- one or more finite-valued signal arrays of equal length;
- immutable source data;
- explicit preparation, reconstruction and processing configuration.

Generic input files are converted to this contract before scientific processing.

## Signal Preparation

Let the selected raw signal be `s(t)` and the estimated baseline be `B(t)`.

The prepared signal is controlled independently by two switches:

```text
prepared(t) = s(t)
prepared(t) = s(t) - B(t)       when baseline subtraction is enabled
prepared(t) = -prepared(t)      when inversion is enabled
```

### Constant baseline

`B(t) = B_0`.

### Manual dark regions

For each user-defined time region, the median signal value in that region is used as a dark observation. Those observations are fit with:

- constant;
- linear;
- quadratic.

The fit produces `B(t)` across the full trace.

### Rolling quantile

A moving quantile is used as a dark-envelope observation. Response direction determines which side of the signal envelope represents the dark background. The rolling observations are represented with:

- piecewise-linear interpolation;
- linear trend;
- quadratic trend.

An optional value gate restricts samples eligible for baseline estimation.

## Phase Window reconstruction

### Timing anchors

Define:

```text
T_y = (YB - YA) / N_y
T_x = (XB - XA) / N_x
```

where `N_y = rows_apart` and `N_x = points_apart`.

Requirements:

```text
T_y > 0
T_x > 0
```

The row-zero timing reference is

```text
t_row0 = YA - (row_offset + φ_y) T_y
```

with canonical fractional `0 <= φ_y < 1`.

The first X-window center phase is

```text
t_x0 = (x_period_offset + φ_x) T_x
```

with integer `x_period_offset >= 0` and canonical fractional `0 <= φ_x < 1`.

### Sampling window

For fractional mode:

```text
W = window_fraction T_x
0 < window_fraction <= 1
```

For fixed-duration mode:

```text
W = window_duration
0 < W <= T_x
```

For output row `r` and acquisition-order column `c`:

```text
center(r,c) = t_row0 + r T_y + t_x0 + c T_x
left(r,c)   = center(r,c) - W/2
right(r,c)  = center(r,c) + W/2
```

The implementation takes samples with

```text
left <= t < right
```

using lower-bound searches on the sorted time array. The pixel value is the median or mean of all samples in the interval. The number of samples is stored separately.

No nearest-sample fallback is used by the Phase Window method. If a window contains no sample, its value remains non-finite and its sample count is zero.

### Row-boundary constraint

All X windows must fit within one row period:

```text
t_x0 - W/2 >= 0

t_x0 + (C - 1) T_x + W/2 <= T_y
```

A configuration violating either condition is rejected.

### Scan orientation

Timing windows are generated in acquisition order, then output orientation is applied.

**Same direction**

- first row L→R: keep all rows;
- first row R→L: reverse all rows.

**Serpentine**

- first row L→R: reverse rows 1, 3, 5, ...;
- first row R→L: reverse rows 0, 2, 4, ....

This orientation step is applied identically to reconstructed values and sample counts.

## Registration recommendation

The recommendation algorithm is a heuristic initializer.

The timing estimator currently uses **Rows** and **Columns** as its timing prior. Scan pattern and first-row direction are orientation settings applied after timing reconstruction; they do not alter the period search.

### Resampling

Finite trace samples are interpolated to a uniformly spaced representation capped at 6000 samples. The signal is centered and scaled with a MAD-based scale when possible.

### Edge representation

An edge-strength signal is computed from the absolute first difference of the normalized trace. Extreme edge values are clipped at the 98th percentile and lightly smoothed.

### Y-period estimation

The prior is

```text
T_y,expected = duration / rows
```

Normalized autocorrelation is searched over approximately

```text
0.55 T_y,expected ... 1.55 T_y,expected
```

followed by local lag refinement.

### X-period estimation

The prior is

```text
T_x,expected = T_y / columns
```

Autocorrelation is searched over approximately

```text
0.55 T_x,expected ... 1.45 T_x,expected
```

followed by refinement.

### Sampling phase

Candidate phases are scored over one Y period. The score favors:

- low edge strength at predicted pixel centers;
- higher edge strength around the center at fractions of the X period.

This reduces the ambiguity between a stable plateau center and an adjacent stable periodic location.

The final phase is converted to the existing YA/YB/XA/XB, X offset and X phase representation. A confidence label is derived from correlation/prominence and center-phase stability.

### Recommendation boundary

The recommendation is expected to work best when:

- the raster occupies most of the trace duration;
- row and point periods are repeated enough to produce autocorrelation peaks;
- transitions between neighboring pixels are visible;
- the requested rows/columns are close to the true geometry.

It can give poor initial values when:

- the trace contains long unrelated segments before/after the raster;
- rows or columns are frequently missing;
- scan velocity drifts strongly;
- the signal has little contrast between neighboring points;
- a dominant unrelated periodic artifact is stronger than the scan timing;
- geometry is wrong.

For these cases, manually register anchors or introduce a reconstruction strategy designed for that acquisition type.

## Applicability boundary of Phase Window

The current method models one periodic 2-D raster lattice. It does not model time-dependent period drift.

### Appropriate

- fixed-row/fixed-column raster;
- constant or approximately constant row cadence;
- constant or approximately constant point cadence;
- stable per-pixel dwell region;
- same-direction or serpentine scan;
- moderate baseline drift handled separately by Signal Preparation.

### Outside the current model

- arbitrary XY trajectories;
- non-raster paths;
- asynchronous/event-triggered point ordering;
- adaptive dwell time per pixel;
- substantially variable row length;
- skipped/repeated rows not representable by a fixed offset;
- acceleration/deceleration that materially changes point period within a row;
- multiple raster segments with different timing in one trace;
- acquisition timing that requires a nonlinear time-warp model.

The architecture intentionally allows additional reconstruction strategies to be added for these classes without changing import, preparation or analysis.

## Map processing

Processing is applied after reconstruction.

### Baseline

Baseline can be none, manual, mean, median, minimum, maximum or percentile.

### Transform

Supported transformations are raw, absolute, negate and a restricted custom expression in `x`.

### Normalization

Supported modes are none, maximum magnitude, min-max and reference normalization.

### Log scale

Log10 processing only produces finite values where the transformed value is strictly positive.

## Display semantics

Palette, palette inversion, color limits, Y flip, axis zoom and histogram view are display-level operations. They do not mutate the stored raw source or reconstructed scientific arrays.
