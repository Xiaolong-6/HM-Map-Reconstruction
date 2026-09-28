(function(root){
  "use strict";
  const api=root.MapReconstructionWeb=root.MapReconstructionWeb||{};
  const textDecoder=new TextDecoder("utf-8",{fatal:true});
  const textEncoder=new TextEncoder();
  const PROJECT_JSON_PATH="project.json";
  const RAW_CSV_PATH="source/raw_timeseries.csv";
  const SCHEMAS=new Set(["map-reconstruction-project-v1","map-reconstruction-project-v2","map-reconstruction-project-v3"]);

  function u16(view,o){return view.getUint16(o,true);}
  function u32(view,o){return view.getUint32(o,true);}

  async function inflateRaw(bytes){
    if(typeof DecompressionStream!=="undefined"){
      try{
        const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      }catch(error){
        if(typeof require!=="function") throw new Error("This browser does not support ZIP deflate decompression: "+error.message);
      }
    }
    if(typeof require==="function"){
      const zlib=require("node:zlib");
      return Uint8Array.from(zlib.inflateRawSync(Buffer.from(bytes)));
    }
    throw new Error("This browser cannot decompress Python-created .hmmap archives.");
  }

  function centralEntries(bytes){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    let eocd=-1;
    const lower=Math.max(0,bytes.length-65557);
    for(let i=bytes.length-22;i>=lower;i-=1){
      if(u32(view,i)===0x06054b50){eocd=i;break;}
    }
    if(eocd<0)throw new Error("Project file is not a valid ZIP archive.");
    const count=u16(view,eocd+10),centralSize=u32(view,eocd+12),centralOffset=u32(view,eocd+16);
    if(centralOffset+centralSize>bytes.length)throw new Error("Project ZIP central directory is invalid.");
    const entries=new Map();
    let cursor=centralOffset;
    for(let n=0;n<count;n+=1){
      if(cursor+46>bytes.length||u32(view,cursor)!==0x02014b50)throw new Error("Project ZIP central directory entry is invalid.");
      const method=u16(view,cursor+10),compressedSize=u32(view,cursor+20),uncompressedSize=u32(view,cursor+24);
      const nameLength=u16(view,cursor+28),extraLength=u16(view,cursor+30),commentLength=u16(view,cursor+32);
      const localOffset=u32(view,cursor+42);
      const nameBytes=bytes.slice(cursor+46,cursor+46+nameLength);
      const name=textDecoder.decode(nameBytes);
      entries.set(name,{name,method,compressedSize,uncompressedSize,localOffset});
      cursor+=46+nameLength+extraLength+commentLength;
    }
    return entries;
  }

  async function extractEntry(bytes,entry){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const o=entry.localOffset;
    if(o+30>bytes.length||u32(view,o)!==0x04034b50)throw new Error("Project ZIP local header is invalid.");
    const nameLength=u16(view,o+26),extraLength=u16(view,o+28),start=o+30+nameLength+extraLength,end=start+entry.compressedSize;
    if(end>bytes.length)throw new Error("Project ZIP entry is truncated.");
    const compressed=bytes.slice(start,end);
    let result;
    if(entry.method===0)result=compressed;
    else if(entry.method===8)result=await inflateRaw(compressed);
    else throw new Error("Unsupported ZIP compression method "+entry.method+".");
    if(result.length!==entry.uncompressedSize)throw new Error("Project ZIP entry size check failed.");
    return result;
  }

  async function sha256Hex(bytes){
    if(!root.crypto||!root.crypto.subtle)throw new Error("SHA-256 verification is unavailable in this browser context.");
    const digest=await root.crypto.subtle.digest("SHA-256",bytes);
    return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  }

  function processingFromProject(payload){
    if(!payload||typeof payload!=="object")throw new Error("Invalid project processing configuration.");
    const required=["baseline_mode","baseline_value","baseline_percentile","transform","custom_expression","normalization","normalization_reference","value_scale","color_range_mode","color_min","color_max","percentile_low","percentile_high"];
    for(const key of required)if(!(key in payload))throw new Error("Invalid project processing: missing "+key+".");
    return api.processing.normalizeConfig(payload);
  }

  function preparationFromProject(root,signal){
    if(root.schema!=="map-reconstruction-project-v3")return api.preparation.normalizeConfig({});
    const payload=root.preparation;
    if(!payload||typeof payload!=="object")throw new Error("Invalid project preparation.");
    if((payload.signal||signal)!==signal)throw new Error("Project preparation signal must match source.signal.");
    const nested=payload.dark_correction&&typeof payload.dark_correction==="object"?payload.dark_correction:{};
    const regions=payload.manual_regions||nested.manual_regions||[];
    let gateEnabled=false,gateMin=-Infinity,gateMax=Infinity;
    if(payload.value_gate!=null){
      if(typeof payload.value_gate!=="object"||payload.value_gate.min==null||payload.value_gate.max==null)throw new Error("Invalid preparation.value_gate.");
      gateEnabled=true;gateMin=Number(payload.value_gate.min);gateMax=Number(payload.value_gate.max);
    }
    return api.preparation.normalizeConfig({
      dark_correction_mode:payload.baseline_model||payload.mode||nested.mode||"none",
      constant_baseline:payload.constant_baseline==null?0:payload.constant_baseline,
      manual_dark_regions:regions,
      manual_region_fit:payload.manual_region_fit||nested.manual_region_fit||"constant",
      rolling_quantile:payload.rolling_quantile!=null?payload.rolling_quantile:(nested.quantile!=null?Number(nested.quantile)/100:0.9),
      rolling_window_s:payload.rolling_window_s!=null?payload.rolling_window_s:(nested.window_s==null?10:nested.window_s),
      rolling_trend:payload.rolling_trend||nested.trend||"piecewise_linear",
      response_direction:payload.response_direction||"negative",
      value_gate_enabled:gateEnabled,value_gate_min:gateMin,value_gate_max:gateMax,
      output_convention:payload.output_convention||"measured_minus_dark",
      apply_baseline:payload.apply_baseline,invert_signal:payload.invert_signal
    });
  }

  function validateProject(root){
    if(!root||typeof root!=="object"||Array.isArray(root))throw new Error("Project metadata must be an object.");
    if(!SCHEMAS.has(root.schema))throw new Error("Unsupported Map Reconstruction project schema: "+JSON.stringify(root.schema));
    const source=root.source,geometry=root.geometry,registration=root.registration,display=root.display;
    if(!source||!geometry||!registration||!display)throw new Error("Project metadata is missing required sections.");
    if(source.embedded_path!==RAW_CSV_PATH)throw new Error("Project embedded raw-data path is invalid.");
    if(typeof source.original_filename!=="string"||!source.original_filename||/[\\/]/.test(source.original_filename))throw new Error("Invalid project source filename.");
    if(typeof source.signal!=="string"||!source.signal)throw new Error("Invalid project source signal.");
    if(typeof source.sha256!=="string"||!/^[0-9a-f]{64}$/.test(source.sha256))throw new Error("Invalid project field source.sha256.");
    const method=registration.method;
    if(!["dual_offset","dual_offset_phase_window"].includes(method))throw new Error("Unsupported Map Reconstruction registration method.");
    if(root.schema==="map-reconstruction-project-v1"&&method!=="dual_offset")throw new Error("Version 1 projects must use Legacy Dual Offset.");
    const processing=processingFromProject(root.map_processing||root.processing);
    const preparation=preparationFromProject(root,source.signal);
    const rows=Number(geometry.rows),cols=Number(geometry.columns);
    if(!Number.isInteger(rows)||rows<0||!Number.isInteger(cols)||cols<0)throw new Error("Invalid project geometry dimensions.");
    if(Boolean(rows)!==Boolean(cols))throw new Error("Invalid project geometry: rows and columns must both be set or both be zero.");
    const common={
      rows,cols,scan_pattern:geometry.scan_pattern,
      first_row_ltr:Boolean(geometry.first_row_ltr),row_a_s:Number(registration.row_a_s),row_b_s:Number(registration.row_b_s),
      rows_apart:Number(registration.rows_apart),row_offset:Number(registration.row_offset),point_a_s:Number(registration.point_a_s),
      point_b_s:Number(registration.point_b_s),points_apart:Number(registration.points_apart)
    };
    const rawPointOffset=registration.point_offset==null?0:Number(registration.point_offset);
    if(rows===0&&(common.row_offset>0||rawPointOffset>0))throw new Error("Invalid project offsets for unset geometry.");
    let reconstructionParams;
    const normalizerCommon=rows===0?Object.assign({},common,{rows:1,cols:1}):common;
    if(method==="dual_offset"){
      reconstructionParams=api.reconstruction.normalizeDualOffsetParams(Object.assign(normalizerCommon,{
        point_offset:Number(registration.point_offset),use_median:geometry.aggregation==="median"
      }));
    }else{
      reconstructionParams=api.reconstruction.normalizePhaseWindowParams(Object.assign(normalizerCommon,{
        y_phase_fraction:Number(registration.y_phase_fraction),x_period_offset:Number(registration.x_period_offset),
        x_phase_fraction:Number(registration.x_phase_fraction),window_mode:registration.window_mode,
        window_fraction:Number(registration.window_fraction),window_duration_s:registration.window_duration_s,
        aggregation:geometry.aggregation
      }));
    }
    if(rows===0){
      if(reconstructionParams.row_offset!==0||rawPointOffset!==0)throw new Error("Invalid project offsets for unset geometry.");
      reconstructionParams=Object.freeze(Object.assign({},reconstructionParams,{rows:0,cols:0}));
    }
    return Object.freeze({schema:root.schema,source:Object.freeze({...source}),method,reconstructionParams,processing,preparation,flip_y:Boolean(display.flip_y),metadata:root});
  }

  async function loadProjectBytes(input){
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    const entries=centralEntries(bytes);
    if(!entries.has(PROJECT_JSON_PATH))throw new Error("Project archive is missing project.json.");
    if(!entries.has(RAW_CSV_PATH))throw new Error("Project archive is missing embedded raw data.");
    let metadata;
    try{metadata=JSON.parse(textDecoder.decode(await extractEntry(bytes,entries.get(PROJECT_JSON_PATH))));}
    catch(error){if(error instanceof SyntaxError)throw new Error("Project metadata is not valid JSON.");throw error;}
    const rawBytes=await extractEntry(bytes,entries.get(RAW_CSV_PATH));
    const state=validateProject(metadata);
    const actual=await sha256Hex(rawBytes);
    if(actual!==state.source.sha256)throw new Error("Embedded raw data failed SHA-256 verification.");
    const csv=api.csv.parseHappyMeasureCsv(textDecoder.decode(rawBytes),state.source.original_filename);
    if(!Object.prototype.hasOwnProperty.call(csv.signals,state.source.signal))throw new Error("Project source signal is absent from embedded raw data.");
    return Object.freeze({state,rawBytes,csv,projectMetadata:metadata});
  }

  let crcTable=null;
  function crc32(bytes){
    if(!crcTable){
      crcTable=new Uint32Array(256);
      for(let n=0;n<256;n+=1){let c=n;for(let k=0;k<8;k+=1)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);crcTable[n]=c>>>0;}
    }
    let crc=0xffffffff;
    for(const byte of bytes)crc=crcTable[(crc^byte)&0xff]^(crc>>>8);
    return (crc^0xffffffff)>>>0;
  }
  function writeU16(out,o,v){out[o]=v&255;out[o+1]=(v>>>8)&255;}
  function writeU32(out,o,v){out[o]=v&255;out[o+1]=(v>>>8)&255;out[o+2]=(v>>>16)&255;out[o+3]=(v>>>24)&255;}

  function buildStoredZip(files){
    const records=[];let localSize=0;
    for(const file of files){
      const name=textEncoder.encode(file.name),data=file.data instanceof Uint8Array?file.data:new Uint8Array(file.data);
      records.push({name,data,crc:crc32(data),offset:localSize});
      localSize+=30+name.length+data.length;
    }
    const centralSize=records.reduce((sum,r)=>sum+46+r.name.length,0);
    const out=new Uint8Array(localSize+centralSize+22);let cursor=0;
    for(const r of records){
      writeU32(out,cursor,0x04034b50);writeU16(out,cursor+4,20);writeU16(out,cursor+6,0);writeU16(out,cursor+8,0);
      writeU16(out,cursor+10,0);writeU16(out,cursor+12,0x21);writeU32(out,cursor+14,r.crc);writeU32(out,cursor+18,r.data.length);
      writeU32(out,cursor+22,r.data.length);writeU16(out,cursor+26,r.name.length);writeU16(out,cursor+28,0);
      out.set(r.name,cursor+30);out.set(r.data,cursor+30+r.name.length);cursor+=30+r.name.length+r.data.length;
    }
    const centralOffset=cursor;
    for(const r of records){
      writeU32(out,cursor,0x02014b50);writeU16(out,cursor+4,20);writeU16(out,cursor+6,20);writeU16(out,cursor+8,0);writeU16(out,cursor+10,0);
      writeU16(out,cursor+12,0);writeU16(out,cursor+14,0x21);writeU32(out,cursor+16,r.crc);writeU32(out,cursor+20,r.data.length);
      writeU32(out,cursor+24,r.data.length);writeU16(out,cursor+28,r.name.length);writeU16(out,cursor+30,0);writeU16(out,cursor+32,0);
      writeU16(out,cursor+34,0);writeU16(out,cursor+36,0);writeU32(out,cursor+38,0);writeU32(out,cursor+42,r.offset);out.set(r.name,cursor+46);cursor+=46+r.name.length;
    }
    writeU32(out,cursor,0x06054b50);writeU16(out,cursor+4,0);writeU16(out,cursor+6,0);writeU16(out,cursor+8,records.length);
    writeU16(out,cursor+10,records.length);writeU32(out,cursor+12,centralSize);writeU32(out,cursor+16,centralOffset);writeU16(out,cursor+20,0);
    return out;
  }

  function preparationToProject(config,signal){
    return {
      signal,mode:config.dark_correction_mode,
      dark_correction:{mode:config.dark_correction_mode,quantile:config.rolling_quantile*100,window_s:config.rolling_window_s,trend:config.rolling_trend,
        manual_regions:config.manual_dark_regions.map(r=>({start_s:r.start_s,end_s:r.end_s})),manual_region_fit:config.manual_region_fit},
      constant_baseline:config.constant_baseline,manual_region_fit:config.manual_region_fit,
      manual_regions:config.manual_dark_regions.map(r=>({start_s:r.start_s,end_s:r.end_s})),
      rolling_quantile:config.rolling_quantile,rolling_window_s:config.rolling_window_s,rolling_trend:config.rolling_trend,
      response_direction:config.response_direction,value_gate:config.value_gate_enabled?{min:config.value_gate_min,max:config.value_gate_max}:null,
      output_convention:config.output_convention,baseline_model:config.dark_correction_mode,apply_baseline:config.apply_baseline,invert_signal:config.invert_signal
    };
  }
  function hasNondefaultPreparation(c){
    return c.dark_correction_mode!=="none"||c.constant_baseline!==0||c.manual_dark_regions.length!==0||c.manual_region_fit!=="constant"||
      c.rolling_quantile!==0.9||c.rolling_window_s!==10||c.rolling_trend!=="piecewise_linear"||c.response_direction!=="negative"||
      c.value_gate_enabled||c.apply_baseline!==false||c.invert_signal!==false;
  }

  async function createProjectBytes(options){
    const rawBytes=options.rawBytes instanceof Uint8Array?options.rawBytes:new Uint8Array(options.rawBytes);
    if(!rawBytes.length)throw new Error("Cannot export a project without raw source data.");
    const prep=api.preparation.normalizeConfig(options.preparation||{});
    const processing=api.processing.normalizeConfig(options.processing||{});
    const params=options.reconstructionParams;
    const method=options.method;
    const nondefault=hasNondefaultPreparation(prep);
    const schema=nondefault?"map-reconstruction-project-v3":(method==="dual_offset_phase_window"?"map-reconstruction-project-v2":"map-reconstruction-project-v1");
    const hash=await sha256Hex(rawBytes);
    const registration={
      method,row_a_s:params.row_a_s,row_b_s:params.row_b_s,rows_apart:params.rows_apart,row_offset:params.row_offset,
      point_a_s:params.point_a_s,point_b_s:params.point_b_s,points_apart:params.points_apart
    };
    if(method==="dual_offset")registration.point_offset=params.point_offset;
    else Object.assign(registration,{y_phase_fraction:params.y_phase_fraction,x_period_offset:params.x_period_offset,x_phase_fraction:params.x_phase_fraction,
      window_mode:params.window_mode,window_fraction:params.window_fraction,window_duration_s:params.window_duration_s});
    const root={
      schema,application:{name:"Map Reconstruction",version:String(options.applicationVersion||"web-prototype")},
      created_at:new Date().toISOString(),
      source:{original_filename:options.originalFilename,embedded_path:RAW_CSV_PATH,sha256:hash,signal:options.signal},
      geometry:{rows:params.rows,columns:params.cols,scan_pattern:params.scan_pattern,first_row_ltr:params.first_row_ltr,
        aggregation:method==="dual_offset"?(params.use_median?"median":"mean"):params.aggregation},
      registration,processing:{...processing},display:{flip_y:Boolean(options.flipY)}
    };
    if(nondefault){root.map_processing={...processing};root.preparation=preparationToProject(prep,options.signal);}
    const json=textEncoder.encode(JSON.stringify(root,null,2));
    return Object.freeze({bytes:buildStoredZip([{name:PROJECT_JSON_PATH,data:json},{name:RAW_CSV_PATH,data:rawBytes}]),metadata:root});
  }

  api.project=Object.freeze({PROJECT_JSON_PATH,RAW_CSV_PATH,centralEntries,extractEntry,sha256Hex,validateProject,loadProjectBytes,buildStoredZip,createProjectBytes,hasNondefaultPreparation});
})(typeof window!=="undefined"?window:globalThis);
