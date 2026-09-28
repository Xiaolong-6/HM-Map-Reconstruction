(function (root) {
  "use strict";

  const api = root.MapReconstructionWeb;
  const state = {
    source: null,
    rawBytes: null,
    originalFilename: null,
    signal: null,
    prepared: null,
    reconstruction: null,
    reconstructionParams: null,
    processed: null,
    histogram: null,
    colorLimits: null,
    flipY: false,
    activeStage: 1,
  };

  const byId = id => document.getElementById(id);

  function setStatus(id, message, kind) {
    const node = byId(id);
    node.textContent = message;
    node.className = "status" + (kind ? " " + kind : "");
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function rawDisplayUnit() {
    const values = state.source && state.signal ? state.source.signals[state.signal] : null;
    return api.displayUnits.displayUnitForSignal(state.signal || "", values);
  }

  function processingShapeFromControls() {
    return {
      transform: byId("map-transform").value,
      normalization: byId("map-normalization").value,
      value_scale: byId("value-scale").value,
    };
  }

  function normalizationReferenceScale(config) {
    const transform = config.transform || "raw";
    return ["raw", "absolute", "negate"].includes(transform) ? rawDisplayUnit().scale : 1;
  }

  function processingDisplayScale(config) {
    const current = config || processingShapeFromControls();
    if (
      current.transform === "custom" ||
      current.normalization !== "none" ||
      current.value_scale === "log10"
    ) return 1;
    return rawDisplayUnit().scale;
  }

  function currentDisplayUnit() {
    const raw = rawDisplayUnit();
    if (!state.processed) return raw;
    if (state.processed.is_dimensionless) {
      return api.displayUnits.displayUnit(state.processed.value_label, "", 1);
    }
    return api.displayUnits.displayUnit(
      state.processed.value_label,
      raw.unit,
      raw.scale,
    );
  }

  function withUnit(label, unit) {
    return unit ? label + " (" + unit + ")" : label;
  }

  function updateDisplayUnitLabels() {
    const raw = rawDisplayUnit();
    const shape = processingShapeFromControls();
    const referenceUnit = normalizationReferenceScale(shape) === raw.scale ? raw.unit : "";
    const displayUnit = processingDisplayScale(shape) === raw.scale ? raw.unit : "";

    byId("constant-baseline-label").textContent = withUnit("Constant baseline", raw.unit);
    byId("gate-min-label").textContent = withUnit("Gate min", raw.unit);
    byId("gate-max-label").textContent = withUnit("Gate max", raw.unit);
    byId("map-baseline-value-label").textContent = withUnit("Baseline value", raw.unit);
    byId("normalization-reference-label").textContent = withUnit("Reference", referenceUnit);
    byId("color-min-label").textContent = withUnit("Min", displayUnit);
    byId("color-max-label").textContent = withUnit("Max", displayUnit);
    byId("hist-min-label").textContent = withUnit("Min", displayUnit);
    byId("hist-max-label").textContent = withUnit("Max", displayUnit);
    byId("hist-width-label").textContent = withUnit("Bin width", displayUnit);
  }

  function activateStage(stage) {
    if (stage === 2 && !state.prepared) return;
    if (stage === 3 && !state.reconstruction) return;
    state.activeStage = stage;
    document.querySelectorAll(".stage").forEach(node => {
      node.classList.toggle("active", node.id === "stage-" + stage);
    });
    document.querySelectorAll(".stage-button").forEach(node => {
      node.classList.toggle("active", Number(node.dataset.stage) === stage);
    });
    if (stage === 1) renderTrace();
    if (stage === 2) renderReconstruction();
    if (stage === 3) renderAnalysis();
  }

  function updateStageAvailability() {
    const stage2 = document.querySelector('.stage-button[data-stage="2"]');
    const stage3 = document.querySelector('.stage-button[data-stage="3"]');
    stage2.disabled = !state.prepared;
    stage3.disabled = !state.reconstruction;
    byId("export-prepared-button").disabled = !state.prepared;
    byId("export-raw-button").disabled = !state.reconstruction;
    byId("export-processed-button").disabled =
      !state.processed || !Array.from(state.processed.values).some(Number.isFinite);
    byId("export-summary-button").disabled = !state.source;
    byId("export-report-button").disabled = !state.reconstruction;
    if (!state.prepared && state.activeStage > 1) activateStage(1);
    else if (!state.reconstruction && state.activeStage > 2) activateStage(2);
  }

  function renderSourceSummary() {
    const node = byId("source-summary");
    if (!state.source) {
      node.className = "summary empty";
      node.textContent = "No source loaded.";
      return;
    }
    const time = state.source.timeS;
    const duration = time.length > 1 ? time[time.length - 1] - time[0] : 0;
    node.className = "summary";
    node.innerHTML =
      "<dl>" +
      "<dt>File</dt><dd>" + escapeHtml(state.originalFilename || state.source.sourceName) + "</dd>" +
      "<dt>Schema</dt><dd>" + escapeHtml(state.source.schema) + "</dd>" +
      "<dt>Samples</dt><dd>" + state.source.sampleCount.toLocaleString() + "</dd>" +
      "<dt>Duration</dt><dd>" + duration.toPrecision(6) + " s</dd>" +
      "<dt>Signals</dt><dd>" + state.source.signalNames.length + "</dd>" +
      "</dl>";
  }

  function populateSignals(preferredSignal) {
    const select = byId("signal-select");
    select.replaceChildren();
    if (!state.source) {
      select.disabled = true;
      state.signal = null;
      return;
    }
    for (const name of state.source.signalNames) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    }
    state.signal = state.source.signalNames.includes(preferredSignal)
      ? preferredSignal
      : state.source.signalNames[0];
    select.value = state.signal;
    select.disabled = false;
  }

  function parseManualRegions() {
    const text = byId("manual-regions").value.trim();
    if (!text) return [];
    return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
      const parts = line.split(",").map(part => part.trim());
      if (parts.length !== 2) {
        throw new Error("Dark region line " + (index + 1) + " must be start,end.");
      }
      return { start_s: Number(parts[0]), end_s: Number(parts[1]) };
    });
  }

  function preparationConfig() {
    const scale = rawDisplayUnit().scale || 1;
    return {
      dark_correction_mode: byId("dark-mode").value,
      constant_baseline: Number(byId("constant-baseline").value) / scale,
      manual_dark_regions: parseManualRegions(),
      manual_region_fit: byId("manual-fit").value,
      rolling_quantile: Number(byId("rolling-quantile").value) / 100,
      rolling_window_s: Number(byId("rolling-window").value),
      rolling_trend: byId("rolling-trend").value,
      response_direction: byId("response-direction").value,
      value_gate_enabled: byId("gate-enabled").checked,
      value_gate_min: Number(byId("gate-min").value) / scale,
      value_gate_max: Number(byId("gate-max").value) / scale,
      apply_baseline: byId("apply-baseline").checked,
      invert_signal: byId("invert-signal").checked,
    };
  }

  function syncPreparationControls() {
    const mode = byId("dark-mode").value;
    document.querySelectorAll(".mode-block").forEach(node => {
      node.hidden = node.dataset.mode !== mode;
    });
    byId("apply-baseline").disabled = mode === "none";
    if (mode === "none") byId("apply-baseline").checked = false;
    byId("gate-fields").hidden = !byId("gate-enabled").checked;
  }

  function renderPreparedSummary() {
    const node = byId("prepared-summary");
    if (!state.prepared) {
      node.className = "summary empty";
      node.textContent = "Preparation preview unavailable.";
      return;
    }
    const meta = state.prepared.metadata;
    node.className = "summary";
    node.innerHTML =
      "<dl>" +
      "<dt>Mode</dt><dd>" + escapeHtml(meta.mode) + "</dd>" +
      "<dt>Subtract B(t)</dt><dd>" + (meta.apply_baseline ? "Yes" : "No") + "</dd>" +
      "<dt>Invert</dt><dd>" + (meta.invert_signal ? "Yes" : "No") + "</dd>" +
      (meta.candidate_count == null
        ? ""
        : "<dt>Baseline anchors/bins</dt><dd>" + meta.candidate_count + "</dd>") +
      (state.prepared.warnings.length
        ? "<dt>Warnings</dt><dd>" + state.prepared.warnings.length + "</dd>"
        : "") +
      "</dl>";
  }

  function renderTrace() {
    const canvas = byId("trace-canvas");
    const empty = byId("trace-empty");
    if (!state.source || !state.signal) {
      empty.classList.remove("hidden");
      api.plotting.clearCanvas(canvas);
      return;
    }
    empty.classList.add("hidden");
    const display = rawDisplayUnit();
    const series = [{ values: state.source.signals[state.signal], color: "#275fe6", scale: display.scale }];
    if (state.prepared && state.prepared.baseline) {
      series.push({ values: state.prepared.baseline, color: "#d97706", dash: [6, 4], scale: display.scale });
    }
    if (state.prepared) {
      series.push({ values: state.prepared.values, color: "#168a62", scale: display.scale });
    }
    api.plotting.drawTraces(canvas, state.source.timeS, series, { yLabel: display.axisLabel });
  }

  function invalidateReconstruction() {
    state.reconstruction = null;
    state.reconstructionParams = null;
    state.processed = null;
    state.histogram = null;
    state.colorLimits = null;
    byId("save-project-button").disabled = true;
    byId("reconstruction-summary").className = "summary empty";
    byId("reconstruction-summary").textContent = "No reconstruction yet.";
    byId("analysis-summary").className = "summary empty";
    byId("analysis-summary").textContent = "No processed map.";
    renderReconstruction();
    renderAnalysis();
    updateStageAvailability();
  }

  function recomputePreparation() {
    syncPreparationControls();
    invalidateReconstruction();
    if (!state.source || !state.signal) {
      state.prepared = null;
      renderPreparedSummary();
      renderTrace();
      updateStageAvailability();
      return;
    }
    try {
      state.prepared = api.preparation.prepareSignal(
        state.source,
        state.signal,
        preparationConfig(),
      );
      renderPreparedSummary();
      renderTrace();
      setStatus("status", "Preparation preview updated.", "ok");
    } catch (error) {
      state.prepared = null;
      renderPreparedSummary();
      renderTrace();
      setStatus("status", error.message || String(error), "error");
    }
    updateStageAvailability();
  }

  function syncReconstructionControls() {
    const phase = byId("reconstruction-method").value === "dual_offset_phase_window";
    byId("legacy-registration").hidden = phase;
    byId("phase-registration").hidden = !phase;
    const fixed = byId("window-mode").value === "fixed_duration";
    byId("window-fraction").disabled = fixed;
    byId("window-duration").disabled = !fixed;
  }

  function baseReconstructionParams() {
    return {
      rows: Number(byId("map-rows").value),
      cols: Number(byId("map-cols").value),
      row_a_s: Number(byId("row-a").value),
      row_b_s: Number(byId("row-b").value),
      rows_apart: Number(byId("rows-apart").value),
      row_offset: Number(byId("row-offset").value),
      point_a_s: Number(byId("point-a").value),
      point_b_s: Number(byId("point-b").value),
      points_apart: Number(byId("points-apart").value),
      scan_pattern: byId("scan-pattern").value,
      first_row_ltr: byId("first-row-direction").value === "ltr",
    };
  }

  function reconstruct() {
    if (!state.prepared || !state.signal) return;
    syncReconstructionControls();
    const data = { timeS: state.prepared.time_s, signals: {} };
    data.signals[state.signal] = state.prepared.values;

    try {
      const base = baseReconstructionParams();
      if (byId("reconstruction-method").value === "dual_offset") {
        state.reconstructionParams = api.reconstruction.normalizeDualOffsetParams({
          ...base,
          point_offset: Number(byId("point-offset").value),
          use_median: byId("legacy-aggregation").value === "median",
        });
        state.reconstruction = api.reconstruction.reconstructDualOffset(
          data,
          state.signal,
          state.reconstructionParams,
        );
      } else {
        state.reconstructionParams = api.reconstruction.normalizePhaseWindowParams({
          ...base,
          y_phase_fraction: Number(byId("y-phase").value),
          x_period_offset: Number(byId("x-period-offset").value),
          x_phase_fraction: Number(byId("x-phase").value),
          window_mode: byId("window-mode").value,
          window_fraction: Number(byId("window-fraction").value),
          window_duration_s: Number(byId("window-duration").value),
          aggregation: byId("phase-aggregation").value,
        });
        state.reconstruction = api.reconstruction.reconstructPhaseWindow(
          data,
          state.signal,
          state.reconstructionParams,
        );
      }

      const finite = Array.from(state.reconstruction.values).filter(Number.isFinite).length;
      byId("reconstruction-summary").className = "summary";
      byId("reconstruction-summary").innerHTML =
        "<dl>" +
        "<dt>Method</dt><dd>" + escapeHtml(state.reconstruction.method) + "</dd>" +
        "<dt>Shape</dt><dd>" + state.reconstruction.rows + " × " + state.reconstruction.cols + "</dd>" +
        "<dt>Finite pixels</dt><dd>" + finite + " / " + state.reconstruction.values.length + "</dd>" +
        "<dt>Warnings</dt><dd>" + state.reconstruction.warnings.length + "</dd>" +
        "</dl>";
      byId("save-project-button").disabled = !state.rawBytes;
      setStatus("reconstruction-status", "Reconstruction complete.", "ok");
      recomputeAnalysis();
    } catch (error) {
      state.reconstruction = null;
      state.reconstructionParams = null;
      state.processed = null;
      state.histogram = null;
      state.colorLimits = null;
      byId("save-project-button").disabled = true;
      byId("reconstruction-summary").className = "summary empty";
      byId("reconstruction-summary").textContent = "Reconstruction failed.";
      setStatus("reconstruction-status", error.message || String(error), "error");
    }

    renderReconstruction();
    renderAnalysis();
    updateStageAvailability();
  }

  function renderReconstruction() {
    const mapCanvas = byId("map-canvas");
    const countCanvas = byId("count-canvas");
    const mapEmpty = byId("map-empty");
    const countEmpty = byId("count-empty");
    if (!state.reconstruction) {
      mapEmpty.classList.remove("hidden");
      countEmpty.classList.remove("hidden");
      api.plotting.clearCanvas(mapCanvas);
      api.plotting.clearCanvas(countCanvas);
      return;
    }
    mapEmpty.classList.add("hidden");
    countEmpty.classList.add("hidden");
    const display = rawDisplayUnit();
    byId("raw-map-title").textContent = "Reconstructed values" + (display.unit ? " · " + display.unit : "");
    api.plotting.drawHeatmap(
      mapCanvas,
      state.reconstruction.values,
      state.reconstruction.rows,
      state.reconstruction.cols,
      { flipY: state.flipY, palette: byId("map-palette").value, inverted: byId("invert-palette").checked },
    );
    api.plotting.drawHeatmap(
      countCanvas,
      state.reconstruction.sample_counts,
      state.reconstruction.rows,
      state.reconstruction.cols,
      { counts: true, flipY: state.flipY },
    );
  }

  function syncAnalysisControls() {
    byId("map-baseline-value-field").hidden = byId("map-baseline").value !== "manual";
    byId("map-baseline-percentile-field").hidden = byId("map-baseline").value !== "percentile";
    byId("custom-expression-field").hidden = byId("map-transform").value !== "custom";
    byId("normalization-reference-field").hidden = byId("map-normalization").value !== "reference";
    byId("color-percentiles").hidden = byId("color-range-mode").value !== "percentile";
    byId("color-manual").hidden = byId("color-range-mode").value !== "manual";
    byId("hist-range-manual").hidden = byId("hist-range-mode").value !== "manual";
    byId("hist-count-field").hidden = byId("hist-bin-mode").value !== "count";
    byId("hist-width-field").hidden = byId("hist-bin-mode").value !== "width";
    updateDisplayUnitLabels();
  }

  function optionalNumber(id) {
    const text = byId(id).value.trim();
    return text === "" ? null : Number(text);
  }

  function analysisConfig() {
    const baselineMode = byId("map-baseline").value;
    const normalization = byId("map-normalization").value;
    const colorRangeMode = byId("color-range-mode").value;
    const shape = processingShapeFromControls();
    const rawScale = rawDisplayUnit().scale || 1;
    const referenceScale = normalizationReferenceScale(shape) || 1;
    const displayScale = processingDisplayScale(shape) || 1;
    const baselineValue = baselineMode === "manual" ? optionalNumber("map-baseline-value") : null;
    const referenceValue = normalization === "reference" ? optionalNumber("normalization-reference") : null;
    const colorMin = colorRangeMode === "manual" ? optionalNumber("color-min") : null;
    const colorMax = colorRangeMode === "manual" ? optionalNumber("color-max") : null;
    return {
      baseline_mode: baselineMode,
      baseline_value: baselineValue == null ? null : baselineValue / rawScale,
      baseline_percentile: Number(byId("map-baseline-percentile").value),
      transform: shape.transform,
      custom_expression: byId("custom-expression").value,
      normalization,
      normalization_reference: referenceValue == null ? null : referenceValue / referenceScale,
      value_scale: shape.value_scale,
      color_range_mode: colorRangeMode,
      color_min: colorMin == null ? null : colorMin / displayScale,
      color_max: colorMax == null ? null : colorMax / displayScale,
      percentile_low: Number(byId("color-low").value),
      percentile_high: Number(byId("color-high").value),
    };
  }

  function histogramConfig() {
    const displayScale = processingDisplayScale(processingShapeFromControls()) || 1;
    const rangeMode = byId("hist-range-mode").value;
    const minimum = rangeMode === "manual" ? optionalNumber("hist-min") : null;
    const maximum = rangeMode === "manual" ? optionalNumber("hist-max") : null;
    return {
      range_mode: rangeMode,
      minimum: minimum == null ? null : minimum / displayScale,
      maximum: maximum == null ? null : maximum / displayScale,
      bin_mode: byId("hist-bin-mode").value,
      bin_count: Number(byId("hist-count").value),
      bin_width: Number(byId("hist-width").value) / displayScale,
    };
  }

  function recomputeAnalysis() {
    syncAnalysisControls();
    if (!state.reconstruction) {
      state.processed = null;
      state.histogram = null;
      state.colorLimits = null;
      renderAnalysis();
      return;
    }
    try {
      const config = analysisConfig();
      state.processed = api.processing.processMap(
        state.reconstruction.values,
        config,
        state.signal,
      );
      state.colorLimits = api.processing.colorLimits(state.processed.values, config);
      state.histogram = api.processing.histogram(
        state.processed.values,
        histogramConfig(),
      );
      const finite = Array.from(state.processed.values).filter(Number.isFinite).length;
      byId("analysis-summary").className = "summary";
      byId("analysis-summary").innerHTML =
        "<dl>" +
        "<dt>Finite</dt><dd>" + finite + " / " + state.processed.values.length + "</dd>" +
        "<dt>Baseline</dt><dd>" +
        (state.processed.baseline_used == null
          ? "None"
          : api.displayUnits.formatDisplayValue(state.processed.baseline_used, rawDisplayUnit())) +
        "</dd>" +
        "<dt>Warnings</dt><dd>" + state.processed.warnings.length + "</dd>" +
        "<dt>Label</dt><dd>" + escapeHtml(state.processed.value_label) + "</dd>" +
        "</dl>";
      setStatus("analysis-status", "Processing updated.", "ok");
    } catch (error) {
      state.processed = null;
      state.histogram = null;
      state.colorLimits = null;
      byId("analysis-summary").className = "summary empty";
      byId("analysis-summary").textContent = "Processing failed.";
      setStatus("analysis-status", error.message || String(error), "error");
    }
    renderAnalysis();
  }

  function renderAnalysis() {
    const mapCanvas = byId("processed-map-canvas");
    const histogramCanvas = byId("histogram-canvas");
    const mapEmpty = byId("processed-map-empty");
    const histogramEmpty = byId("histogram-empty");

    if (!state.processed || !state.reconstruction) {
      mapEmpty.classList.remove("hidden");
      histogramEmpty.classList.remove("hidden");
      api.plotting.clearCanvas(mapCanvas);
      api.plotting.clearCanvas(histogramCanvas);
      return;
    }

    const display = currentDisplayUnit();
    byId("processed-map-title").textContent = "Processed map" + (display.unit ? " · " + display.unit : "");
    byId("histogram-title").textContent = "Value distribution" + (display.unit ? " · " + display.unit : "");

    if (Array.from(state.processed.values).some(Number.isFinite)) {
      mapEmpty.classList.add("hidden");
      api.plotting.drawHeatmap(
        mapCanvas,
        state.processed.values,
        state.reconstruction.rows,
        state.reconstruction.cols,
        {
          levels: state.colorLimits,
          flipY: state.flipY,
          palette: byId("map-palette").value,
          inverted: byId("invert-palette").checked,
        },
      );
    } else {
      mapEmpty.classList.remove("hidden");
      api.plotting.clearCanvas(mapCanvas);
    }

    if (state.histogram) {
      histogramEmpty.classList.add("hidden");
      api.plotting.drawHistogram(histogramCanvas, state.histogram, { scale: display.scale, unit: display.unit });
    } else {
      histogramEmpty.classList.remove("hidden");
      api.plotting.clearCanvas(histogramCanvas);
    }
  }

  function setControl(id, value) {
    const node = byId(id);
    if (node.type === "checkbox") node.checked = Boolean(value);
    else node.value = value == null ? "" : String(value);
  }

  function restoreProjectControls(project) {
    const saved = project.state;
    const params = saved.reconstructionParams;
    const prep = saved.preparation;
    const proc = saved.processing;

    state.rawBytes = project.rawBytes;
    state.originalFilename = saved.source.original_filename;
    state.source = project.csv;
    state.flipY = saved.flip_y;
    populateSignals(saved.source.signal);

    const rawUnit = rawDisplayUnit();
    setControl("dark-mode", prep.dark_correction_mode);
    setControl("constant-baseline", prep.constant_baseline * rawUnit.scale);
    setControl(
      "manual-regions",
      prep.manual_dark_regions.map(region => region.start_s + "," + region.end_s).join("\n"),
    );
    setControl("manual-fit", prep.manual_region_fit);
    setControl("rolling-quantile", prep.rolling_quantile * 100);
    setControl("rolling-window", prep.rolling_window_s);
    setControl("rolling-trend", prep.rolling_trend);
    setControl("response-direction", prep.response_direction);
    setControl("gate-enabled", prep.value_gate_enabled);
    if (prep.value_gate_enabled) {
      setControl("gate-min", prep.value_gate_min * rawUnit.scale);
      setControl("gate-max", prep.value_gate_max * rawUnit.scale);
    }
    setControl("apply-baseline", prep.apply_baseline);
    setControl("invert-signal", prep.invert_signal);

    setControl("map-rows", params.rows);
    setControl("map-cols", params.cols);
    setControl("scan-pattern", params.scan_pattern);
    setControl("first-row-direction", params.first_row_ltr ? "ltr" : "rtl");
    setControl("reconstruction-method", saved.method);
    setControl("row-a", params.row_a_s);
    setControl("row-b", params.row_b_s);
    setControl("rows-apart", params.rows_apart);
    setControl("row-offset", params.row_offset);
    setControl("point-a", params.point_a_s);
    setControl("point-b", params.point_b_s);
    setControl("points-apart", params.points_apart);

    if (saved.method === "dual_offset") {
      setControl("point-offset", params.point_offset);
      setControl("legacy-aggregation", params.use_median ? "median" : "mean");
    } else {
      setControl("y-phase", params.y_phase_fraction);
      setControl("x-period-offset", params.x_period_offset);
      setControl("x-phase", params.x_phase_fraction);
      setControl("window-mode", params.window_mode);
      setControl("window-fraction", params.window_fraction);
      if (params.window_duration_s != null) {
        setControl("window-duration", params.window_duration_s);
      }
      setControl("phase-aggregation", params.aggregation);
    }

    setControl("map-baseline", proc.baseline_mode);
    setControl("map-baseline-percentile", proc.baseline_percentile);
    setControl("map-transform", proc.transform);
    setControl("custom-expression", proc.custom_expression);
    setControl("map-normalization", proc.normalization);
    setControl("value-scale", proc.value_scale);
    setControl("flip-y", state.flipY);
    setControl("color-range-mode", proc.color_range_mode);
    setControl("color-low", proc.percentile_low);
    setControl("color-high", proc.percentile_high);
    const referenceScale = normalizationReferenceScale(proc) || 1;
    const displayScale = processingDisplayScale(proc) || 1;
    setControl("map-baseline-value", (proc.baseline_value == null ? 0 : proc.baseline_value) * rawUnit.scale);
    setControl("normalization-reference", (proc.normalization_reference == null ? 0 : proc.normalization_reference) * referenceScale);
    setControl("color-min", (proc.color_min == null ? 0 : proc.color_min) * displayScale);
    setControl("color-max", (proc.color_max == null ? 0 : proc.color_max) * displayScale);

    syncPreparationControls();
    syncReconstructionControls();
    syncAnalysisControls();
    updateDisplayUnitLabels();
    renderSourceSummary();
    byId("metadata-view").textContent = JSON.stringify(state.source.metadata, null, 2);

    recomputePreparation();
    if (state.prepared && params.rows > 0 && params.cols > 0) {
      reconstruct();
    } else if (state.prepared) {
      state.reconstructionParams = params;
      byId("save-project-button").disabled = !state.rawBytes;
      setStatus(
        "reconstruction-status",
        "Project opened with geometry unset. Set rows and columns, then reconstruct.",
      );
      updateStageAvailability();
    }
    activateStage(2);
  }

  async function loadFile(file) {
    if (!file) return;
    setStatus("status", "Reading " + file.name + "…");
    try {
      state.rawBytes = new Uint8Array(await file.arrayBuffer());
      state.originalFilename = file.name;
      const text = new TextDecoder("utf-8").decode(state.rawBytes);
      state.source = api.csv.parseHappyMeasureCsv(text, file.name);
      populateSignals();
      renderSourceSummary();
      byId("metadata-view").textContent = JSON.stringify(state.source.metadata, null, 2);
      recomputePreparation();
      setStatus("status", "Loaded " + state.source.sampleCount.toLocaleString() + " samples.", "ok");
    } catch (error) {
      state.source = null;
      state.rawBytes = null;
      state.originalFilename = null;
      state.signal = null;
      state.prepared = null;
      populateSignals();
      invalidateReconstruction();
      renderSourceSummary();
      renderPreparedSummary();
      byId("metadata-view").textContent = "{}";
      renderTrace();
      setStatus("status", error.message || String(error), "error");
    }
  }

  async function loadProjectFile(file) {
    if (!file) return;
    setStatus("status", "Opening " + file.name + "…");
    try {
      const project = await api.project.loadProjectBytes(
        new Uint8Array(await file.arrayBuffer()),
      );
      restoreProjectControls(project);
      setStatus("status", "Project opened and SHA-256 verified.", "ok");
    } catch (error) {
      setStatus("status", error.message || String(error), "error");
    }
  }

  function sourceStem() {
    return String(state.originalFilename || "map").replace(/\.[^.]+$/, "");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadText(text, filename, type) {
    downloadBlob(new Blob([text], { type: type || "text/plain;charset=utf-8" }), filename);
  }

  function exportPrepared() {
    if (!state.prepared || !state.source || !state.signal) return;
    try {
      const text = api.exporting.preparedCsv(
        state.prepared,
        state.source.signals[state.signal],
      );
      downloadText(text, sourceStem() + "_prepared.csv", "text/csv;charset=utf-8");
      setStatus("status", "Prepared trace exported.", "ok");
    } catch (error) {
      setStatus("status", error.message || String(error), "error");
    }
  }

  function exportRawMap() {
    if (!state.reconstruction) return;
    try {
      const text = api.exporting.matrixCsv(
        state.reconstruction.values,
        state.reconstruction.rows,
        state.reconstruction.cols,
      );
      downloadText(text, sourceStem() + "_map_raw.csv", "text/csv;charset=utf-8");
      setStatus("reconstruction-status", "Raw reconstructed map exported.", "ok");
    } catch (error) {
      setStatus("reconstruction-status", error.message || String(error), "error");
    }
  }

  function exportProcessedMap() {
    if (!state.processed || !state.reconstruction || !state.prepared) return;
    try {
      const csv = api.exporting.matrixCsv(
        state.processed.values,
        state.reconstruction.rows,
        state.reconstruction.cols,
      );
      const display = currentDisplayUnit();
      const metadata = api.exporting.processedMetadata({
        signal: state.signal,
        scientificUnit: api.displayUnits.scientificUnitForSignal(state.signal),
        rawDisplayUnit: rawDisplayUnit(),
        preparation: state.prepared.config,
        preparedMetadata: state.prepared.metadata,
        processed: state.processed,
        processing: analysisConfig(),
        displayColorLimits: state.colorLimits
          ? [state.colorLimits.minimum * display.scale, state.colorLimits.maximum * display.scale]
          : null,
      });
      const stem = sourceStem() + "_map_processed";
      downloadText(csv, stem + ".csv", "text/csv;charset=utf-8");
      downloadText(
        JSON.stringify(metadata, null, 2) + "\n",
        stem + ".json",
        "application/json;charset=utf-8",
      );
      setStatus("analysis-status", "Processed map and metadata exported.", "ok");
    } catch (error) {
      setStatus("analysis-status", error.message || String(error), "error");
    }
  }

  function summaryParams() {
    const base = baseReconstructionParams();
    if (byId("reconstruction-method").value === "dual_offset") {
      return {
        ...base,
        point_offset: Number(byId("point-offset").value),
        use_median: byId("legacy-aggregation").value === "median",
      };
    }
    return {
      ...base,
      y_phase_fraction: Number(byId("y-phase").value),
      x_period_offset: Number(byId("x-period-offset").value),
      x_phase_fraction: Number(byId("x-phase").value),
      window_mode: byId("window-mode").value,
      window_fraction: Number(byId("window-fraction").value),
      window_duration_s: Number(byId("window-duration").value),
      aggregation: byId("phase-aggregation").value,
    };
  }

  function currentParameterSummary() {
    return api.exporting.parameterSummary({
      originalFilename: state.originalFilename,
      signal: state.signal,
      source: state.source,
      preparation: state.prepared ? state.prepared.config : preparationConfig(),
      method: byId("reconstruction-method").value,
      params: state.reconstructionParams || summaryParams(),
      processing: analysisConfig(),
      flipY: state.flipY,
      result: state.reconstruction,
      processed: state.processed,
      scientificUnit: api.displayUnits.scientificUnitForSignal(state.signal),
    });
  }

  function exportParameterSummary() {
    if (!state.source) return;
    try {
      downloadText(
        currentParameterSummary(),
        sourceStem() + "_map_parameters.txt",
        "text/plain;charset=utf-8",
      );
      setStatus("analysis-status", "Parameter summary exported.", "ok");
    } catch (error) {
      setStatus("analysis-status", error.message || String(error), "error");
    }
  }

  function captureRawTraceDataUri() {
    if (!state.source || !state.signal) throw new Error("No raw source trace is available.");
    const canvas = document.createElement("canvas");
    canvas.style.position = "fixed";
    canvas.style.left = "-10000px";
    canvas.style.top = "0";
    canvas.style.width = "900px";
    canvas.style.height = "420px";
    document.body.appendChild(canvas);
    try {
      const display = rawDisplayUnit();
      api.plotting.drawTraces(
        canvas,
        state.source.timeS,
        [{ values: state.source.signals[state.signal], color: "#275fe6", scale: display.scale }],
        { yLabel: display.axisLabel },
      );
      return canvas.toDataURL("image/png");
    } finally {
      canvas.remove();
    }
  }

  function exportHtmlReport() {
    if (!state.reconstruction) return;
    try {
      const processedFinite =
        state.processed && Array.from(state.processed.values).some(Number.isFinite);
      const mapCanvas = processedFinite ? byId("processed-map-canvas") : byId("map-canvas");
      const report = api.exporting.htmlReport({
        summary: currentParameterSummary(),
        figures: [
          {
            title: processedFinite ? "Processed map" : "Raw reconstructed map",
            alt: "Current reconstructed map",
            dataUri: mapCanvas.toDataURL("image/png"),
          },
          {
            title: "Samples per pixel",
            alt: "Current sample-count map",
            dataUri: byId("count-canvas").toDataURL("image/png"),
          },
          {
            title: "Raw time trace",
            alt: "Raw source time trace",
            dataUri: captureRawTraceDataUri(),
          },
        ],
      });
      downloadText(
        report,
        sourceStem() + "_map_report.html",
        "text/html;charset=utf-8",
      );
      setStatus("analysis-status", "Self-contained HTML report exported.", "ok");
    } catch (error) {
      setStatus("analysis-status", error.message || String(error), "error");
    }
  }

  async function saveProject() {
    if (
      !state.rawBytes ||
      !state.originalFilename ||
      !state.source ||
      !state.signal ||
      !state.reconstructionParams
    ) {
      return;
    }
    try {
      const result = await api.project.createProjectBytes({
        rawBytes: state.rawBytes,
        originalFilename: state.originalFilename,
        signal: state.signal,
        method: byId("reconstruction-method").value,
        reconstructionParams: state.reconstructionParams,
        preparation: preparationConfig(),
        processing: analysisConfig(),
        flipY: state.flipY,
        applicationVersion: "web-prototype",
      });
      downloadBlob(
        new Blob([result.bytes], { type: "application/zip" }),
        sourceStem() + ".hmmap",
      );
      setStatus("reconstruction-status", "Saved " + result.metadata.schema + ".", "ok");
    } catch (error) {
      setStatus("reconstruction-status", error.message || String(error), "error");
    }
  }

  function init() {
    document.querySelectorAll(".stage-button").forEach(button => {
      button.addEventListener("click", () => activateStage(Number(button.dataset.stage)));
    });

    byId("csv-file").addEventListener("change", event => {
      loadFile(event.target.files && event.target.files[0]);
    });
    byId("project-file").addEventListener("change", event => {
      loadProjectFile(event.target.files && event.target.files[0]);
    });
    byId("signal-select").addEventListener("change", event => {
      const previous = rawDisplayUnit();
      const constantSi = Number(byId("constant-baseline").value) / (previous.scale || 1);
      const gateMinSi = Number(byId("gate-min").value) / (previous.scale || 1);
      const gateMaxSi = Number(byId("gate-max").value) / (previous.scale || 1);
      state.signal = event.target.value;
      const next = rawDisplayUnit();
      setControl("constant-baseline", constantSi * next.scale);
      setControl("gate-min", gateMinSi * next.scale);
      setControl("gate-max", gateMaxSi * next.scale);
      updateDisplayUnitLabels();
      recomputePreparation();
    });

    [
      "dark-mode",
      "constant-baseline",
      "manual-regions",
      "manual-fit",
      "rolling-window",
      "rolling-quantile",
      "rolling-trend",
      "response-direction",
      "apply-baseline",
      "invert-signal",
      "gate-enabled",
      "gate-min",
      "gate-max",
    ].forEach(id => {
      byId(id).addEventListener(
        id === "manual-regions" ? "input" : "change",
        recomputePreparation,
      );
    });

    [
      "reconstruction-method",
      "window-mode",
    ].forEach(id => {
      byId(id).addEventListener("change", syncReconstructionControls);
    });

    [
      "map-baseline",
      "map-baseline-value",
      "map-baseline-percentile",
      "map-transform",
      "custom-expression",
      "map-normalization",
      "normalization-reference",
      "value-scale",
      "color-range-mode",
      "color-low",
      "color-high",
      "color-min",
      "color-max",
      "hist-range-mode",
      "hist-min",
      "hist-max",
      "hist-bin-mode",
      "hist-count",
      "hist-width",
    ].forEach(id => {
      byId(id).addEventListener(
        id === "custom-expression" ? "input" : "change",
        recomputeAnalysis,
      );
    });

    byId("flip-y").addEventListener("change", event => {
      state.flipY = event.target.checked;
      renderReconstruction();
      renderAnalysis();
    });

    byId("map-palette").addEventListener("change", () => {
      renderReconstruction();
      renderAnalysis();
    });
    byId("invert-palette").addEventListener("change", () => {
      renderReconstruction();
      renderAnalysis();
    });

    byId("reconstruct-button").addEventListener("click", reconstruct);
    byId("save-project-button").addEventListener("click", saveProject);
    byId("export-prepared-button").addEventListener("click", exportPrepared);
    byId("export-raw-button").addEventListener("click", exportRawMap);
    byId("export-processed-button").addEventListener("click", exportProcessedMap);
    byId("export-summary-button").addEventListener("click", exportParameterSummary);
    byId("export-report-button").addEventListener("click", exportHtmlReport);

    root.addEventListener("resize", () => {
      if (state.activeStage === 1) renderTrace();
      else if (state.activeStage === 2) renderReconstruction();
      else if (state.activeStage === 3) renderAnalysis();
    });

    syncPreparationControls();
    syncReconstructionControls();
    syncAnalysisControls();
    renderSourceSummary();
    renderPreparedSummary();
    renderTrace();
    renderReconstruction();
    renderAnalysis();
    updateStageAvailability();
    document.documentElement.dataset.appReady = "true";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  api.appState = state;
})(window);
