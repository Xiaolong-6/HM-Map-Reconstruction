(function (root) {
  "use strict";

  const api = root.MapReconstructionWeb = root.MapReconstructionWeb || {};

  function clearCanvas(canvas) {
    const context = canvas.getContext("2d");
    const ratio = Math.max(1, root.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    return context;
  }

  function traceDataBounds(timeS, series) {
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (let index = 0; index < timeS.length; index += 1) {
      const x = timeS[index];
      if (!Number.isFinite(x)) continue;
      xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
      for (const item of series) {
        const scale = Number.isFinite(item.scale) ? item.scale : 1;
        const y = item.values[index] * scale;
        if (!Number.isFinite(y)) continue;
        yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
      }
    }
    if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) return null;
    if (xMax === xMin) { xMin -= 0.5; xMax += 0.5; }
    if (yMax === yMin) {
      const pad = Math.max(Math.abs(yMin) * 0.01, 1e-12);
      yMin -= pad; yMax += pad;
    } else {
      const pad = (yMax - yMin) * 0.05;
      yMin -= pad; yMax += pad;
    }
    return Object.freeze({ xMin, xMax, yMin, yMax });
  }

  function traceViewport(width, height, timeS, series, view) {
    const data = traceDataBounds(timeS, series);
    if (!data) return null;
    const requested = view || {};
    const xMin = Number.isFinite(requested.xMin) ? requested.xMin : data.xMin;
    const xMax = Number.isFinite(requested.xMax) ? requested.xMax : data.xMax;
    const yMin = Number.isFinite(requested.yMin) ? requested.yMin : data.yMin;
    const yMax = Number.isFinite(requested.yMax) ? requested.yMax : data.yMax;
    if (!(xMin < xMax) || !(yMin < yMax)) return null;
    const margin = { left: 68, right: 24, top: 25, bottom: 46 };
    const plotWidth = Math.max(1, width - margin.left - margin.right);
    const plotHeight = Math.max(1, height - margin.top - margin.bottom);
    return Object.freeze({
      xMin, xMax, yMin, yMax, data,
      left: margin.left, right: margin.left + plotWidth,
      top: margin.top, bottom: margin.top + plotHeight,
      plotWidth, plotHeight,
    });
  }

  function xToPixel(value, viewport) {
    return viewport.left + (value - viewport.xMin) / (viewport.xMax - viewport.xMin) * viewport.plotWidth;
  }
  function yToPixel(value, viewport) {
    return viewport.top + (1 - (value - viewport.yMin) / (viewport.yMax - viewport.yMin)) * viewport.plotHeight;
  }
  function pixelToX(pixel, viewport) {
    return viewport.xMin + (pixel - viewport.left) / viewport.plotWidth * (viewport.xMax - viewport.xMin);
  }
  function pixelToY(pixel, viewport) {
    return viewport.yMax - (pixel - viewport.top) / viewport.plotHeight * (viewport.yMax - viewport.yMin);
  }

  function formatTick(value, span) {
    const number=Number(value);
    if(!Number.isFinite(number))return String(number);
    if(number===0)return "0";
    const magnitude=Math.abs(number);
    const scale=Math.abs(Number(span));
    if(magnitude<1e-3||magnitude>=1e5||(Number.isFinite(scale)&&scale>0&&scale<1e-3)){
      return number.toExponential(3).replace(/\.0+e/,"e").replace(/(\.\d*?[1-9])0+e/,"$1e").replace("e+","e");
    }
    return Number(number.toPrecision(5)).toString();
  }

  function traceEnvelopeIndices(timeS, values, viewport, maxBuckets) {
    const length=Math.min(timeS ? timeS.length : 0, values ? values.length : 0);
    if(!length||!viewport)return [];
    const bucketCount=Math.max(1,Math.floor(maxBuckets||viewport.plotWidth||1));
    const buckets=Array.from({length:bucketCount},()=>null);
    const span=viewport.xMax-viewport.xMin;
    for(let index=0;index<length;index+=1){
      const x=timeS[index];
      if(!Number.isFinite(x)||x<viewport.xMin||x>viewport.xMax)continue;
      const rawBucket=Math.floor((x-viewport.xMin)/span*bucketCount);
      const bucketIndex=Math.max(0,Math.min(bucketCount-1,rawBucket));
      const value=values[index];
      let bucket=buckets[bucketIndex];
      if(!bucket){
        bucket=buckets[bucketIndex]={first:index,last:index,min:index,max:index,gap:null};
      }
      bucket.last=index;
      if(!Number.isFinite(value)){
        if(bucket.gap==null)bucket.gap=index;
        continue;
      }
      if(!Number.isFinite(values[bucket.min])||value<values[bucket.min])bucket.min=index;
      if(!Number.isFinite(values[bucket.max])||value>values[bucket.max])bucket.max=index;
    }
    const output=[];
    let previous=-1;
    for(const bucket of buckets){
      if(!bucket)continue;
      const candidates=[bucket.first,bucket.min,bucket.max,bucket.gap,bucket.last]
        .filter(index=>index!=null)
        .sort((a,b)=>a-b);
      for(const index of candidates){
        if(index!==previous){
          output.push(index);
          previous=index;
        }
      }
    }
    return output;
  }

  function drawTraces(canvas, timeS, series, options) {
    const context = clearCanvas(canvas);
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!timeS || !timeS.length || !series || !series.length) return null;
    const viewport = traceViewport(width, height, timeS, series, options && options.view);
    if (!viewport) return null;
    const margin = { left: viewport.left, right: width - viewport.right, top: viewport.top, bottom: height - viewport.bottom };
    const plotWidth = viewport.plotWidth, plotHeight = viewport.plotHeight;
    const { xMin, xMax, yMin, yMax } = viewport;
    const xPixel = value => xToPixel(value, viewport);
    const yPixel = value => yToPixel(value, viewport);

    if (options && options.regions) {
      for (const region of options.regions) {
        const start = Math.max(xMin, Math.min(xMax, Number(region.start_s)));
        const end = Math.max(xMin, Math.min(xMax, Number(region.end_s)));
        if (!(start < end)) continue;
        const left = xPixel(start), right = xPixel(end);
        context.fillStyle = region.color || "rgba(245,158,11,.14)";
        context.fillRect(left, viewport.top, Math.max(1, right - left), plotHeight);
      }
    }

    context.strokeStyle = "#e3e8f2";
    context.lineWidth = 1;
    context.fillStyle = "#68738a";
    context.font = "12px ui-sans-serif, system-ui, sans-serif";
    context.textAlign = "right";
    context.textBaseline = "middle";
    for (let tick = 0; tick <= 5; tick += 1) {
      const fraction = tick / 5, y = margin.top + fraction * plotHeight;
      context.beginPath(); context.moveTo(margin.left, y); context.lineTo(margin.left + plotWidth, y); context.stroke();
      context.fillText(formatTick(yMax - fraction * (yMax - yMin), yMax - yMin), margin.left - 8, y);
    }
    context.textAlign = "center";
    context.textBaseline = "top";
    for (let tick = 0; tick <= 5; tick += 1) {
      const fraction = tick / 5, x = margin.left + fraction * plotWidth;
      context.fillText(formatTick(xMin + fraction * (xMax - xMin), xMax - xMin), x, margin.top + plotHeight + 9);
    }

    const colors = ["#275fe6", "#d97706", "#168a62", "#7c3aed"];
    const envelopeBuckets = Math.max(320, Math.floor(plotWidth));
    series.forEach(function (item, seriesIndex) {
      context.strokeStyle = item.color || colors[seriesIndex % colors.length];
      context.lineWidth = item.width || 1.35;
      context.setLineDash(item.dash || []);
      context.beginPath();
      let started = false;
      const indices = traceEnvelopeIndices(timeS, item.values, viewport, envelopeBuckets);
      for (const index of indices) {
        const scale = Number.isFinite(item.scale) ? item.scale : 1;
        const value = item.values[index] * scale;
        if (!Number.isFinite(value)) { started = false; continue; }
        const x = xPixel(timeS[index]), y = yPixel(value);
        if (!started) { context.moveTo(x, y); started = true; }
        else context.lineTo(x, y);
      }
      context.stroke();
    });
    context.setLineDash([]);

    if (options && options.markers) {
      context.save();
      context.font = "700 11px ui-sans-serif, system-ui, sans-serif";
      context.textBaseline = "top";
      for (const marker of options.markers) {
        const value = Number(marker.value);
        if (!Number.isFinite(value) || value < xMin || value > xMax) continue;
        const x = xPixel(value);
        context.strokeStyle = marker.color || "#dc2626";
        context.lineWidth = 1.5;
        context.setLineDash(marker.dash || []);
        context.beginPath();
        context.moveTo(x, viewport.top);
        context.lineTo(x, viewport.bottom);
        context.stroke();
        context.setLineDash([]);
        const label = String(marker.label || marker.id || "");
        const width = context.measureText(label).width + 8;
        const left = Math.max(viewport.left, Math.min(viewport.right - width, x - width / 2));
        context.fillStyle = marker.color || "#dc2626";
        context.fillRect(left, viewport.top + 3, width, 18);
        context.fillStyle = "#fff";
        context.textAlign = "center";
        context.fillText(label, left + width / 2, viewport.top + 6);
      }
      context.restore();
    }

    context.fillStyle = "#344054";
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.fillText("Elapsed time / s", margin.left + plotWidth / 2, height - 7);
    context.save();
    context.translate(15, margin.top + plotHeight / 2);
    context.rotate(-Math.PI / 2);
    context.fillText((options && options.yLabel) || "Signal", 0, 0);
    context.restore();
    return viewport;
  }

  function drawTrace(canvas, timeS, values, options) {
    drawTraces(canvas, timeS, [{ values }], options);
  }

  const PALETTES = Object.freeze({
    Viridis: Object.freeze([[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]]),
    Plasma: Object.freeze([[13,8,135],[126,3,168],[204,71,120],[248,149,64],[240,249,33]]),
    Inferno: Object.freeze([[0,0,4],[87,15,109],[187,55,84],[249,142,8],[252,255,164]]),
    Magma: Object.freeze([[0,0,4],[81,18,124],[183,55,121],[251,135,97],[252,253,191]]),
    Cividis: Object.freeze([[0,32,77],[40,80,113],[87,117,119],[149,151,111],[253,234,69]]),
    Grayscale: Object.freeze([[0,0,0],[255,255,255]]),
  });

  function paletteStops(name, inverted) {
    const source = PALETTES[name] || PALETTES.Viridis;
    const stops = source.map(rgb => rgb.slice());
    if (inverted) stops.reverse();
    return stops;
  }

  function heatmapBounds(values, options) {
    const finite = Array.from(values || []).filter(Number.isFinite);
    if (!finite.length) return null;
    const requested = options && options.levels;
    let minimum, maximum;
    if (requested && Number.isFinite(requested.minimum) && Number.isFinite(requested.maximum) && requested.minimum < requested.maximum) {
      minimum = requested.minimum;
      maximum = requested.maximum;
    } else {
      minimum = Math.min(...finite);
      maximum = Math.max(...finite);
      if (maximum === minimum) { minimum -= 0.5; maximum += 0.5; }
    }
    return Object.freeze({ minimum, maximum });
  }

  function heatmapDisplayIndex(index, rows, cols, flipY) {
    const row = Math.floor(index / cols), col = index % cols;
    const displayRow = flipY ? rows - 1 - row : row;
    return displayRow * cols + col;
  }

  function drawHeatmap(canvas, values, rows, cols, options) {
    const context = clearCanvas(canvas);
    if (!rows || !cols || !values || values.length !== rows * cols) return;
    const limits = heatmapBounds(values, options);
    if (!limits) return;
    const minimum = limits.minimum, maximum = limits.maximum;

    const source = document.createElement("canvas");
    source.width = cols; source.height = rows;
    const sourceContext = source.getContext("2d");
    const image = sourceContext.createImageData(cols, rows);
    const stops = (options && options.counts)
      ? [[239,246,255],[96,165,250],[23,62,140]]
      : paletteStops(
          options && options.palette ? options.palette : "Viridis",
          Boolean(options && options.inverted),
        );
    function colorAt(fraction) {
      const t = Math.max(0, Math.min(1, fraction)) * (stops.length - 1);
      const left = Math.floor(t), right = Math.min(stops.length - 1, left + 1), f = t - left;
      return [0,1,2].map(channel => Math.round(stops[left][channel] * (1 - f) + stops[right][channel] * f));
    }
    const flipY = Boolean(options && options.flipY);
    for (let index = 0; index < values.length; index += 1) {
      const target = heatmapDisplayIndex(index, rows, cols, flipY) * 4, value = values[index];
      if (!Number.isFinite(value)) { image.data[target + 3] = 0; continue; }
      const color = colorAt((value - minimum) / (maximum - minimum));
      image.data[target] = color[0]; image.data[target + 1] = color[1]; image.data[target + 2] = color[2]; image.data[target + 3] = 255;
    }
    sourceContext.putImageData(image, 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0, canvas.clientWidth, canvas.clientHeight);
  }

  function drawHistogram(canvas, histogram, options) {
    const context=clearCanvas(canvas);
    if(!histogram||!histogram.counts.length)return;
    const scale=options&&Number.isFinite(options.scale)?options.scale:1;
    const unit=options&&options.unit?String(options.unit):"";
    const suffix=unit?" "+unit:"";
    const width=canvas.clientWidth,height=canvas.clientHeight,margin={left:48,right:18,top:28,bottom:42};
    const pw=Math.max(1,width-margin.left-margin.right),ph=Math.max(1,height-margin.top-margin.bottom);
    const maxCount=Math.max(1,...histogram.counts);
    context.strokeStyle="#e3e8f2";context.fillStyle="#60a5fa";
    for(let i=0;i<histogram.counts.length;i+=1){
      const x0=margin.left+i*pw/histogram.counts.length;
      const x1=margin.left+(i+1)*pw/histogram.counts.length;
      const h=histogram.counts[i]/maxCount*ph;
      context.fillRect(x0+0.5,margin.top+ph-h,Math.max(1,x1-x0-1),h);
    }
    context.strokeStyle="#94a3b8";context.beginPath();context.moveTo(margin.left,margin.top);context.lineTo(margin.left,margin.top+ph);context.lineTo(margin.left+pw,margin.top+ph);context.stroke();
    context.fillStyle="#68738a";context.font="12px ui-sans-serif, system-ui, sans-serif";
    context.textAlign="left";
    context.fillText(formatTick(histogram.minimum*scale,(histogram.maximum-histogram.minimum)*scale)+suffix,margin.left,margin.top+ph+20);
    context.textAlign="right";
    context.fillText(formatTick(histogram.maximum*scale,(histogram.maximum-histogram.minimum)*scale)+suffix,margin.left+pw,margin.top+ph+20);
    context.font="11px ui-sans-serif, system-ui, sans-serif";
    context.fillText(
      "n="+histogram.shown_count+"  mean="+formatTick(histogram.mean*scale,(histogram.maximum-histogram.minimum)*scale)+suffix+
      "  median="+formatTick(histogram.median*scale,(histogram.maximum-histogram.minimum)*scale)+suffix,
      width-margin.right,16
    );
  }

  api.plotting = Object.freeze({
    clearCanvas, drawTrace, drawTraces,
    traceDataBounds, traceViewport, traceEnvelopeIndices, xToPixel, yToPixel, pixelToX, pixelToY, formatTick,
    paletteStops, heatmapBounds, heatmapDisplayIndex, drawHeatmap, drawHistogram
  });
})(typeof window !== "undefined" ? window : globalThis);
