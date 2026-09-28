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
const out = path.join(__dirname, "..", "tests", "oracle");
fs.mkdirSync(out, { recursive: true });
const rawText = "\ufeff" + [
  "# schema,single-v2",
  '# metadata,"{""operator"":""A, B"",""mode"":""time""}"',
  "# section,data",
  "Elapsed_s,Current_A,Voltage_V",
  "2,20,0.20",
  "1,10,0.10",
  "1,11,0.11",
].join("\r\n");
const rawBytes = new TextEncoder().encode(rawText);

async function save(name, method, params, preparation) {
  const result = await api.project.createProjectBytes({
    rawBytes,
    originalFilename: "oracle.csv",
    signal: "Current_A",
    method,
    reconstructionParams: params,
    preparation,
    processing: api.processing.normalizeConfig({}),
    flipY: false,
    applicationVersion: "web-oracle",
  });
  fs.writeFileSync(path.join(out, name), Buffer.from(result.bytes));
}

(async () => {
  const dual = api.reconstruction.normalizeDualOffsetParams({
    rows: 1, cols: 1,
    row_a_s: 0, row_b_s: 1, rows_apart: 1, row_offset: 0,
    point_a_s: 0, point_b_s: 1, points_apart: 1, point_offset: 0,
  });
  const phase = api.reconstruction.normalizePhaseWindowParams({
    rows: 1, cols: 1,
    row_a_s: 0, row_b_s: 10, rows_apart: 1, row_offset: 0, y_phase_fraction: 0,
    point_a_s: 0, point_b_s: 1, points_apart: 1,
    x_period_offset: 0, x_phase_fraction: 0.5,
    window_mode: "fraction", window_fraction: 0.5, aggregation: "median",
  });
  await save("web_v1.hmmap", "dual_offset", dual, api.preparation.normalizeConfig({}));
  await save("web_v2.hmmap", "dual_offset_phase_window", phase, api.preparation.normalizeConfig({}));
  await save("web_v3.hmmap", "dual_offset", dual, api.preparation.normalizeConfig({
    dark_correction_mode: "constant", constant_baseline: 1, apply_baseline: false,
  }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
