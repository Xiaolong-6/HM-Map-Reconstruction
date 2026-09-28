const test=require("node:test");
const assert=require("node:assert/strict");
require("../src/registration.js");
const r=globalThis.MapReconstructionWeb.registrationRecommendation;

function syntheticTrace({rows=24,cols=30,rowPeriod=5,pointPeriod=0.15,dt=0.005,centerOffset=0.42}={}){
  const duration=rows*rowPeriod;
  const count=Math.floor(duration/dt)+1;
  const time=new Float64Array(count),values=new Float64Array(count);
  for(let i=0;i<count;i+=1){
    const t=i*dt;
    time[i]=t;
    const row=Math.floor(t/rowPeriod);
    const phase=t-row*rowPeriod;
    let value=-2+0.03*Math.sin(t*0.7);
    for(let col=0;col<cols;col+=1){
      const center=centerOffset+col*pointPeriod;
      if(Math.abs(phase-center)<pointPeriod*0.34){
        value=1+0.11*(col%7)+0.02*(row%5);
        break;
      }
    }
    values[i]=value;
  }
  return {time,values};
}

test("registration recommendation recovers map-like row and point periods",()=>{
  const source=syntheticTrace();
  const rec=r.recommend(source.time,source.values,{rows:24,cols:30},{windowFraction:0.5});
  assert.ok(Math.abs(rec.row_period_s-5)/5<0.08,"row period="+rec.row_period_s);
  assert.ok(Math.abs(rec.point_period_s-0.15)/0.15<0.08,"point period="+rec.point_period_s);
  assert.equal(rec.rows_apart,10);
  assert.equal(rec.points_apart,5);
  assert.ok(rec.x_phase_fraction>=0&&rec.x_phase_fraction<1);
  assert.ok(rec.confidence>=0&&rec.confidence<=1);
});

test("recommended lattice lands near stable synthetic pixel centers",()=>{
  const source=syntheticTrace({rows:18,cols:20,rowPeriod:4,pointPeriod:0.18,centerOffset:0.36});
  const rec=r.recommend(source.time,source.values,{rows:18,cols:20},{windowFraction:0.45});
  const rowPeriod=(rec.row_b_s-rec.row_a_s)/rec.rows_apart;
  const pointPeriod=(rec.point_b_s-rec.point_a_s)/rec.points_apart;
  const firstCenter=rec.row_a_s+(rec.x_period_offset+rec.x_phase_fraction)*pointPeriod;
  let error=0,count=0;
  for(let row=0;row<6;row+=1){
    for(let col=0;col<20;col+=1){
      const predicted=firstCenter+row*rowPeriod+col*pointPeriod;
      const phase=((predicted%4)+4)%4;
      const expected=0.36+col*0.18;
      error+=Math.abs(phase-expected);
      count+=1;
    }
  }
  assert.ok(error/count<0.14,"mean center error="+error/count);
});

test("invalid geometry is rejected before recommendation",()=>{
  const source=syntheticTrace();
  assert.throws(()=>r.recommend(source.time,source.values,{rows:0,cols:30}),/Rows and Columns/);
});
