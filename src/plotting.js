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

  function bounds(timeS, series) {
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
    return { xMin, xMax, yMin, yMax };
  }

  function drawTraces(canvas, timeS, series, options) {
    const context = clearCanvas(canvas);
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const margin = { left: 68, right: 24, top: 25, bottom: 46 };
    const plotWidth = Math.max(1, width - margin.left - margin.right);
    const plotHeight = Math.max(1, height - margin.top - margin.bottom);
    if (!timeS || !timeS.length || !series || !series.length) return;

    let { xMin, xMax, yMin, yMax } = bounds(timeS, series);
    if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) return;
    if (xMax === xMin) { xMin -= 0.5; xMax += 0.5; }
    if (yMax === yMin) {
      const pad = Math.max(Math.abs(yMin) * 0.01, 1e-12);
      yMin -= pad; yMax += pad;
    } else {
      const pad = (yMax - yMin) * 0.05;
      yMin -= pad; yMax += pad;
    }

    const xPixel = value => margin.left + (value - xMin) / (xMax - xMin) * plotWidth;
    const yPixel = value => margin.top + (1 - (value - yMin) / (yMax - yMin)) * plotHeight;

    context.strokeStyle = "#e3e8f2";
    context.lineWidth = 1;
    context.fillStyle = "#68738a";
    context.font = "12px ui-sans-serif, system-ui, sans-serif";
    context.textAlign = "right";
    context.textBaseline = "middle";
    for (let tick = 0; tick <= 5; tick += 1) {
      const fraction = tick / 5, y = margin.top + fraction * plotHeight;
      context.beginPath(); context.moveTo(margin.left, y); context.lineTo(margin.left + plotWidth, y); context.stroke();
      context.fillText((yMax - fraction * (yMax - yMin)).toPrecision(4), margin.left - 8, y);
    }
    context.textAlign = "center";
    context.textBaseline = "top";
    for (let tick = 0; tick <= 5; tick += 1) {
      const fraction = tick / 5, x = margin.left + fraction * plotWidth;
      context.fillText((xMin + fraction * (xMax - xMin)).toPrecision(4), x, margin.top + plotHeight + 9);
    }

    const colors = ["#275fe6", "#d97706", "#168a62", "#7c3aed"];
    const maxRendered = Math.max(800, Math.floor(plotWidth * 2));
    const stride = Math.max(1, Math.floor(timeS.length / maxRendered));
    series.forEach(function (item, seriesIndex) {
      context.strokeStyle = item.color || colors[seriesIndex % colors.length];
      context.lineWidth = item.width || 1.35;
      context.setLineDash(item.dash || []);
      context.beginPath();
      let started = false;
      for (let index = 0; index < timeS.length; index += stride) {
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

    context.fillStyle = "#344054";
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.fillText("Elapsed time / s", margin.left + plotWidth / 2, height - 7);
    context.save();
    context.translate(15, margin.top + plotHeight / 2);
    context.rotate(-Math.PI / 2);
    context.fillText((options && options.yLabel) || "Signal", 0, 0);
    context.restore();
  }

  function drawTrace(canvas, timeS, values, options) {
    drawTraces(canvas, timeS, [{ values }], options);
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
      : [[68,1,84],[49,104,142],[53,183,121],[253,231,37]];
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
    context.fillStyle="#68738a";context.font="12px ui-sans-serif, system-ui, sans-serif";context.textAlign="center";
    context.fillText((histogram.minimum*scale).toPrecision(4)+suffix,margin.left,margin.top+ph+20);
    context.fillText((histogram.maximum*scale).toPrecision(4)+suffix,margin.left+pw,margin.top+ph+20);
    context.textAlign="left";context.fillText("n="+histogram.shown_count+"  mean="+(histogram.mean*scale).toPrecision(5)+suffix+"  median="+(histogram.median*scale).toPrecision(5)+suffix,margin.left,16);
  }

  api.plotting = Object.freeze({ clearCanvas, drawTrace, drawTraces, heatmapBounds, heatmapDisplayIndex, drawHeatmap, drawHistogram });
})(typeof window !== "undefined" ? window : globalThis);
