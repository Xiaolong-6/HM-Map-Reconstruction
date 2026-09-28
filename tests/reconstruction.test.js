const test = require("node:test");
const assert = require("node:assert/strict");

require("../src/shared.js");
require("../src/reconstruction.js");

const rec = globalThis.MapReconstructionWeb.reconstruction;

function close(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, actual + " != " + expected);
}
function closeArray(actual, expected, tolerance = 1e-12) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    if (Number.isNaN(expected[index])) assert.ok(Number.isNaN(value));
    else close(value, expected[index], tolerance);
  });
}
function data(time, values) {
  return { timeS: Float64Array.from(time), signals: { Current_A: Float64Array.from(values) } };
}
function dual(overrides = {}) {
  return Object.assign({
    rows: 3, cols: 4,
    row_a_s: 20, row_b_s: 50, rows_apart: 3, row_offset: 2,
    point_a_s: 12.5, point_b_s: 15.5, points_apart: 6, point_offset: 1,
    scan_pattern: "same_direction", first_row_ltr: true, use_median: true
  }, overrides);
}
function phase(overrides = {}) {
  return Object.assign({
    rows: 2, cols: 4,
    row_a_s: 10, row_b_s: 30, rows_apart: 2, row_offset: 0, y_phase_fraction: 0.25,
    point_a_s: 1, point_b_s: 4, points_apart: 3,
    x_period_offset: 1, x_phase_fraction: 0.5,
    window_mode: "fraction", window_fraction: 0.5,
    scan_pattern: "same_direction", first_row_ltr: true, aggregation: "median"
  }, overrides);
}

test("legacy dual-offset timing matches the Python specification example", () => {
  const timing = rec.solveTiming(dual());
  close(timing.row_period_s, 10);
  close(timing.row_ref0_s, 0);
  close(timing.point_period_s, 0.5);
  close(timing.pixel1_phase_s, 2);
});

test("phase-window timing keeps period, phase and width independent", () => {
  const timing = rec.solvePhaseWindowTiming(phase());
  close(timing.row_period_s, 10);
  close(timing.point_period_s, 1);
  close(timing.row0_s, 7.5);
  close(timing.first_window_center_phase_s, 1.5);
  close(timing.window_width_s, 0.5);
  closeArray(rec.windowBounds(phase(), timing).slice(0, 4), [8.75, 9.25, 9.75, 10.25]);
});

test("phase-window uses start-inclusive end-exclusive samples", () => {
  const params = phase({ rows: 1, cols: 1, row_a_s: 0, row_b_s: 10, rows_apart: 1, y_phase_fraction: 0 });
  const result = rec.reconstructPhaseWindow(data([1.25, 1.5, 1.75], [1, 2, 3]), "Current_A", params);
  assert.equal(result.sample_counts[0], 2);
  close(result.values[0], 1.5);
});

test("fixed-duration empty windows stay NaN and mean aggregation matches Python", () => {
  const params = phase({
    rows: 1, cols: 2, row_a_s: 0, row_b_s: 10, rows_apart: 1, y_phase_fraction: 0,
    window_mode: "fixed_duration", window_duration_s: 0.2, aggregation: "mean"
  });
  const result = rec.reconstructPhaseWindow(data([1.45, 1.55, 3.4], [1, 3, 5]), "Current_A", params);
  assert.deepEqual(Array.from(result.sample_counts), [2, 0]);
  close(result.values[0], 2);
  assert.ok(Number.isNaN(result.values[1]));
});

test("phase fractions use Python-style modulo canonicalization", () => {
  const normalized = rec.normalizePhaseWindowParams(phase({ y_phase_fraction: 1.25, x_phase_fraction: -0.5 }));
  close(normalized.y_phase_fraction, 0.25);
  close(normalized.x_phase_fraction, 0.5);
});

test("serpentine orientation reverses alternating rows only", () => {
  const oriented = rec.applyScanOrientation(
    Float64Array.from([1, 2, 3, 4, 5, 6]),
    Int32Array.from([1, 1, 1, 1, 1, 1]),
    2, 3, "serpentine", true
  );
  closeArray(oriented.values, [1, 2, 3, 6, 5, 4], 0);
});

test("legacy conversion reproduces the legacy windowed reconstruction", () => {
  const params = {
    rows: 2, cols: 4,
    row_a_s: 10, row_b_s: 30, rows_apart: 2, row_offset: 0,
    point_a_s: 2, point_b_s: 5, points_apart: 3, point_offset: 0,
    scan_pattern: "serpentine", first_row_ltr: false, use_median: true
  };
  const time = Array.from({ length: 300 }, (_, index) => index * 0.1 + 0.013);
  const source = data(time, time);
  const converted = rec.convertLegacyToPhaseWindow(params);
  const legacy = rec.reconstructDualOffset(source, "Current_A", params);
  const phaseResult = rec.reconstructPhaseWindow(source, "Current_A", converted.params);
  closeArray(phaseResult.values, Array.from(legacy.values), 1e-12);
  assert.deepEqual(Array.from(phaseResult.sample_counts), Array.from(legacy.sample_counts));
  close(converted.timing.window_width_s, 0.65);
});
