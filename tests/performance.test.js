const test = require("node:test");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");

require("../src/shared.js");
require("../src/csv.js");
require("../src/preparation.js");
require("../src/reconstruction.js");
require("../src/processing.js");

const api = globalThis.MapReconstructionWeb;

test("representative large static pipeline stays responsive", { timeout: 30000 }, () => {
  const sampleCount = 120000;
  const lines = [
    "# schema,single-v2",
    '# metadata,"{""mode"":""time""}"',
    "# section,data",
    "Elapsed_s,Current_A",
  ];
  for (let index = 0; index < sampleCount; index += 1) {
    const time = index * 0.0025;
    const value = -2.5e-4 + 2e-5 * Math.sin(index * 0.01);
    lines.push(time.toFixed(6) + "," + value.toPrecision(12));
  }

  const started = performance.now();
  const source = api.csv.parseHappyMeasureCsv(lines.join("\n"), "large.csv");
  const prepared = api.preparation.prepareSignal(source, "Current_A", {
    dark_correction_mode: "none",
  });
  const data = { timeS: prepared.time_s, signals: { Current_A: prepared.values } };
  const result = api.reconstruction.reconstructDualOffset(data, "Current_A", {
    rows: 100,
    cols: 100,
    row_a_s: 0,
    row_b_s: 300,
    rows_apart: 100,
    row_offset: 0,
    point_a_s: 0.5,
    point_b_s: 2.5,
    points_apart: 100,
    point_offset: 0,
    scan_pattern: "same_direction",
    first_row_ltr: true,
    use_median: true,
  });
  const processed = api.processing.processMap(result.values, {
    baseline_mode: "median",
    transform: "absolute",
    normalization: "none",
    value_scale: "linear",
  }, "Current_A");
  const histogram = api.processing.histogram(processed.values, {
    bin_mode: "count",
    bin_count: 50,
  });
  const elapsedMs = performance.now() - started;

  assert.equal(source.sampleCount, sampleCount);
  assert.equal(result.values.length, 10000);
  assert.ok(Array.from(result.values).some(Number.isFinite));
  assert.ok(histogram && histogram.finite_count > 0);
  assert.ok(elapsedMs < 20000, "pipeline took " + elapsedMs.toFixed(0) + " ms");
});
