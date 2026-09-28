const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { webcrypto } = require("node:crypto");

if (!globalThis.crypto) globalThis.crypto = webcrypto;

require("../src/shared.js");
require("../src/csv.js");
require("../src/preparation.js");
require("../src/reconstruction.js");
require("../src/processing.js");
require("../src/project.js");

const api = globalThis.MapReconstructionWeb;
const oraclePath = path.join(__dirname, "oracle", "python_oracle.json");
const required = process.env.REQUIRE_PYTHON_ORACLE === "1";

function decode(value) {
  if (Array.isArray(value)) return value.map(decode);
  if (value === "NaN") return NaN;
  if (value === "Infinity") return Infinity;
  if (value === "-Infinity") return -Infinity;
  return value;
}

function close(actual, expected, tolerance = 1e-10) {
  if (Number.isNaN(expected)) return assert.ok(Number.isNaN(actual));
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tolerance * scale, actual + " != " + expected);
}

function closeArray(actual, expected, tolerance = 1e-10) {
  const wanted = decode(expected);
  assert.equal(actual.length, wanted.length);
  for (let index = 0; index < wanted.length; index += 1) close(actual[index], wanted[index], tolerance);
}

if (!fs.existsSync(oraclePath)) {
  test("Python oracle fixture is available", { skip: !required }, () => {
    assert.fail("tests/oracle/python_oracle.json was not generated");
  });
} else {
  const oracle = JSON.parse(fs.readFileSync(oraclePath, "utf8"));

  test("oracle pin is the declared HappyMeasure baseline", () => {
    assert.equal(oracle.oracle.commit, "402b88f1c42cff41bf6054e1724bc62b4deb7af3");
  });

  test("CSV import matches Python oracle", () => {
    const result = api.csv.parseHappyMeasureCsv(oracle.csv.raw_text, "oracle.csv");
    closeArray(result.timeS, oracle.csv.time_s, 0);
    for (const [name, values] of Object.entries(oracle.csv.signals)) {
      closeArray(result.signals[name], values, 0);
    }
    assert.deepEqual(result.metadata, oracle.csv.metadata);
  });

  for (const name of ["constant", "manual_linear", "rolling"]) {
    test("Signal Preparation matches Python oracle: " + name, () => {
      const item = oracle.preparation[name];
      const data = {
        timeS: Float64Array.from(decode(item.time_s)),
        signals: { Current_A: Float64Array.from(decode(item.values_in)) },
      };
      const result = api.preparation.prepareSignal(data, "Current_A", item.config);
      closeArray(result.values, item.values, 2e-9);
      closeArray(result.baseline, item.baseline, 2e-9);
    });
  }

  test("dual-offset timing matches Python oracle", () => {
    const item = oracle.reconstruction.dual_timing;
    const result = api.reconstruction.solveTiming(item.params);
    for (const [key, expected] of Object.entries(item.timing)) close(result[key], expected, 1e-12);
  });

  test("phase-window reconstruction matches Python oracle", () => {
    const item = oracle.reconstruction.phase_single;
    const data = {
      timeS: Float64Array.from(decode(item.time_s)),
      signals: { Current_A: Float64Array.from(decode(item.values_in)) },
    };
    const result = api.reconstruction.reconstructPhaseWindow(data, "Current_A", item.params);
    closeArray(result.values, item.values, 1e-12);
    assert.deepEqual(Array.from(result.sample_counts), item.sample_counts);
    for (const [key, expected] of Object.entries(item.timing)) close(result.timing[key], expected, 1e-12);
  });

  test("legacy conversion preserves Python reconstruction", () => {
    const item = oracle.reconstruction.legacy_conversion;
    const time = Array.from({ length: 300 }, (_, index) => index * 0.1 + 0.013);
    const data = { timeS: Float64Array.from(time), signals: { Current_A: Float64Array.from(time) } };
    const legacy = api.reconstruction.reconstructDualOffset(data, "Current_A", item.params);
    const converted = api.reconstruction.convertLegacyToPhaseWindow(item.params);
    const phase = api.reconstruction.reconstructPhaseWindow(data, "Current_A", converted.params);
    closeArray(legacy.values, item.values, 1e-12);
    assert.deepEqual(Array.from(legacy.sample_counts), item.sample_counts);
    closeArray(phase.values, item.phase_values, 1e-12);
    assert.deepEqual(Array.from(phase.sample_counts), item.phase_sample_counts);
    close(converted.timing.window_width_s, item.window_width_s, 1e-12);
  });

  for (const name of ["baseline_absolute", "min_max", "log10"]) {
    test("map processing matches Python oracle: " + name, () => {
      const item = oracle.processing[name];
      const result = api.processing.processMap(decode(item.input), item.config, "Current_A");
      closeArray(result.values, item.values, 1e-12);
      if ("baseline_used" in item) close(result.baseline_used, item.baseline_used, 1e-12);
      if (item.warnings) assert.deepEqual(result.warnings, item.warnings);
    });
  }

  test("color-limit padding matches Python oracle", () => {
    const item = oracle.processing.constant_color_limits;
    const result = api.processing.colorLimits(item.values, {});
    close(result.minimum, item.minimum, 1e-12);
    close(result.maximum, item.maximum, 1e-12);
  });

  test("histogram count semantics match Python oracle", () => {
    const item = oracle.processing.histogram;
    const result = api.processing.histogram(decode(item.input), item.config);
    assert.deepEqual(Array.from(result.counts), item.counts);
    closeArray(result.edges, item.edges, 1e-12);
    assert.equal(result.finite_count, item.finite_count);
    assert.equal(result.total_count, item.total_count);
    close(result.mean, item.mean, 1e-12);
    close(result.median, item.median, 1e-12);
  });

  for (const name of ["python_v1.hmmap", "python_v3.hmmap"]) {
    test("Python-created project opens in Web: " + name, async () => {
      const bytes = fs.readFileSync(path.join(__dirname, "oracle", name));
      const loaded = await api.project.loadProjectBytes(bytes);
      assert.equal(loaded.state.source.signal, "Current_A");
      assert.equal(loaded.csv.sampleCount, 3);
    });
  }
}
