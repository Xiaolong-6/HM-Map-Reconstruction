const test=require("node:test");
const assert=require("node:assert/strict");
require("../src/shared.js");
require("../src/processing.js");
const p=globalThis.MapReconstructionWeb.processing;
const close=(a,b,t=1e-12)=>assert.ok(Math.abs(a-b)<=t,a+" != "+b);
const arr=(a,b,t=1e-12)=>{assert.equal(a.length,b.length);a.forEach((v,i)=>Number.isNaN(b[i])?assert.ok(Number.isNaN(v)):close(v,b[i],t));};

test("raw processing is identity and source remains unchanged",()=>{
 const raw=Float64Array.from([-2e-4,-1e-4,-5e-5,NaN]); const copy=Array.from(raw);
 const r=p.processMap(raw,{}, "Current_A"); arr(r.values,copy,0); arr(raw,copy,0); assert.equal(r.baseline_used,null);
});
test("baseline applies before absolute transform",()=>{
 const r=p.processMap([-12,-8],{baseline_mode:"manual",baseline_value:-10,transform:"absolute"}); arr(r.values,[2,2]); close(r.baseline_used,-10);
});
test("statistical baselines and normalization match Python",()=>{
 for(const mode of ["mean","median"]){const r=p.processMap([1,2,3],{baseline_mode:mode});close(r.baseline_used,2);}
 close(p.processMap([1,2,3],{baseline_mode:"minimum"}).baseline_used,1);
 close(p.processMap([1,2,3],{baseline_mode:"maximum"}).baseline_used,3);
 close(p.processMap([1,2,3],{baseline_mode:"percentile",baseline_percentile:50}).baseline_used,2);
 arr(p.processMap([-4,2],{normalization:"max_magnitude"}).values,[-1,0.5]);
 arr(p.processMap([2,4,6],{normalization:"min_max"}).values,[0,0.5,1]);
});
test("log10 excludes non-positive values",()=>{
 const r=p.processMap([100,10,1,0,-1],{value_scale:"log10"}); arr(r.values,[2,1,0,NaN,NaN]); assert.match(r.warnings[0],/2 non-positive/);
});
test("custom expression safe subset supports Python operations",()=>{
 arr(p.evaluateExpression("abs(x) * 2",Float64Array.from([-2,1])),[4,2]);
 arr(p.evaluateExpression("clip(x, -1, 1)",Float64Array.from([-2,1])),[-1,1]);
 arr(p.evaluateExpression("x ** 2",Float64Array.from([-2,1])),[4,1]);
 for(const expr of ['open("file")',"x.__class__","lambda x: x","x[0]","True","1 / 0"]) assert.throws(()=>p.evaluateExpression(expr,Float64Array.from([-2,1])));
});
test("color limits are display-only and constant ranges receive padding",()=>{
 const source=Float64Array.from([-10,-2,1,10]); const before=Array.from(source);
 const limits=p.colorLimits(source,{color_range_mode:"percentile"}); assert.ok(limits.minimum<limits.maximum); arr(source,before,0);
 const constant=p.colorLimits([2,2],{}); assert.ok(constant.minimum<2&&constant.maximum>2);
});
test("histogram ignores non-finite source values",()=>{
 const h=p.histogram([1,NaN,3,Infinity,5,-Infinity]); assert.equal(h.finite_count,3); assert.equal(h.total_count,6);
 assert.equal(Array.from(h.counts).reduce((a,b)=>a+b,0),3); close(h.mean,3); close(h.median,3); assert.ok(h.counts.length>=10&&h.counts.length<=80);
});
test("manual histogram range reports exclusions without changing global stats",()=>{
 const h=p.histogram([0,1,2,3,NaN],{range_mode:"manual",minimum:1,maximum:2,bin_mode:"count",bin_count:2});
 assert.equal(h.shown_count,2);assert.equal(h.below_count,1);assert.equal(h.above_count,1);close(h.mean,1.5);close(h.median,1.5);
 assert.equal(Array.from(h.counts).reduce((a,b)=>a+b,0),2);
});
test("histogram rightmost edge is included",()=>{
 const h=p.histogram([0,0.5,1],{bin_mode:"width",bin_width:0.4});assert.equal(Array.from(h.counts).reduce((a,b)=>a+b,0),3);close(h.edges[h.edges.length-1],1);
});
