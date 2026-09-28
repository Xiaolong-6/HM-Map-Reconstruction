const test=require("node:test");
const assert=require("node:assert/strict");
const {webcrypto}=require("node:crypto");
if(!globalThis.crypto)globalThis.crypto=webcrypto;
require("../src/shared.js");require("../src/csv.js");require("../src/preparation.js");require("../src/reconstruction.js");require("../src/processing.js");require("../src/project.js");
const api=globalThis.MapReconstructionWeb;
const encoder=new TextEncoder();

const csvText=["# schema,single-v2",'# metadata,"{""kind"":""map""}"',"# section,data","Elapsed_s,Current_A","0,1","1,2","2,3"].join("\n");
function options(){
 return {rawBytes:encoder.encode(csvText),originalFilename:"source.csv",signal:"Current_A",method:"dual_offset",
  reconstructionParams:api.reconstruction.normalizeDualOffsetParams({rows:1,cols:1,row_a_s:0,row_b_s:1,rows_apart:1,row_offset:0,point_a_s:0,point_b_s:1,points_apart:1,point_offset:0}),
  preparation:api.preparation.normalizeConfig({}),processing:api.processing.normalizeConfig({}),flipY:false,applicationVersion:"test"};
}

test("web stored hmmap round-trips through its format contract",async()=>{
 const built=await api.project.createProjectBytes(options());
 const loaded=await api.project.loadProjectBytes(built.bytes);
 assert.equal(loaded.state.schema,"map-reconstruction-project-v1");assert.equal(loaded.state.source.signal,"Current_A");
 assert.equal(loaded.csv.sampleCount,3);assert.deepEqual(Array.from(loaded.rawBytes),Array.from(encoder.encode(csvText)));
});

test("nondefault preparation selects existing v3 schema",async()=>{
 const o=options();o.preparation=api.preparation.normalizeConfig({dark_correction_mode:"constant",constant_baseline:1,apply_baseline:false});
 const built=await api.project.createProjectBytes(o);assert.equal(built.metadata.schema,"map-reconstruction-project-v3");
 const loaded=await api.project.loadProjectBytes(built.bytes);assert.equal(loaded.state.preparation.dark_correction_mode,"constant");assert.equal(loaded.state.preparation.apply_baseline,false);
});

test("hmmap hash mismatch is rejected",async()=>{
 const built=await api.project.createProjectBytes(options());
 const entries=api.project.centralEntries(built.bytes);const raw=entries.get(api.project.RAW_CSV_PATH);
 const changed=Uint8Array.from(built.bytes);const view=new DataView(changed.buffer);
 const nameLength=view.getUint16(raw.localOffset+26,true),extra=view.getUint16(raw.localOffset+28,true);
 const start=raw.localOffset+30+nameLength+extra;changed[start]^=1;
 await assert.rejects(()=>api.project.loadProjectBytes(changed),/SHA-256|CSV|schema|header/);
});

test("project state rejects v1 paired with phase-window method",async()=>{
 const o=options();const built=await api.project.createProjectBytes(o);const root=JSON.parse(JSON.stringify(built.metadata));
 root.registration.method="dual_offset_phase_window";
 assert.throws(()=>api.project.validateProject(root),/Version 1/);
});


test("partial project with unset geometry remains a valid workspace",async()=>{
 const built=await api.project.createProjectBytes(options());
 const root=JSON.parse(JSON.stringify(built.metadata));
 root.geometry.rows=0;root.geometry.columns=0;root.registration.row_offset=0;root.registration.point_offset=0;
 const state=api.project.validateProject(root);
 assert.equal(state.reconstructionParams.rows,0);assert.equal(state.reconstructionParams.cols,0);
 root.geometry.columns=1;
 assert.throws(()=>api.project.validateProject(root),/both be set or both be zero/);
 root.geometry.columns=0;root.registration.point_offset=1;
 assert.throws(()=>api.project.validateProject(root),/offsets for unset geometry/);
});


test("pure JavaScript SHA-256 fallback matches the standard digest",()=>{
 const bytes=encoder.encode("abc");
 assert.equal(
  api.project.sha256FallbackHex(bytes),
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
 );
});
