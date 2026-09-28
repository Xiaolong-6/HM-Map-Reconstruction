(function (root) {
  "use strict";

  const api = root.MapReconstructionWeb = root.MapReconstructionWeb || {};
  const math = api.math;
  const MAX_RECONSTRUCTION_PIXELS = 1000000;
  const WINDOW_LEFT_FRACTION = 0.15;
  const WINDOW_RIGHT_FRACTION = 0.80;
  const LEGACY_WINDOW_CENTER_FRACTION = (WINDOW_LEFT_FRACTION + WINDOW_RIGHT_FRACTION) / 2;

  function positiveInteger(value, name) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) throw new Error(name + " must be a positive integer.");
    return number;
  }

  function nonNegativeInteger(value, name) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) throw new Error(name + " must be a non-negative integer.");
    return number;
  }

  function canonicalFraction(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(name + " must be finite.");
    return ((number % 1) + 1) % 1;
  }

  function commonParams(input) {
    const source = input || {};
    const rows = positiveInteger(source.rows, "rows");
    const cols = positiveInteger(source.cols, "cols");
    const rowsApart = positiveInteger(source.rows_apart, "rows_apart");
    const pointsApart = positiveInteger(source.points_apart, "points_apart");
    const rowOffset = nonNegativeInteger(source.row_offset, "row_offset");
    if (rowOffset >= rows) throw new Error("row_offset must be zero-based and within the map rows.");
    const anchors = ["row_a_s", "row_b_s", "point_a_s", "point_b_s"].map(function (name) {
      const value = Number(source[name]);
      if (!Number.isFinite(value)) throw new Error("Timing anchors must be finite.");
      return value;
    });
    const scanPattern = source.scan_pattern || "same_direction";
    if (!["same_direction", "serpentine"].includes(scanPattern)) throw new Error("Unsupported scan pattern.");
    return {
      rows,
      cols,
      rows_apart: rowsApart,
      row_offset: rowOffset,
      point_a_s: anchors[2],
      point_b_s: anchors[3],
      points_apart: pointsApart,
      row_a_s: anchors[0],
      row_b_s: anchors[1],
      scan_pattern: scanPattern,
      first_row_ltr: source.first_row_ltr == null ? true : Boolean(source.first_row_ltr)
    };
  }

  function normalizeDualOffsetParams(input) {
    const source = input || {};
    const common = commonParams(source);
    const pointOffset = nonNegativeInteger(source.point_offset, "point_offset");
    if (pointOffset >= common.cols) throw new Error("point_offset must be zero-based and within the map columns.");
    return Object.freeze(Object.assign(common, {
      point_offset: pointOffset,
      use_median: source.use_median == null ? true : Boolean(source.use_median)
    }));
  }

  function normalizePhaseWindowParams(input) {
    const source = input || {};
    const common = commonParams(source);
    const xPeriodOffset = nonNegativeInteger(source.x_period_offset, "x_period_offset");
    const windowMode = source.window_mode || "fraction";
    if (!["fraction", "fixed_duration"].includes(windowMode)) throw new Error("Unsupported window mode.");
    const aggregation = source.aggregation || "median";
    if (!["median", "mean"].includes(aggregation)) throw new Error("Unsupported aggregation.");
    const windowFraction = Number(source.window_fraction == null ? 0.65 : source.window_fraction);
    let windowDuration = source.window_duration_s == null ? null : Number(source.window_duration_s);
    if (windowMode === "fraction") {
      if (!Number.isFinite(windowFraction) || windowFraction <= 0 || windowFraction > 1) {
        throw new Error("window_fraction must be greater than zero and at most one.");
      }
      windowDuration = null;
    } else {
      if (!Number.isFinite(windowDuration) || windowDuration <= 0) {
        throw new Error("Fixed-duration windows require a finite window_duration_s greater than zero.");
      }
    }
    return Object.freeze(Object.assign(common, {
      y_phase_fraction: canonicalFraction(source.y_phase_fraction == null ? 0 : source.y_phase_fraction, "y_phase_fraction"),
      x_period_offset: xPeriodOffset,
      x_phase_fraction: canonicalFraction(source.x_phase_fraction == null ? 0 : source.x_phase_fraction, "x_phase_fraction"),
      window_mode: windowMode,
      window_fraction: windowFraction,
      window_duration_s: windowDuration,
      aggregation
    }));
  }

  function solveTiming(input) {
    const params = normalizeDualOffsetParams(input);
    const rowPeriod = (params.row_b_s - params.row_a_s) / params.rows_apart;
    const pointPeriod = (params.point_b_s - params.point_a_s) / params.points_apart;
    if (rowPeriod <= 0) throw new Error("Row B must be later than Row A for a positive row period.");
    if (pointPeriod <= 0) throw new Error("Point B must be later than Point A for a positive point period.");
    const rowRef0 = params.row_a_s - params.row_offset * rowPeriod;
    const phaseA = ((params.point_a_s - rowRef0) % rowPeriod + rowPeriod) % rowPeriod;
    const pixel1Phase = ((phaseA - params.point_offset * pointPeriod) % rowPeriod + rowPeriod) % rowPeriod;
    return Object.freeze({
      row_period_s: rowPeriod,
      row_ref0_s: rowRef0,
      point_period_s: pointPeriod,
      pixel1_phase_s: pixel1Phase
    });
  }

  function solvePhaseWindowTiming(input) {
    const params = normalizePhaseWindowParams(input);
    const rowPeriod = (params.row_b_s - params.row_a_s) / params.rows_apart;
    const pointPeriod = (params.point_b_s - params.point_a_s) / params.points_apart;
    if (rowPeriod <= 0) throw new Error("Row B must be later than Row A for a positive row period.");
    if (pointPeriod <= 0) throw new Error("Point B must be later than Point A for a positive point period.");
    const windowWidth = params.window_mode === "fraction"
      ? params.window_fraction * pointPeriod
      : params.window_duration_s;
    if (windowWidth > pointPeriod) throw new Error("Acquisition window width must not exceed the point period.");
    const row0 = params.row_a_s - (params.row_offset + params.y_phase_fraction) * rowPeriod;
    const centerPhase = (params.x_period_offset + params.x_phase_fraction) * pointPeriod;
    const firstStart = centerPhase - windowWidth / 2;
    const lastEnd = centerPhase + (params.cols - 1) * pointPeriod + windowWidth / 2;
    const epsilon = Number.EPSILON * Math.max(1, rowPeriod);
    if (firstStart < -epsilon) throw new Error("The first acquisition window precedes its row boundary.");
    if (lastEnd > rowPeriod + epsilon) throw new Error("Mapped acquisition windows exceed one row period.");
    return Object.freeze({
      row_period_s: rowPeriod,
      point_period_s: pointPeriod,
      row0_s: row0,
      first_window_center_phase_s: centerPhase,
      window_width_s: windowWidth
    });
  }

  function applyScanOrientation(values, counts, rows, cols, scanPattern, firstRowLtr) {
    const outputValues = Float64Array.from(values);
    const outputCounts = Int32Array.from(counts);
    function reverseRow(row) {
      const start = row * cols;
      for (let left = 0, right = cols - 1; left < right; left += 1, right -= 1) {
        const li = start + left, ri = start + right;
        const value = outputValues[li]; outputValues[li] = outputValues[ri]; outputValues[ri] = value;
        const count = outputCounts[li]; outputCounts[li] = outputCounts[ri]; outputCounts[ri] = count;
      }
    }
    if (scanPattern === "same_direction") {
      if (!firstRowLtr) for (let row = 0; row < rows; row += 1) reverseRow(row);
    } else {
      for (let row = 0; row < rows; row += 1) {
        const reverse = firstRowLtr ? row % 2 === 1 : row % 2 === 0;
        if (reverse) reverseRow(row);
      }
    }
    return { values: outputValues, sample_counts: outputCounts };
  }

  function validateInputData(data, signalName, rows, cols) {
    if (!data || !data.signals || !Object.prototype.hasOwnProperty.call(data.signals, signalName)) {
      throw new Error("Unknown signal " + JSON.stringify(signalName) + ".");
    }
    const time = data.timeS || data.time_s;
    if (!time) throw new Error("Time-series data is missing time values.");
    for (let index = 1; index < time.length; index += 1) {
      if (time[index] < time[index - 1]) throw new Error("Time-series data must be sorted by time.");
    }
    if (rows * cols > MAX_RECONSTRUCTION_PIXELS) {
      throw new Error("Map size exceeds the 1,000,000-pixel reconstruction limit.");
    }
    return time;
  }

  function aggregateWindow(signal, first, last, useMedian) {
    if (last <= first) return NaN;
    const window = [];
    for (let index = first; index < last; index += 1) window.push(signal[index]);
    return useMedian ? math.median(window) : math.mean(window);
  }

  function reconstructDualOffset(data, signalName, inputParams) {
    const params = normalizeDualOffsetParams(inputParams);
    const time = validateInputData(data, signalName, params.rows, params.cols);
    const signal = data.signals[signalName];
    const timing = solveTiming(params);
    const values = new Float64Array(params.rows * params.cols);
    values.fill(NaN);
    const counts = new Int32Array(params.rows * params.cols);

    for (let row = 0; row < params.rows; row += 1) {
      const rowBase = timing.row_ref0_s + row * timing.row_period_s;
      for (let column = 0; column < params.cols; column += 1) {
        const offset = row * params.cols + column;
        const pixelStart = rowBase + timing.pixel1_phase_s + column * timing.point_period_s;
        const left = pixelStart + WINDOW_LEFT_FRACTION * timing.point_period_s;
        const right = pixelStart + WINDOW_RIGHT_FRACTION * timing.point_period_s;
        const first = math.lowerBound(time, left);
        const last = math.upperBound(time, right);
        if (last > first) {
          values[offset] = aggregateWindow(signal, first, last, params.use_median);
          counts[offset] = last - first;
          continue;
        }

        const center = pixelStart + 0.5 * timing.point_period_s;
        const insertion = math.lowerBound(time, center);
        const candidates = [insertion - 1, insertion].filter(index => index >= 0 && index < time.length);
        let nearest = null, nearestDistance = Infinity;
        candidates.forEach(function (index) {
          const distance = Math.abs(time[index] - center);
          if (distance < nearestDistance) { nearest = index; nearestDistance = distance; }
        });
        if (nearest != null && nearestDistance <= 0.30) {
          values[offset] = signal[nearest];
          counts[offset] = 1;
        }
      }
    }

    const oriented = applyScanOrientation(
      values, counts, params.rows, params.cols, params.scan_pattern, params.first_row_ltr
    );
    const warnings = [];
    if (params.cols * timing.point_period_s > timing.row_period_s) {
      warnings.push("Spatial point train exceeds row period.");
    }
    return Object.freeze({
      rows: params.rows,
      cols: params.cols,
      values: oriented.values,
      sample_counts: oriented.sample_counts,
      timing,
      warnings: Object.freeze(warnings),
      method: "dual_offset"
    });
  }

  function windowBounds(inputParams, suppliedTiming) {
    const params = normalizePhaseWindowParams(inputParams);
    const timing = suppliedTiming || solvePhaseWindowTiming(params);
    const output = new Float64Array(params.rows * params.cols * 2);
    const half = timing.window_width_s / 2;
    for (let row = 0; row < params.rows; row += 1) {
      const rowBase = timing.row0_s + row * timing.row_period_s;
      for (let column = 0; column < params.cols; column += 1) {
        const center = rowBase + timing.first_window_center_phase_s + column * timing.point_period_s;
        const offset = (row * params.cols + column) * 2;
        output[offset] = center - half;
        output[offset + 1] = center + half;
      }
    }
    return output;
  }

  function reconstructPhaseWindow(data, signalName, inputParams) {
    const params = normalizePhaseWindowParams(inputParams);
    const time = validateInputData(data, signalName, params.rows, params.cols);
    const signal = data.signals[signalName];
    const timing = solvePhaseWindowTiming(params);
    const bounds = windowBounds(params, timing);
    const values = new Float64Array(params.rows * params.cols);
    values.fill(NaN);
    const counts = new Int32Array(params.rows * params.cols);

    for (let offset = 0; offset < values.length; offset += 1) {
      const left = bounds[offset * 2], right = bounds[offset * 2 + 1];
      const first = math.lowerBound(time, left);
      const last = math.lowerBound(time, right);
      counts[offset] = last - first;
      if (last > first) {
        values[offset] = aggregateWindow(signal, first, last, params.aggregation === "median");
      }
    }

    const oriented = applyScanOrientation(
      values, counts, params.rows, params.cols, params.scan_pattern, params.first_row_ltr
    );
    return Object.freeze({
      rows: params.rows,
      cols: params.cols,
      values: oriented.values,
      sample_counts: oriented.sample_counts,
      timing,
      warnings: Object.freeze([]),
      method: "dual_offset_phase_window"
    });
  }

  function convertLegacyToPhaseWindow(inputParams) {
    const params = normalizeDualOffsetParams(inputParams);
    const legacy = solveTiming(params);
    const coordinate = (
      legacy.pixel1_phase_s + LEGACY_WINDOW_CENTER_FRACTION * legacy.point_period_s
    ) / legacy.point_period_s;
    const xOffset = Math.floor(coordinate + 1e-12);
    const xPhase = coordinate - xOffset;
    const converted = normalizePhaseWindowParams({
      rows: params.rows,
      cols: params.cols,
      row_a_s: params.row_a_s,
      row_b_s: params.row_b_s,
      rows_apart: params.rows_apart,
      row_offset: params.row_offset,
      y_phase_fraction: 0,
      point_a_s: params.point_a_s,
      point_b_s: params.point_b_s,
      points_apart: params.points_apart,
      x_period_offset: xOffset,
      x_phase_fraction: xPhase,
      window_mode: "fraction",
      window_fraction: WINDOW_RIGHT_FRACTION - WINDOW_LEFT_FRACTION,
      scan_pattern: params.scan_pattern,
      first_row_ltr: params.first_row_ltr,
      aggregation: params.use_median ? "median" : "mean"
    });
    return Object.freeze({ params: converted, timing: solvePhaseWindowTiming(converted) });
  }

  api.reconstruction = Object.freeze({
    MAX_RECONSTRUCTION_PIXELS,
    normalizeDualOffsetParams,
    normalizePhaseWindowParams,
    solveTiming,
    solvePhaseWindowTiming,
    applyScanOrientation,
    windowBounds,
    reconstructDualOffset,
    reconstructPhaseWindow,
    convertLegacyToPhaseWindow
  });
})(typeof window !== "undefined" ? window : globalThis);
