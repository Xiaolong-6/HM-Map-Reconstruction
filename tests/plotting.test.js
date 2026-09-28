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


test("tick formatting keeps small scientific values readable",()=>{
  assert.equal(p.formatTick(0.00002449,0.00002),"2.449e-5");
  assert.equal(p.formatTick(120,120),"120");
  assert.equal(p.formatTick(24,120),"24");
});


test("histogram endpoint labels use compact tick formatter",()=>{
  assert.equal(p.formatTick(1.658e-6,1e-6),"1.658e-6");
  assert.equal(p.formatTick(-2.4e-6,1e-6),"-2.4e-6");
});


test("trace envelope preserves narrow extrema instead of stride-aliasing them",()=>{
  const time=Array.from({length:1000},(_,i)=>i);
  const values=Array(1000).fill(0);
  values[501]=9;
  values[502]=-7;
  const viewport=p.traceViewport(800,400,time,[{values,scale:1}],{xMin:0,xMax:999,yMin:-8,yMax:10});
  const indices=p.traceEnvelopeIndices(time,values,viewport,10);
  assert.ok(indices.includes(501));
  assert.ok(indices.includes(502));
  assert.ok(indices.length<80);
});

test("trace envelope retains a non-finite gap marker",()=>{
  const time=Array.from({length:100},(_,i)=>i);
  const values=Array(100).fill(1);
  values[50]=NaN;
  const viewport=p.traceViewport(500,300,time,[{values,scale:1}],{xMin:0,xMax:99,yMin:0,yMax:2});
  const indices=p.traceEnvelopeIndices(time,values,viewport,5);
  assert.ok(indices.includes(50));
});


test("heatmap viewport preserves cell aspect ratio and explicit zoom",()=>{
  const viewport=p.heatmapViewport(600,600,50,50,{xMin:10,xMax:30,yMin:5,yMax:25});
  assert.equal(viewport.xMin,10);
  assert.equal(viewport.xMax,30);
  assert.equal(viewport.yMin,5);
  assert.equal(viewport.yMax,25);
  assert.ok(Math.abs(viewport.plotWidth-viewport.plotHeight)<1e-9);
  const center=p.mapPixelToData(
    viewport.left+viewport.plotWidth/2,
    viewport.top+viewport.plotHeight/2,
    viewport,
  );
  assert.ok(Math.abs(center.x-20)<1e-12);
  assert.ok(Math.abs(center.y-15)<1e-12);
});

test("heatmap viewport fits rectangular geometry without stretching cells",()=>{
  const viewport=p.heatmapViewport(800,500,20,40,null);
  assert.ok(Math.abs(viewport.plotWidth/viewport.plotHeight-2)<1e-9);
});
