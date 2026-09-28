const test = require("node:test");
const assert = require("node:assert/strict");

require("../src/shared.js");
require("../src/preparation.js");

const prep = globalThis.MapReconstructionWeb.preparation;

function data(values, time) {
  return {
    timeS: Float64Array.from(time || values.map((_, index) => index)),
    signals: { Current_A: Float64Array.from(values) }
  };
}

function closeArray(actual, expected, tolerance = 1e-10) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) <= tolerance, value + " != " + expected[index]);
  });
}

test("none mode is an independent identity copy", () => {
  const source = data([1, 2, 3]);
  const result = prep.prepareSignal(source, "Current_A");
  closeArray(result.values, [1, 2, 3], 0);
  assert.equal(result.baseline, null);
  result.values[0] = 99;
  assert.equal(source.signals.Current_A[0], 1);
});

test("constant dark-minus-measured matches Python semantics", () => {
  const result = prep.prepareSignal(data([-10, -12, -8]), "Current_A", {
    dark_correction_mode: "constant",
    constant_baseline: -10,
    output_convention: "dark_minus_measured"
  });
  closeArray(result.values, [0, 2, -2]);
  closeArray(result.baseline, [-10, -10, -10]);
});

test("baseline estimation can be visible without subtraction", () => {
  const result = prep.prepareSignal(data([3, 4, 5]), "Current_A", {
    dark_correction_mode: "constant",
    constant_baseline: 2,
    apply_baseline: false,
    invert_signal: true
  });
  closeArray(result.baseline, [2, 2, 2]);
  closeArray(result.values, [-3, -4, -5]);
});

test("manual regions fit region medians rather than raw sample weights", () => {
  const result = prep.prepareSignal(data([-5, -5, -5, -7, -7, -7]), "Current_A", {
    dark_correction_mode: "manual_regions",
    manual_dark_regions: [{ start_s: 0, end_s: 1 }, { start_s: 3, end_s: 5 }],
    manual_region_fit: "linear"
  });
  assert.ok(Math.abs(result.baseline[0] + 5) < 0.6);
  assert.ok(Math.abs(result.baseline[5] + 7) < 0.6);
});

test("quadratic manual fit requires at least three valid regions", () => {
  assert.throws(() => prep.prepareSignal(data([1, 2, 3]), "Current_A", {
    dark_correction_mode: "manual_regions",
    manual_dark_regions: [{ start_s: 0, end_s: 1 }],
    manual_region_fit: "quadratic"
  }), /at least 3/);
});

test("rolling quantile uses time bins and constant interpolation edges", () => {
  const result = prep.prepareSignal(
    data([-10, -9, -8, -7, -6], [0, 0.2, 2, 2.1, 5]),
    "Current_A",
    {
      dark_correction_mode: "rolling_quantile",
      rolling_window_s: 2,
      rolling_quantile: 0.9,
      response_direction: "negative",
      rolling_trend: "piecewise_linear"
    }
  );
  assert.ok(Math.abs(result.baseline[0] - (-9.1)) < 1e-12);
  assert.ok(Math.abs(result.baseline[result.baseline.length - 1] - (-6)) < 1e-12);
});

test("positive photocurrent mirrors the dark-envelope quantile", () => {
  const config = prep.normalizeConfig({
    dark_correction_mode: "rolling_quantile",
    rolling_quantile: 0.9,
    response_direction: "positive"
  });
  assert.ok(Math.abs(prep.effectiveRollingQuantile(config) - 0.1) < 1e-15);
});
