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


test("named palettes and inversion are display-only lookup choices",()=>{
  const viridis=p.paletteStops("Viridis",false);
  const inverted=p.paletteStops("Viridis",true);
  assert.deepEqual(inverted[0],viridis[viridis.length-1]);
  assert.deepEqual(inverted[inverted.length-1],viridis[0]);
  assert.notDeepEqual(p.paletteStops("Plasma",false),viridis);
  assert.deepEqual(p.paletteStops("unknown",false),viridis);
});


test("trace viewport accepts explicit axis ranges",()=>{
  const viewport=p.traceViewport(
    800, 400,
    [0,1,2],
    [{values:[10,20,30],scale:1}],
    {xMin:0.5,xMax:1.5,yMin:15,yMax:25},
  );
  assert.equal(viewport.xMin,0.5);
  assert.equal(viewport.xMax,1.5);
  assert.equal(viewport.yMin,15);
  assert.equal(viewport.yMax,25);
  assert.ok(Math.abs(p.pixelToX(p.xToPixel(1,viewport),viewport)-1)<1e-12);
  assert.ok(Math.abs(p.pixelToY(p.yToPixel(20,viewport),viewport)-20)<1e-12);
});
