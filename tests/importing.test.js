const test = require("node:test");
const assert = require("node:assert/strict");

require("../src/shared.js");
require("../src/importing.js");
require("../src/csv.js");

const importing = globalThis.MapReconstructionWeb.importing;
const csv = globalThis.MapReconstructionWeb.csv;

test("generic comma data can be mapped into canonical single-v2", () => {
  const inspected = importing.inspectDelimited(
    "time,current,aux\n2,20,200\n1,10,100\n1,11,110\n",
    "generic.csv",
  );
  assert.equal(inspected.delimiter, ",");
  assert.equal(inspected.hasHeader, true);
  const canonical = importing.canonicalizeDelimited(inspected, {
    timeColumn: "time",
    signalColumns: ["current", "aux"],
  });
  const parsed = csv.parseHappyMeasureCsv(canonical.canonicalText, "generic.csv");
  assert.deepEqual(Array.from(parsed.timeS), [1, 1, 2]);
  assert.deepEqual(Array.from(parsed.signals.current), [10, 11, 20]);
  assert.equal(parsed.metadata.import_format, "generic-delimited");
});

test("tab, semicolon and whitespace delimiters are detected", () => {
  assert.equal(importing.inspectDelimited("t\tx\n0\t1\n1\t2\n", "a.tsv").delimiter, "\t");
  assert.equal(importing.inspectDelimited("t;x\n0;1\n1;2\n", "a.txt").delimiter, ";");
  assert.equal(importing.inspectDelimited("0 1\n1 2\n2 3\n", "a.dat").delimiter, "whitespace");
});

test("headerless data can generate time from sample interval", () => {
  const inspected = importing.inspectDelimited("1,10\n2,20\n3,30\n", "raw.csv");
  assert.equal(inspected.hasHeader, false);
  const canonical = importing.canonicalizeDelimited(inspected, {
    timeMode: "index",
    sampleIntervalS: 0.25,
    signalColumns: ["Column_2"],
  });
  assert.deepEqual(Array.from(canonical.timeS), [0, 0.25, 0.5]);
});

test("non-numeric selected columns are rejected at commit time", () => {
  const inspected = importing.inspectDelimited("t,label,x\n0,a,1\n1,b,2\n", "mixed.csv");
  assert.throws(() => importing.canonicalizeDelimited(inspected, {
    timeColumn: "t",
    signalColumns: ["label"],
  }), /non-numeric/);
});

test("HappyMeasure detection is explicit", () => {
  assert.equal(importing.looksLikeHappyMeasure("# schema,single-v2\n# section,data\nElapsed_s,x\n0,1\n"), true);
  assert.equal(importing.looksLikeHappyMeasure("time,x\n0,1\n"), false);
});


test("generic import retains finite rows when numeric columns contain gaps", () => {
  const inspected = importing.inspectDelimited(
    "time,current,aux\n0,1,10\n1,,11\n2,3,12\n3,NaN,13\n4,5,14\n",
    "gappy.csv",
  );
  const current = inspected.columns.find(column => column.name === "current");
  assert.equal(current.numeric, true);
  assert.equal(current.finiteCount, 3);
  const canonical = importing.canonicalizeDelimited(inspected, {
    timeColumn: "time",
    signalColumns: ["current", "aux"],
  });
  assert.equal(canonical.sampleCount, 3);
  assert.equal(canonical.metadata.dropped_row_count, 2);
  assert.deepEqual(Array.from(canonical.timeS), [0, 2, 4]);
});
