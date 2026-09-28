const test=require("node:test");
const assert=require("node:assert/strict");
require("../src/plotting.js");
const p=globalThis.MapReconstructionWeb.plotting;

test("heatmap display uses explicit color levels when supplied",()=>{
  const levels=p.heatmapBounds([0,5,10],{levels:{minimum:2,maximum:8}});
  assert.deepEqual(levels,{minimum:2,maximum:8});
});

test("heatmap flip Y changes only display row ordering",()=>{
  const rows=2,cols=3;
  assert.equal(p.heatmapDisplayIndex(0,rows,cols,false),0);
  assert.equal(p.heatmapDisplayIndex(0,rows,cols,true),3);
  assert.equal(p.heatmapDisplayIndex(5,rows,cols,true),2);
});
