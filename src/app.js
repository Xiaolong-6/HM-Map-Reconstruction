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
    pendingImport: null,
    activeStage: 1,
  };

  const byId = id => document.getElementById(id);
  let prepPlotController = null;
  let registrationPlotController = null;
  let reconstructionTimer = null;
  let reconstructionQueued = false;

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
    if (stage === 2 && !state.source) return;
    if (stage === 3 && !state.prepared) return;
    if (stage === 4 && !state.reconstruction) return;
    state.activeStage = stage;
    document.querySelectorAll(".stage").forEach(node => {
      node.classList.toggle("active", node.id === "stage-" + stage);
    });
    document.querySelectorAll(".stage-button").forEach(node => {
      node.classList.toggle("active", Number(node.dataset.stage) === stage);
    });
    if (stage === 2) renderTrace();
    if (stage === 3) {
      renderRegistrationTrace();
      renderReconstruction();
      if (!state.reconstruction) scheduleReconstruction(0);
    }
    if (stage === 4) renderAnalysis();
  }

  function updateStageAvailability() {
    const stage2 = document.querySelector('.stage-button[data-stage="2"]');
    const stage3 = document.querySelector('.stage-button[data-stage="3"]');
    const stage4 = document.querySelector('.stage-button[data-stage="4"]');
    stage2.disabled = !state.source;
    stage3.disabled = !state.prepared;
    stage4.disabled = !state.reconstruction;
    byId("continue-preparation-button").disabled = !state.source;
    byId("continue-reconstruction-button").disabled = !state.prepared;
    byId("export-prepared-button").disabled = !state.prepared;
    byId("export-raw-button").disabled = !state.reconstruction;
    byId("export-processed-button").disabled =
      !state.processed || !Array.from(state.processed.values).some(Number.isFinite);
    byId("export-summary-button").disabled = !state.source;
    byId("export-report-button").disabled = !state.reconstruction;
    if (!state.source && state.activeStage > 1) activateStage(1);
    else if (!state.prepared && state.activeStage > 2) activateStage(2);
    else if (!state.reconstruction && state.activeStage > 3) activateStage(3);
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
      "<dt>Format</dt><dd>" + escapeHtml(state.source.metadata && state.source.metadata.import_format ? "Generic table" : state.source.schema) + "</dd>" +
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
      : state.source.signalNames.includes("Current_A")
        ? "Current_A"
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

  function preparationRegions() {
    try {
      return parseManualRegions().map(region => ({
        start_s: region.start_s,
        end_s: region.end_s,
        color: "rgba(245,158,11,.16)",
      }));
    } catch (_) {
      return [];
    }
  }

  function syncAxisFields(prefix, view) {
    if (!view) return;
    for (const [suffix, key] of [["x-min","xMin"],["x-max","xMax"],["y-min","yMin"],["y-max","yMax"]]) {
      const node = byId(prefix + "-" + suffix);
      if (node && document.activeElement !== node) node.value = Number(view[key]).toPrecision(8);
    }
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
    const series = [
      { label: "Raw", values: state.source.signals[state.signal], color: "#275fe6", scale: display.scale },
    ];
    if (state.prepared && state.prepared.baseline) {
      series.push({ label: "Baseline B(t)", values: state.prepared.baseline, color: "#d97706", dash: [6, 4], scale: display.scale });
    }
    if (state.prepared) {
      series.push({ label: "Prepared", values: state.prepared.values, color: "#168a62", scale: display.scale });
    }
    if (prepPlotController) {
      prepPlotController.setData(state.source.timeS, series, {
        yLabel: display.axisLabel,
        regions: byId("dark-mode").value === "manual_regions" ? preparationRegions() : [],
      });
      syncAxisFields("prep", prepPlotController.resolvedView());
    } else {
      api.plotting.drawTraces(canvas, state.source.timeS, series, { yLabel: display.axisLabel });
    }
  }

  function registrationMarkers() {
    return [
      { id: "row-a", label: "YA", value: Number(byId("row-a").value), color: "#2563eb" },
      { id: "row-b", label: "YB", value: Number(byId("row-b").value), color: "#7c3aed" },
      { id: "point-a", label: "XA", value: Number(byId("point-a").value), color: "#059669" },
      { id: "point-b", label: "XB", value: Number(byId("point-b").value), color: "#dc2626" },
    ];
  }

  function renderRegistrationTrace() {
    const canvas = byId("registration-trace-canvas");
    const empty = byId("registration-trace-empty");
    if (!canvas) return;
    if (!state.prepared || !state.signal) {
      empty.classList.remove("hidden");
      api.plotting.clearCanvas(canvas);
      return;
    }
    empty.classList.add("hidden");
    const display = rawDisplayUnit();
    const series = [{ label: "Prepared", values: state.prepared.values, color: "#168a62", scale: display.scale }];
    if (registrationPlotController) {
      registrationPlotController.setData(state.prepared.time_s, series, {
        yLabel: display.axisLabel,
        markers: registrationMarkers(),
      });
      syncAxisFields("registration", registrationPlotController.resolvedView());
    } else {
      api.plotting.drawTraces(canvas, state.prepared.time_s, series, {
        yLabel: display.axisLabel,
        markers: registrationMarkers(),
      });
    }
  }

  function applyAxisFields(prefix, controller) {
    if (!controller) return;
    try {
      controller.setView({
        xMin: Number(byId(prefix + "-x-min").value),
        xMax: Number(byId(prefix + "-x-max").value),
        yMin: Number(byId(prefix + "-y-min").value),
        yMax: Number(byId(prefix + "-y-max").value),
      });
    } catch (error) {
      const statusId = prefix === "prep" ? "status" : "reconstruction-status";
      setStatus(statusId, error.message || String(error), "error");
    }
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
      renderRegistrationTrace();
      if (state.activeStage >= 3) scheduleReconstruction(0);
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

  function scheduleReconstruction(delayMs) {
    if (!state.prepared || !state.signal) return;
    if (reconstructionTimer != null) clearTimeout(reconstructionTimer);
    reconstructionQueued = true;
    setStatus("reconstruction-status", "Updating reconstruction…");
    const delay = Math.max(0, Number(delayMs == null ? 70 : delayMs));
    reconstructionTimer = setTimeout(() => {
      reconstructionTimer = null;
      if (!reconstructionQueued) return;
      reconstructionQueued = false;
      reconstruct();
    }, delay);
  }

  function reconstruct() {
    if (!state.prepared || !state.signal) return;
    syncReconstructionControls();
    const data = { timeS: state.prepared.time_s, signals: {} };
    data.signals[state.signal] = state.prepared.values;

    try {
      state.reconstructionParams = api.reconstruction.normalizePhaseWindowParams({
        ...baseReconstructionParams(),
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
      byId("save-project-button").disabled = !state.rawBytes;
      const counts = Array.from(state.reconstruction.sample_counts);
      const finitePixels = Array.from(state.reconstruction.values).filter(Number.isFinite).length;
      const summary = byId("reconstruction-summary");
      summary.className = "summary";
      summary.innerHTML =
        "<dl>" +
        "<dt>Map</dt><dd>" + state.reconstruction.rows + " × " + state.reconstruction.cols + "</dd>" +
        "<dt>Finite</dt><dd>" + finitePixels + " / " + state.reconstruction.values.length + "</dd>" +
        "<dt>Samples / px</dt><dd>" + Math.min(...counts) + " – " + Math.max(...counts) + "</dd>" +
        "</dl>";
      setStatus("reconstruction-status", "Reconstruction updated automatically.", "ok");
    } catch (error) {
      state.reconstruction = null;
      state.reconstructionParams = null;
      const summary = byId("reconstruction-summary");
      summary.className = "summary empty";
      summary.textContent = "Reconstruction unavailable.";
      setStatus("reconstruction-status", error.message || String(error), "error");
    }
    renderReconstruction();
    recomputeAnalysis();
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
    let params = saved.reconstructionParams;
    setControl("y-phase", params.y_phase_fraction);
    setControl("x-period-offset", params.x_period_offset);
    setControl("x-phase", params.x_phase_fraction);
    setControl("window-mode", params.window_mode);
    setControl("window-fraction", params.window_fraction);
    if (params.window_duration_s != null) setControl("window-duration", params.window_duration_s);
    setControl("phase-aggregation", params.aggregation);

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
    activateStage(3);
  }

  function renderImportPreview(model) {
    const node = byId("import-preview");
    if (!model) {
      node.className = "data-preview empty";
      node.textContent = "No data loaded.";
      return;
    }
    const names = model.names || [];
    const rows = model.preview || [];
    node.className = "data-preview";
    let html = "<table><thead><tr>" +
      names.map(name => "<th>" + escapeHtml(name) + "</th>").join("") +
      "</tr></thead><tbody>";
    html += rows.map(row => "<tr>" +
      row.map(cell => "<td>" + escapeHtml(cell) + "</td>").join("") +
      "</tr>").join("");
    html += "</tbody></table>";
    node.innerHTML = html;
  }

  function populateImportMapping(model) {
    const timeSelect = byId("import-time-column");
    const signalSelect = byId("import-signal-columns");
    timeSelect.replaceChildren();
    signalSelect.replaceChildren();
    model.columns.forEach(column => {
      const timeOption = document.createElement("option");
      timeOption.value = String(column.index);
      timeOption.textContent = column.name + (column.numeric ? "" : " · non-numeric");
      timeOption.disabled = !column.numeric;
      timeSelect.appendChild(timeOption);

      const signalOption = document.createElement("option");
      signalOption.value = String(column.index);
      signalOption.textContent = column.name + (column.numeric ? "" : " · non-numeric");
      signalOption.disabled = !column.numeric;
      signalSelect.appendChild(signalOption);
    });
    const likelyTime = model.columns.find(column => column.numeric && /(^|_)(time|elapsed)(_|$)/i.test(column.name))
      || model.columns.find(column => column.numeric);
    if (likelyTime) timeSelect.value = String(likelyTime.index);
    const likelySignal = model.columns.find(column =>
      column.numeric && (!likelyTime || column.index !== likelyTime.index)
    );
    if (likelySignal) {
      Array.from(signalSelect.options).forEach(option => {
        option.selected = Number(option.value) === likelySignal.index;
      });
    }
    byId("import-data-button").disabled = !likelySignal;
  }

  function commitLoadedSource(source, rawBytes, filename, preferredSignal) {
    state.source = source;
    state.rawBytes = rawBytes;
    state.originalFilename = filename;
    state.pendingImport = null;
    populateSignals(preferredSignal);
    renderSourceSummary();
    byId("metadata-view").textContent = JSON.stringify(state.source.metadata, null, 2);
    recomputePreparation();
    updateStageAvailability();
  }

  async function loadFile(file) {
    if (!file) return;
    setStatus("import-status", "Reading " + file.name + "…");
    try {
      const originalBytes = new Uint8Array(await file.arrayBuffer());
      const text = new TextDecoder("utf-8").decode(originalBytes);
      if (api.importing.looksLikeHappyMeasure(text)) {
        const source = api.csv.parseHappyMeasureCsv(text, file.name);
        commitLoadedSource(source, originalBytes, file.name);
        byId("generic-import-controls").hidden = true;
        renderImportPreview({
          names: ["Elapsed_s", ...source.signalNames],
          preview: Array.from({ length: Math.min(12, source.sampleCount) }, (_, index) => [
            source.timeS[index],
            ...source.signalNames.map(name => source.signals[name][index]),
          ]),
        });
        setStatus("import-status", "HappyMeasure single-v2 detected · " + source.sampleCount.toLocaleString() + " samples.", "ok");
      } else {
        const delimiter = byId("import-delimiter").value;
        const model = api.importing.inspectDelimited(text, file.name, delimiter);
        state.pendingImport = { model, originalBytes, filename: file.name };
        state.source = null;
        state.rawBytes = null;
        state.originalFilename = file.name;
        state.prepared = null;
        invalidateReconstruction();
        byId("generic-import-controls").hidden = false;
        populateImportMapping(model);
        renderImportPreview(model);
        renderSourceSummary();
        setStatus("import-status", "Generic table detected · map columns, then use selected data.", "ok");
      }
    } catch (error) {
      state.pendingImport = null;
      state.source = null;
      state.rawBytes = null;
      state.originalFilename = null;
      state.prepared = null;
      populateSignals();
      invalidateReconstruction();
      renderSourceSummary();
      renderImportPreview(null);
      byId("metadata-view").textContent = "{}";
      setStatus("import-status", error.message || String(error), "error");
    }
    updateStageAvailability();
  }

  function commitGenericImport() {
    if (!state.pendingImport) return;
    try {
      const signalColumns = Array.from(byId("import-signal-columns").selectedOptions).map(option => Number(option.value));
      const canonical = api.importing.canonicalizeDelimited(state.pendingImport.model, {
        timeMode: byId("import-time-mode").value,
        timeColumn: Number(byId("import-time-column").value),
        timeScale: Number(byId("import-time-scale").value),
        sampleIntervalS: Number(byId("import-sample-interval").value),
        signalColumns,
      });
      const canonicalBytes = new TextEncoder().encode(canonical.canonicalText);
      const source = api.csv.parseHappyMeasureCsv(canonical.canonicalText, state.pendingImport.filename);
      commitLoadedSource(source, canonicalBytes, state.pendingImport.filename);
      setStatus("import-status", "Imported " + source.sampleCount.toLocaleString() + " samples into the canonical scientific source.", "ok");
    } catch (error) {
      setStatus("import-status", error.message || String(error), "error");
    }
  }

  async function loadProjectFile(file) {
    if (!file) return;
    setStatus("import-status", "Opening " + file.name + "…");
    try {
      const project = await api.project.loadProjectBytes(
        new Uint8Array(await file.arrayBuffer()),
      );
      restoreProjectControls(project);
      setStatus("import-status", "Project opened and SHA-256 verified.", "ok");
    } catch (error) {
      setStatus("import-status", error.message || String(error), "error");
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
    return {
      ...baseReconstructionParams(),
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
      method: "dual_offset_phase_window",
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
        method: "dual_offset_phase_window",
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
    prepPlotController = new api.interactivePlot.TracePlotController(byId("trace-canvas"), {
      onRegionCreate(start, end) {
        const textarea = byId("manual-regions");
        const line = start.toPrecision(8) + "," + end.toPrecision(8);
        textarea.value = textarea.value.trim() ? textarea.value.trim() + "\n" + line : line;
        setControl("dark-mode", "manual_regions");
        syncPreparationControls();
        recomputePreparation();
        setStatus("status", "Dark region added from plot.", "ok");
      },
      onViewChange(view) { syncAxisFields("prep", view); },
    });
    registrationPlotController = new api.interactivePlot.TracePlotController(byId("registration-trace-canvas"), {
      onMarkerMove(id, value, finished) {
        setControl(id, Number(value).toPrecision(9));
        renderRegistrationTrace();
        scheduleReconstruction(finished ? 0 : 55);
        if (finished) {
          setStatus(
            "reconstruction-status",
            id.toUpperCase().replace("ROW-","Y").replace("POINT-","X") + " marker updated · recalculating…",
          );
        }
      },
      onViewChange(view) { syncAxisFields("registration", view); },
    });

    document.querySelectorAll(".stage-button").forEach(button => {
      button.addEventListener("click", () => activateStage(Number(button.dataset.stage)));
    });

    byId("csv-file").addEventListener("change", event => {
      loadFile(event.target.files && event.target.files[0]);
    });
    byId("project-file").addEventListener("change", event => {
      loadProjectFile(event.target.files && event.target.files[0]);
    });
    byId("continue-preparation-button").addEventListener("click", () => activateStage(2));
    byId("continue-reconstruction-button").addEventListener("click", () => activateStage(3));
    byId("back-import-button").addEventListener("click", () => activateStage(1));
    byId("import-data-button").addEventListener("click", commitGenericImport);
    byId("import-time-mode").addEventListener("change", () => {
      const indexMode = byId("import-time-mode").value === "index";
      byId("import-time-column-fields").hidden = indexMode;
      byId("import-sample-interval-field").hidden = !indexMode;
    });
    byId("import-delimiter").addEventListener("change", () => {
      if (state.pendingImport) {
        const file = byId("csv-file").files && byId("csv-file").files[0];
        if (file) loadFile(file);
      }
    });

    byId("prep-autoscale").addEventListener("click", () => prepPlotController.autoscale());
    byId("prep-reset-x").addEventListener("click", () => prepPlotController.fullX());
    byId("prep-apply-axes").addEventListener("click", () => applyAxisFields("prep", prepPlotController));
    byId("registration-autoscale").addEventListener("click", () => registrationPlotController.autoscale());
    byId("registration-reset-x").addEventListener("click", () => registrationPlotController.fullX());
    byId("registration-apply-axes").addEventListener("click", () => applyAxisFields("registration", registrationPlotController));
    byId("add-dark-region").addEventListener("click", () => {
      setControl("dark-mode", "manual_regions");
      syncPreparationControls();
      prepPlotController.setRegionDrawMode(true);
      setStatus("status", "Drag across the trace to add one dark region.");
    });
    byId("clear-dark-regions").addEventListener("click", () => {
      byId("manual-regions").value = "";
      prepPlotController.setRegionDrawMode(false);
      recomputePreparation();
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

    byId("window-mode").addEventListener("change", () => {
      syncReconstructionControls();
      renderRegistrationTrace();
      scheduleReconstruction(0);
    });
    [
      "map-rows","map-cols","scan-pattern","first-row-direction",
      "row-a","row-b","rows-apart","row-offset",
      "point-a","point-b","points-apart",
      "y-phase","x-period-offset","x-phase","window-fraction","window-duration","phase-aggregation",
    ].forEach(id => {
      const eventName =
        id === "scan-pattern" || id === "first-row-direction" || id === "phase-aggregation"
          ? "change"
          : "input";
      byId(id).addEventListener(eventName, () => {
        renderRegistrationTrace();
        scheduleReconstruction(eventName === "change" ? 0 : 80);
      });
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

    byId("save-project-button").addEventListener("click", saveProject);
    byId("export-prepared-button").addEventListener("click", exportPrepared);
    byId("export-raw-button").addEventListener("click", exportRawMap);
    byId("export-processed-button").addEventListener("click", exportProcessedMap);
    byId("export-summary-button").addEventListener("click", exportParameterSummary);
    byId("export-report-button").addEventListener("click", exportHtmlReport);

    root.addEventListener("resize", () => {
      if (state.activeStage === 2) renderTrace();
      else if (state.activeStage === 3) {
        renderRegistrationTrace();
        renderReconstruction();
      } else if (state.activeStage === 4) renderAnalysis();
    });

    syncPreparationControls();
    syncReconstructionControls();
    syncAnalysisControls();
    renderSourceSummary();
    renderPreparedSummary();
    renderTrace();
    renderRegistrationTrace();
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
