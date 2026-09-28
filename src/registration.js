(function(root){
  "use strict";
  const api=root.MapReconstructionWeb=root.MapReconstructionWeb||{};

  const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));

  function median(values){
    if(!values.length)return NaN;
    const copy=Array.from(values).sort((a,b)=>a-b);
    const middle=Math.floor(copy.length/2);
    return copy.length%2?copy[middle]:(copy[middle-1]+copy[middle])/2;
  }

  function quantile(values,q){
    if(!values.length)return NaN;
    const copy=Array.from(values).sort((a,b)=>a-b);
    const position=clamp(q,0,1)*(copy.length-1);
    const left=Math.floor(position),right=Math.ceil(position);
    if(left===right)return copy[left];
    const fraction=position-left;
    return copy[left]*(1-fraction)+copy[right]*fraction;
  }

  function resampleUniform(time,values,maxSamples){
    const finite=[];
    const length=Math.min(time?time.length:0,values?values.length:0);
    for(let i=0;i<length;i+=1){
      const t=Number(time[i]),v=Number(values[i]);
      if(Number.isFinite(t)&&Number.isFinite(v))finite.push([t,v]);
    }
    if(finite.length<64)throw new Error("Registration recommendation needs at least 64 finite samples.");
    const tMin=finite[0][0],tMax=finite[finite.length-1][0],duration=tMax-tMin;
    if(!(duration>0))throw new Error("Registration recommendation needs a positive time span.");
    const count=Math.max(256,Math.min(Number(maxSamples)||6000,finite.length));
    const dt=duration/(count-1);
    const sampled=new Float64Array(count);
    let source=0;
    for(let i=0;i<count;i+=1){
      const target=tMin+i*dt;
      while(source+1<finite.length&&finite[source+1][0]<target)source+=1;
      const left=finite[source],right=finite[Math.min(finite.length-1,source+1)];
      if(right[0]===left[0])sampled[i]=left[1];
      else{
        const fraction=clamp((target-left[0])/(right[0]-left[0]),0,1);
        sampled[i]=left[1]+fraction*(right[1]-left[1]);
      }
    }
    const center=median(sampled);
    const deviations=Array.from(sampled,value=>Math.abs(value-center));
    const mad=median(deviations);
    const rms=Math.sqrt(Array.from(sampled,value=>(value-center)*(value-center)).reduce((a,b)=>a+b,0)/sampled.length);
    const scale=mad>0?1.4826*mad:(rms||1);
    const normalized=Float64Array.from(sampled,value=>(value-center)/scale);
    const edge=new Float64Array(count);
    for(let i=1;i<count;i+=1)edge[i]=Math.abs(normalized[i]-normalized[i-1]);
    const edgeCap=quantile(edge,0.98);
    if(Number.isFinite(edgeCap)&&edgeCap>0){
      for(let i=0;i<edge.length;i+=1)edge[i]=Math.min(edge[i],edgeCap);
    }
    const smoothed=new Float64Array(count);
    for(let i=0;i<count;i+=1){
      let sum=0,n=0;
      for(let j=Math.max(0,i-1);j<=Math.min(count-1,i+1);j+=1){sum+=edge[j];n+=1;}
      smoothed[i]=sum/n;
    }
    return Object.freeze({tMin,tMax,duration,dt,normalized,edge:smoothed});
  }

  function correlationAtLag(series,lag){
    if(!(lag>=1)||lag>=series.length-4)return -Infinity;
    let ab=0,aa=0,bb=0,n=0;
    const stride=Math.max(1,Math.floor((series.length-lag)/3000));
    for(let i=0;i+lag<series.length;i+=stride){
      const a=series[i],b=series[i+lag];
      ab+=a*b;aa+=a*a;bb+=b*b;n+=1;
    }
    if(n<16||aa<=0||bb<=0)return -Infinity;
    return ab/Math.sqrt(aa*bb);
  }

  function estimatePeriod(series,dt,expected,minFactor,maxFactor){
    if(!(expected>0))throw new Error("Expected period must be positive.");
    const minLag=Math.max(2,Math.floor(expected*minFactor/dt));
    const maxLag=Math.min(series.length-8,Math.ceil(expected*maxFactor/dt));
    if(maxLag<=minLag)throw new Error("Trace is too short to estimate the requested period.");
    const coarseCount=Math.min(180,Math.max(40,maxLag-minLag+1));
    const step=Math.max(1,Math.floor((maxLag-minLag)/Math.max(1,coarseCount-1)));
    const candidates=[];
    for(let lag=minLag;lag<=maxLag;lag+=step)candidates.push([lag,correlationAtLag(series,lag)]);
    if(candidates[candidates.length-1][0]!==maxLag)candidates.push([maxLag,correlationAtLag(series,maxLag)]);
    candidates.sort((a,b)=>b[1]-a[1]);
    let bestLag=candidates[0][0],bestScore=candidates[0][1];
    const refineLow=Math.max(minLag,bestLag-step-2),refineHigh=Math.min(maxLag,bestLag+step+2);
    for(let lag=refineLow;lag<=refineHigh;lag+=1){
      const score=correlationAtLag(series,lag);
      if(score>bestScore){bestScore=score;bestLag=lag;}
    }
    const scores=candidates.map(item=>item[1]).filter(Number.isFinite);
    const baseline=median(scores);
    const prominence=Number.isFinite(baseline)?bestScore-baseline:0;
    const confidence=clamp(Math.max(0,bestScore)*0.65+Math.max(0,prominence)*0.9,0,1);
    return Object.freeze({period_s:bestLag*dt,score:bestScore,confidence,best_lag:bestLag});
  }

  function edgeAtTime(resampled,time){
    const coordinate=(time-resampled.tMin)/resampled.dt;
    if(coordinate<0||coordinate>resampled.edge.length-1)return null;
    return resampled.edge[Math.round(coordinate)];
  }

  function phaseCost(resampled,rowPeriod,pointPeriod,rows,cols,phase){
    let centerCost=0,transitionReward=0,count=0;
    const first=resampled.tMin+phase;
    const scanRows=Math.min(rows+2,Math.ceil(resampled.duration/rowPeriod)+2);
    const offsets=[0.25,0.34,0.43];
    for(let row=-1;row<scanRows;row+=1){
      const rowBase=first+row*rowPeriod;
      for(let col=0;col<cols;col+=1){
        const center=rowBase+col*pointPeriod;
        const edge=edgeAtTime(resampled,center);
        if(edge==null)continue;
        centerCost+=edge;
        let nearby=0;
        for(const fraction of offsets){
          const before=edgeAtTime(resampled,center-fraction*pointPeriod);
          const after=edgeAtTime(resampled,center+fraction*pointPeriod);
          if(before!=null)nearby=Math.max(nearby,before);
          if(after!=null)nearby=Math.max(nearby,after);
        }
        transitionReward+=nearby;
        count+=1;
      }
    }
    if(count<Math.max(8,Math.min(rows*cols,32)))return Infinity;
    return centerCost/count-0.32*transitionReward/count;
  }

  function estimateCenterPhase(resampled,rowPeriod,pointPeriod,rows,cols){
    const coarse=128;
    let bestPhase=0,bestCost=Infinity;
    const costs=[];
    for(let i=0;i<coarse;i+=1){
      const phase=rowPeriod*i/coarse;
      const cost=phaseCost(resampled,rowPeriod,pointPeriod,rows,cols,phase);
      costs.push(cost);
      if(cost<bestCost){bestCost=cost;bestPhase=phase;}
    }
    const halfStep=rowPeriod/coarse;
    for(let i=-48;i<=48;i+=1){
      let phase=bestPhase+i*halfStep/48;
      phase=((phase%rowPeriod)+rowPeriod)%rowPeriod;
      const cost=phaseCost(resampled,rowPeriod,pointPeriod,rows,cols,phase);
      if(cost<bestCost){bestCost=cost;bestPhase=phase;}
    }
    const finite=costs.filter(Number.isFinite);
    const typical=median(finite),q25=quantile(finite,0.25);
    const contrast=Number.isFinite(typical)&&typical>0?clamp((typical-bestCost)/typical,0,1):0;
    const separation=Number.isFinite(q25)&&q25>0?clamp((q25-bestCost)/q25,0,1):0;
    return Object.freeze({phase_s:bestPhase,cost:bestCost,confidence:clamp(0.6*contrast+0.4*separation,0,1)});
  }

  function confidenceLabel(value){
    if(value>=0.72)return "high";
    if(value>=0.42)return "medium";
    return "low";
  }

  function recommend(time,values,geometry,options){
    const rows=Number(geometry&&geometry.rows),cols=Number(geometry&&geometry.cols);
    if(!Number.isInteger(rows)||rows<1||!Number.isInteger(cols)||cols<1){
      throw new Error("Enter positive integer Rows and Columns before recommending registration.");
    }
    const resampled=resampleUniform(time,values,options&&options.maxSamples);
    const row=estimatePeriod(resampled.edge,resampled.dt,resampled.duration/rows,0.55,1.55);
    const point=estimatePeriod(resampled.edge,resampled.dt,row.period_s/cols,0.55,1.45);
    const windowFraction=clamp(Number(options&&options.windowFraction)||0.65,0.1,1);
    const halfWindow=windowFraction*point.period_s/2;
    const minCenterOffset=halfWindow;
    const maxCenterOffset=row.period_s-(cols-1)*point.period_s-halfWindow;
    if(!(maxCenterOffset>minCenterOffset)){
      throw new Error("Detected X period does not fit the requested number of columns inside one Y period.");
    }
    const phase=estimateCenterPhase(resampled,row.period_s,point.period_s,rows,cols);
    const centerOffset=(minCenterOffset+maxCenterOffset)/2;
    let firstCenter=resampled.tMin+phase.phase_s;
    let row0=firstCenter-centerOffset;
    while(row0<resampled.tMin){row0+=row.period_s;firstCenter+=row.period_s;}
    const xCoordinate=centerOffset/point.period_s;
    const xOffset=Math.max(0,Math.floor(xCoordinate+1e-12));
    const xPhase=((xCoordinate-xOffset)%1+1)%1;
    const rowsApart=rows>1?Math.min(10,rows-1):1;
    const pointsApart=cols>1?Math.min(5,cols-1):1;
    const overall=Math.min(row.confidence,point.confidence,Math.max(0.25,phase.confidence));
    return Object.freeze({
      row_a_s:row0,
      row_b_s:row0+rowsApart*row.period_s,
      rows_apart:rowsApart,
      row_offset:0,
      y_phase_fraction:0,
      point_a_s:firstCenter,
      point_b_s:firstCenter+pointsApart*point.period_s,
      points_apart:pointsApart,
      x_period_offset:xOffset,
      x_phase_fraction:xPhase,
      row_period_s:row.period_s,
      point_period_s:point.period_s,
      confidence:overall,
      confidence_label:confidenceLabel(overall),
      diagnostics:Object.freeze({
        row_correlation:row.score,
        point_correlation:point.score,
        center_stability:phase.confidence,
      }),
    });
  }

  api.registrationRecommendation=Object.freeze({
    resampleUniform,estimatePeriod,estimateCenterPhase,recommend,confidenceLabel,
  });
})(typeof window!=="undefined"?window:globalThis);
