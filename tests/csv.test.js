const test = require("node:test");
const assert = require("node:assert/strict");

require("../src/shared.js");
require("../src/csv.js");

const parser = globalThis.MapReconstructionWeb.csv.parseHappyMeasureCsv;

function fixture(schema = "single-v2") {
  return [
    "# schema," + schema,
    '# metadata,"{""operator"":""A, B"",""mode"":""time""}"',
    "# section,data",
    "Elapsed_s,Current_A,Voltage_V",
    "2,20,0.20",
    "1,10,0.10",
    "1,11,0.11"
  ].join("\r\n");
}

test("single-v2 import matches Python stable-sort semantics", () => {
  const parsed = parser("\uFEFF" + fixture(), "fixture.csv");
  assert.deepEqual(Array.from(parsed.timeS), [1, 1, 2]);
  assert.deepEqual(Array.from(parsed.signals.Current_A), [10, 11, 20]);
  assert.deepEqual(Array.from(parsed.signals.Voltage_V), [0.10, 0.11, 0.20]);
  assert.deepEqual(parsed.signalNames, ["Current_A", "Voltage_V"]);
  assert.equal(parsed.metadata.operator, "A, B");
  assert.equal(parsed.sampleCount, 3);
});

test("combined exports are rejected explicitly", () => {
  assert.throws(() => parser(fixture("combined-v2"), "combined.csv"), /not supported/);
});

test("non-finite values are rejected", () => {
  const text = fixture().replace("2,20,0.20", "2,Infinity,0.20");
  assert.throws(() => parser(text, "bad.csv"), /non-numeric or non-finite/);
});

test("quoted metadata commas stay in one CSV field", () => {
  const parsed = parser(fixture(), "fixture.csv");
  assert.deepEqual(parsed.metadata, { operator: "A, B", mode: "time" });
});
