(function (root) {
  "use strict";

  const api = root.MapReconstructionWeb = root.MapReconstructionWeb || {};
  const math = api.math;
  const MAX_HISTOGRAM_BINS = 10000;

  function finiteValues(values) {
    return Array.from(values).filter(Number.isFinite);
  }

  function tokenize(expression) {
    const tokens = [];
    let index = 0;
    while (index < expression.length) {
      const rest = expression.slice(index);
      const whitespace = rest.match(/^\s+/);
      if (whitespace) { index += whitespace[0].length; continue; }
      const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
      if (number) { tokens.push({ type:"number", value:Number(number[0]) }); index += number[0].length; continue; }
      const name = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (name) { tokens.push({ type:"name", value:name[0] }); index += name[0].length; continue; }
      if (rest.startsWith("**")) { tokens.push({ type:"op", value:"**" }); index += 2; continue; }
      const char = rest[0];
      if ("+-*/(),".includes(char)) { tokens.push({ type: char === "(" || char === ")" || char === "," ? char : "op", value:char }); index += 1; continue; }
      throw new Error("Invalid custom expression near " + JSON.stringify(rest.slice(0, 12)) + ".");
    }
    tokens.push({ type:"eof", value:"" });
    return tokens;
  }

  function scalarOrArray(value, length) {
    if (typeof value === "number") return value;
    if (value instanceof Float64Array && value.length === length) return value;
    throw new Error("Custom expression returned an incompatible shape.");
  }

  function mapUnary(value, length, fn) {
    if (typeof value === "number") return fn(value);
    const out = new Float64Array(length);
    for (let i=0;i<length;i+=1) out[i]=fn(value[i]);
    return out;
  }

  function mapBinary(left, right, length, fn) {
    if (typeof left === "number" && typeof right === "number") return fn(left,right);
    const out = new Float64Array(length);
    for (let i=0;i<length;i+=1) {
      const a = typeof left === "number" ? left : left[i];
      const b = typeof right === "number" ? right : right[i];
      out[i]=fn(a,b);
    }
    return out;
  }

  function evaluateExpression(expression, x) {
    const tokens = tokenize(String(expression));
    let cursor = 0;
    const length = x.length;
    const peek = () => tokens[cursor];
    const take = () => tokens[cursor++];
    const expect = type => {
      const token=take();
      if (token.type!==type) throw new Error("Custom expression contains an unsupported operation.");
      return token;
    };

    function primary() {
      const token=peek();
      if (token.type==="number") { take(); return token.value; }
      if (token.type==="name") {
        take();
        if (token.value==="x") {
          if (peek().type==="(") throw new Error("Function 'x' is not allowed.");
          return Float64Array.from(x);
        }
        if (peek().type!=="(") throw new Error("Unknown name " + JSON.stringify(token.value) + "; only x and approved functions are allowed.");
        take();
        const args=[];
        if (peek().type!==")") {
          while (true) {
            args.push(addSub());
            if (peek().type!==",") break;
            take();
          }
        }
        expect(")");
        const approved = ["abs","sqrt","log","log10","exp","clip","minimum","maximum"];
        if (!approved.includes(token.value)) throw new Error("Function " + JSON.stringify(token.value) + " is not allowed.");
        if (["abs","sqrt","log","log10","exp"].includes(token.value)) {
          if (args.length!==1) throw new Error("Custom expression could not be evaluated: wrong argument count.");
          const fn = {
            abs:Math.abs, sqrt:Math.sqrt, log:Math.log, log10:Math.log10, exp:Math.exp
          }[token.value];
          return mapUnary(args[0],length,fn);
        }
        if (token.value==="clip") {
          if (args.length!==3) throw new Error("Custom expression could not be evaluated: wrong argument count.");
          return mapBinary(mapBinary(args[0],args[1],length,(a,b)=>Math.max(a,b)),args[2],length,(a,b)=>Math.min(a,b));
        }
        if (args.length!==2) throw new Error("Custom expression could not be evaluated: wrong argument count.");
        return mapBinary(args[0],args[1],length,token.value==="minimum"?Math.min:Math.max);
      }
      if (token.type==="(") { take(); const value=addSub(); expect(")"); return value; }
      throw new Error("Custom expression contains an unsupported operation.");
    }

    function unary() {
      if (peek().type==="op" && (peek().value==="+" || peek().value==="-")) {
        const op=take().value;
        const value=unary();
        return op==="+" ? value : mapUnary(value,length,a=>-a);
      }
      return primary();
    }

    function power() {
      let left=unary();
      if (peek().type==="op" && peek().value==="**") {
        take();
        const right=power();
        left=mapBinary(left,right,length,(a,b)=>Math.pow(a,b));
      }
      return left;
    }

    function mulDiv() {
      let left=power();
      while (peek().type==="op" && (peek().value==="*" || peek().value==="/")) {
        const op=take().value, right=power();
        if (op==="/" && typeof left==="number" && typeof right==="number" && right===0) {
          throw new Error("Custom expression could not be evaluated: division by zero.");
        }
        left=mapBinary(left,right,length,op==="*"?(a,b)=>a*b:(a,b)=>a/b);
      }
      return left;
    }

    function addSub() {
      let left=mulDiv();
      while (peek().type==="op" && (peek().value==="+" || peek().value==="-")) {
        const op=take().value, right=mulDiv();
        left=mapBinary(left,right,length,op==="+"?(a,b)=>a+b:(a,b)=>a-b);
      }
      return left;
    }

    const result=scalarOrArray(addSub(),length);
    if (peek().type!=="eof") throw new Error("Custom expression contains an unsupported operation.");
    if (typeof result==="number") {
      const out=new Float64Array(length); out.fill(result); return out;
    }
    return result;
  }

  function normalizeConfig(input) {
    const source=input||{};
    const config={
      baseline_mode:source.baseline_mode||"none",
      baseline_value:source.baseline_value==null?null:Number(source.baseline_value),
      baseline_percentile:source.baseline_percentile==null?50:Number(source.baseline_percentile),
      transform:source.transform||"raw",
      custom_expression:source.custom_expression==null?"x":String(source.custom_expression),
      normalization:source.normalization||"none",
      normalization_reference:source.normalization_reference==null?null:Number(source.normalization_reference),
      value_scale:source.value_scale||"linear",
      color_range_mode:source.color_range_mode||"auto",
      color_min:source.color_min==null?null:Number(source.color_min),
      color_max:source.color_max==null?null:Number(source.color_max),
      percentile_low:source.percentile_low==null?1:Number(source.percentile_low),
      percentile_high:source.percentile_high==null?99:Number(source.percentile_high)
    };
    if (!["none","manual","mean","median","minimum","maximum","percentile"].includes(config.baseline_mode)) throw new Error("Unsupported baseline mode.");
    if (!["raw","absolute","negate","custom"].includes(config.transform)) throw new Error("Unsupported value transform.");
    if (!["none","max_magnitude","min_max","reference"].includes(config.normalization)) throw new Error("Unsupported normalization mode.");
    if (!["linear","log10"].includes(config.value_scale)) throw new Error("Unsupported value scale.");
    if (!["auto","percentile","manual"].includes(config.color_range_mode)) throw new Error("Unsupported color range mode.");
    return Object.freeze(config);
  }

  function signalLabel(name) { return name==="Current_A"?"Current":(name==="Voltage_V"?"Voltage":(name||"Signal")); }
  function signalUnit(name) { return name==="Current_A"?"A":(name==="Voltage_V"?"V":""); }
  function processingLabel(signalName,config,dimensionlessBeforeLog) {
    let base=signalLabel(signalName);
    if(config.transform==="absolute") base="|"+base+"|";
    else if(config.transform==="negate") base="-"+base;
    else if(config.transform==="custom") base="Transformed value";
    if(config.normalization!=="none") base="Normalized "+base.replace(/[|\-]/g,"");
    if(config.value_scale==="log10") {
      if(dimensionlessBeforeLog) return "log10("+base.toLowerCase()+")";
      const unit=signalUnit(signalName); return unit?"log10("+base+" / "+unit+")":"log10("+base+")";
    }
    return base;
  }

  function processMap(rawValues, inputConfig, signalName) {
    const config=normalizeConfig(inputConfig);
    const raw=Float64Array.from(rawValues);
    const finiteRaw=finiteValues(raw);
    const warnings=[];
    const dimensionlessBeforeLog=config.normalization!=="none"||config.transform==="custom";
    if(!finiteRaw.length) return Object.freeze({
      values:Float64Array.from(raw,()=>NaN), baseline_used:null,
      warnings:Object.freeze(["No finite map values are available for processing."]),
      value_label:processingLabel(signalName||"Signal",config,dimensionlessBeforeLog),
      is_dimensionless:dimensionlessBeforeLog||config.value_scale==="log10", config
    });

    let baseline=0;
    if(config.baseline_mode==="manual") {
      if(config.baseline_value==null||!Number.isFinite(config.baseline_value)) throw new Error("Manual baseline must be a finite number.");
      baseline=config.baseline_value;
    } else if(config.baseline_mode==="mean") baseline=math.mean(finiteRaw);
    else if(config.baseline_mode==="median") baseline=math.median(finiteRaw);
    else if(config.baseline_mode==="minimum") baseline=Math.min(...finiteRaw);
    else if(config.baseline_mode==="maximum") baseline=Math.max(...finiteRaw);
    else if(config.baseline_mode==="percentile") {
      if(!(config.baseline_percentile>=0&&config.baseline_percentile<=100)) throw new Error("Baseline percentile must be between 0 and 100.");
      baseline=math.quantile(finiteRaw,config.baseline_percentile/100);
    }

    let values=new Float64Array(raw.length);
    const valid=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i+=1) {
      if(Number.isFinite(raw[i])) { valid[i]=1; values[i]=raw[i]-baseline; } else values[i]=NaN;
    }

    if(config.transform==="absolute") for(let i=0;i<values.length;i+=1) if(valid[i]) values[i]=Math.abs(values[i]);
    else if(config.transform==="negate") for(let i=0;i<values.length;i+=1) if(valid[i]) values[i]=-values[i];
    else if(config.transform==="custom") {
      values=evaluateExpression(config.custom_expression,values);
      let generated=0;
      for(let i=0;i<values.length;i+=1) {
        if(!valid[i]) values[i]=NaN;
        else if(!Number.isFinite(values[i])) { values[i]=NaN; generated+=1; }
      }
      if(generated) warnings.push(generated+" pixel(s) became non-finite during custom processing and were excluded.");
    }

    let finite=finiteValues(values);
    if(config.normalization==="max_magnitude") {
      const reference=finite.length?Math.max(...finite.map(Math.abs)):0;
      if(reference===0) throw new Error("Cannot normalize by max magnitude because the reference is zero.");
      for(let i=0;i<values.length;i+=1) if(Number.isFinite(values[i])) values[i]/=reference;
    } else if(config.normalization==="min_max") {
      if(finite.length) {
        const min=Math.min(...finite),max=Math.max(...finite);
        if(max===min) throw new Error("Cannot apply min-max normalization because all finite values are equal.");
        for(let i=0;i<values.length;i+=1) if(Number.isFinite(values[i])) values[i]=(values[i]-min)/(max-min);
      }
    } else if(config.normalization==="reference") {
      if(config.normalization_reference==null||!Number.isFinite(config.normalization_reference)) throw new Error("Normalization reference must be a finite number.");
      if(config.normalization_reference===0) throw new Error("Normalization reference must be non-zero.");
      for(let i=0;i<values.length;i+=1) if(Number.isFinite(values[i])) values[i]/=config.normalization_reference;
    }

    if(config.value_scale==="log10") {
      let excluded=0;
      for(let i=0;i<values.length;i+=1) {
        if(Number.isFinite(values[i])) {
          if(values[i]>0) values[i]=Math.log10(values[i]);
          else { values[i]=NaN; excluded+=1; }
        }
      }
      if(excluded) warnings.push(excluded+" non-positive pixels excluded by log10 scale.");
    }

    return Object.freeze({
      values, baseline_used:config.baseline_mode==="none"?null:baseline,
      warnings:Object.freeze(warnings), value_label:processingLabel(signalName||"Signal",config,dimensionlessBeforeLog),
      is_dimensionless:dimensionlessBeforeLog||config.value_scale==="log10", config
    });
  }

  function colorLimits(values,inputConfig) {
    const config=normalizeConfig(inputConfig);
    const finite=finiteValues(values);
    if(!finite.length) return null;
    let minimum,maximum;
    if(config.color_range_mode==="auto") { minimum=Math.min(...finite); maximum=Math.max(...finite); }
    else if(config.color_range_mode==="percentile") {
      if(!(config.percentile_low>=0&&config.percentile_low<config.percentile_high&&config.percentile_high<=100)) throw new Error("Color percentiles must satisfy 0 <= low < high <= 100.");
      minimum=math.quantile(finite,config.percentile_low/100); maximum=math.quantile(finite,config.percentile_high/100);
    } else {
      minimum=config.color_min; maximum=config.color_max;
      if(minimum==null||maximum==null||!Number.isFinite(minimum)||!Number.isFinite(maximum)||minimum>=maximum) throw new Error("Manual color minimum must be finite and less than maximum.");
    }
    if(minimum===maximum) {
      const padding=Math.max(Math.abs(minimum)*0.01,1e-12);
      return Object.freeze({minimum:minimum-padding,maximum:maximum+padding});
    }
    return Object.freeze({minimum,maximum});
  }

  function normalizeHistogramConfig(input) {
    const source=input||{};
    const config={
      range_mode:source.range_mode||"auto", minimum:source.minimum==null?null:Number(source.minimum),
      maximum:source.maximum==null?null:Number(source.maximum), bin_mode:source.bin_mode||"auto",
      bin_count:source.bin_count==null?50:Number(source.bin_count), bin_width:source.bin_width==null?1:Number(source.bin_width)
    };
    if(!["auto","manual"].includes(config.range_mode)||!["auto","count","width"].includes(config.bin_mode)) throw new Error("Unsupported histogram configuration.");
    if(config.range_mode==="manual"&&(config.minimum==null||config.maximum==null||!Number.isFinite(config.minimum)||!Number.isFinite(config.maximum)||config.minimum>=config.maximum)) throw new Error("Histogram minimum must be finite and less than maximum.");
    if(config.bin_mode==="count"&&(!Number.isInteger(config.bin_count)||config.bin_count<=0||config.bin_count>MAX_HISTOGRAM_BINS)) throw new Error("Histogram bin count must be between 1 and 10,000.");
    if(config.bin_mode==="width"&&(!Number.isFinite(config.bin_width)||config.bin_width<=0)) throw new Error("Histogram bin width must be finite and greater than zero.");
    return Object.freeze(config);
  }

  function autoBinCount(values) {
    if(values.length<=1) return 10;
    const min=Math.min(...values),max=Math.max(...values),range=max-min;
    if(range===0) return 10;
    const q25=math.quantile(values,0.25),q75=math.quantile(values,0.75);
    const fd=2*(q75-q25)*Math.pow(values.length,-1/3);
    const sturges=range/(Math.log2(values.length)+1);
    const width=fd>0?Math.min(fd,sturges):sturges;
    const count=Math.ceil(range/width);
    return Math.max(10,Math.min(80,count));
  }

  function histogram(values,inputConfig) {
    const source=Array.from(values);
    const finite=finiteValues(source);
    if(!finite.length) return null;
    const config=normalizeHistogramConfig(inputConfig);
    let minimum,maximum;
    if(config.range_mode==="manual") { minimum=config.minimum; maximum=config.maximum; }
    else {
      minimum=Math.min(...finite); maximum=Math.max(...finite);
      if(minimum===maximum) { const pad=Math.max(Math.abs(minimum)*0.01,0.5); minimum-=pad; maximum+=pad; }
    }
    const below=finite.filter(v=>v<minimum).length,above=finite.filter(v=>v>maximum).length;
    const shown=finite.filter(v=>v>=minimum&&v<=maximum);
    let count;
    if(config.bin_mode==="auto") count=autoBinCount(finite);
    else if(config.bin_mode==="count") count=config.bin_count;
    else {
      count=Math.max(1,Math.ceil((maximum-minimum)/config.bin_width));
      if(count>MAX_HISTOGRAM_BINS) throw new Error("Histogram bin width would create "+count.toLocaleString()+" bins; the maximum is 10,000.");
    }
    const edges=new Float64Array(count+1);
    if(config.bin_mode==="width") {
      for(let i=0;i<=count;i+=1) edges[i]=minimum+i*config.bin_width;
      edges[count]=maximum;
    } else {
      for(let i=0;i<=count;i+=1) edges[i]=minimum+(maximum-minimum)*i/count;
    }
    const counts=new Int32Array(count);
    for(const value of shown) {
      let bin=value===maximum?count-1:Math.floor((value-minimum)/(maximum-minimum)*count);
      bin=Math.max(0,Math.min(count-1,bin)); counts[bin]+=1;
    }
    return Object.freeze({
      counts,edges,finite_count:finite.length,total_count:source.length,shown_count:shown.length,
      below_count:below,above_count:above,mean:math.mean(finite),median:math.median(finite),minimum,maximum
    });
  }

  api.processing=Object.freeze({
    MAX_HISTOGRAM_BINS,normalizeConfig,evaluateExpression,processMap,colorLimits,
    normalizeHistogramConfig,histogram,autoBinCount
  });
})(typeof window !== "undefined" ? window : globalThis);
