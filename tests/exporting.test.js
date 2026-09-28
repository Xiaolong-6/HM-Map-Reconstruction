const test = require("node:test");
const assert = require("node:assert/strict");
require("../src/shared.js");
require("../src/exporting.js");
const e = globalThis.MapReconstructionWeb.exporting;

test("matrix CSV keeps row-major scientific values", () => {
  assert.equal(e.matrixCsv([1, 2, 3, 4], 2, 2), "1,2\n3,4\n");
  assert.equal(e.formatGeneral(1e-7, 12), "1e-07");
  assert.equal(e.formatGeneral(NaN, 12), "nan");
  assert.throws(() => e.matrixCsv([1, 2], 2, 2), /dimensions/);
});

test("prepared CSV follows the desktop column contract", () => {
  const prepared = {
    time_s: [0, 1],
    source_signal: "Current_A",
    baseline: [1e-6, 1e-6],
    values: [2e-6, 3e-6],
  };
  assert.equal(
    e.preparedCsv(prepared, [3e-6, 4e-6]),
    "Elapsed_s,Raw_Current_A,Baseline_Current_A,Prepared_Current_A\n" +
      "0,3e-06,1e-06,2e-06\n" +
      "1,4e-06,1e-06,3e-06\n",
  );
});

test("processed metadata preserves SI and display fields separately", () => {
  const metadata = e.processedMetadata({
    signal: "Current_A",
    scientificUnit: "A",
    rawDisplayUnit: { unit: "µA", scale: 1e6 },
    preparation: {
      dark_correction_mode: "constant",
      constant_baseline: -2e-6,
      manual_dark_regions: [],
      manual_region_fit: "constant",
      rolling_quantile: 0.9,
      rolling_window_s: 10,
      rolling_trend: "piecewise_linear",
      response_direction: "negative",
      value_gate_enabled: false,
      value_gate_min: -Infinity,
      value_gate_max: Infinity,
      output_convention: "measured_minus_dark",
      apply_baseline: true,
      invert_signal: false,
    },
    preparedMetadata: { mode: "constant" },
    processed: {
      baseline_used: -1e-6,
      warnings: ["demo"],
      value_label: "Current",
      is_dimensionless: false,
    },
    processing: { transform: "raw" },
    displayColorLimits: [-3, 4],
  });
  assert.equal(metadata.source_physical_unit, "A");
  assert.equal(metadata.display_unit, "µA");
  assert.equal(metadata.display_scale, 1e6);
  assert.equal(metadata.baseline_used_si, -1e-6);
  assert.equal(metadata.signal_preparation.value_gate, null);
  assert.deepEqual(metadata.display_color_limits, [-3, 4]);
});
