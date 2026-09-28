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
    return {
      dark_correction_mode: byId("dark-mode").value,
      constant_baseline: Number(byId("constant-baseline").value),
      manual_dark_regions: parseManualRegions(),
      manual_region_fit: byId("manual-fit").value,
      rolling_quantile: Number(byId("rolling-quantile").value) / 100,
      rolling_window_s: Number(byId("rolling-window").value),
      rolling_trend: byId("rolling-trend").value,
      response_direction: byId("response-direction").value,
      value_gate_enabled: byId("gate-enabled").checked,
      value_gate_min: Number(byId("gate-min").value),
      value_gate_max: Number(byId("gate-max").value),
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
    const series = [{ values: state.source.signals[state.signal], color: "#275fe6" }];
    if (state.prepared && state.prepared.baseline) {
      series.push({ values: state.prepared.baseline, color: "#d97706", dash: [6, 4] });
    }
    if (state.prepared) {
      series.push({ values: state.prepared.values, color: "#168a62" });
    }
    api.plotting.drawTraces(canvas, state.source.timeS, series, { yLabel: state.signal });
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
    api.plotting.drawHeatmap(
      mapCanvas,
      state.reconstruction.values,
      state.reconstruction.rows,
      state.reconstruction.cols,
    );
    api.plotting.drawHeatmap(
      countCanvas,
      state.reconstruction.sample_counts,
      state.reconstruction.rows,
      state.reconstruction.cols,
      { counts: true },
    );
  }

  function syncAnalysisControls() {
    byId("map-baseline-value-field").hidden = byId("map-baseline").value !== "manual";
    byId("map-baseline-percentile-field").hidden = byId("map-baseline").value !== "percentile";
    byId("custom-expression-field").hidden = byId("map-transform").value !== "custom";
    byId("normalization-reference-field").hidden = byId("map-normalization").value !== "reference";
    byId("color-percentiles").hidden = byId("color-range-mode").value !== "percentile";
    byId("color-manual").hidden = byId("color-range-mode").value !== "manual";
    byId("hist-count-field").hidden = byId("hist-bin-mode").value !== "count";
    byId("hist-width-field").hidden = byId("hist-bin-mode").value !== "width";
  }

  function analysisConfig() {
    return {
      baseline_mode: byId("map-baseline").value,
      baseline_value: Number(byId("map-baseline-value").value),
      baseline_percentile: Number(byId("map-baseline-percentile").value),
      transform: byId("map-transform").value,
      custom_expression: byId("custom-expression").value,
      normalization: byId("map-normalization").value,
      normalization_reference: Number(byId("normalization-reference").value),
      value_scale: byId("value-scale").value,
      color_range_mode: byId("color-range-mode").value,
      color_min: Number(byId("color-min").value),
      color_max: Number(byId("color-max").value),
      percentile_low: Number(byId("color-low").value),
      percentile_high: Number(byId("color-high").value),
    };
  }

  function histogramConfig() {
    return {
      bin_mode: byId("hist-bin-mode").value,
      bin_count: Number(byId("hist-count").value),
      bin_width: Number(byId("hist-width").value),
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
          : state.processed.baseline_used.toPrecision(6)) +
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

    if (Array.from(state.processed.values).some(Number.isFinite)) {
      mapEmpty.classList.add("hidden");
      api.plotting.drawHeatmap(
        mapCanvas,
        state.processed.values,
        state.reconstruction.rows,
        state.reconstruction.cols,
        { levels: state.colorLimits, flipY: state.flipY },
      );
    } else {
      mapEmpty.classList.remove("hidden");
      api.plotting.clearCanvas(mapCanvas);
    }

    if (state.histogram) {
      histogramEmpty.classList.add("hidden");
      api.plotting.drawHistogram(histogramCanvas, state.histogram);
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

    setControl("dark-mode", prep.dark_correction_mode);
    setControl("constant-baseline", prep.constant_baseline);
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
      setControl("gate-min", prep.value_gate_min);
      setControl("gate-max", prep.value_gate_max);
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
    if (proc.baseline_value != null) setControl("map-baseline-value", proc.baseline_value);
    setControl("map-baseline-percentile", proc.baseline_percentile);
    setControl("map-transform", proc.transform);
    setControl("custom-expression", proc.custom_expression);
    setControl("map-normalization", proc.normalization);
    if (proc.normalization_reference != null) {
      setControl("normalization-reference", proc.normalization_reference);
    }
    setControl("value-scale", proc.value_scale);
    setControl("color-range-mode", proc.color_range_mode);
    if (proc.color_min != null) setControl("color-min", proc.color_min);
    if (proc.color_max != null) setControl("color-max", proc.color_max);
    setControl("color-low", proc.percentile_low);
    setControl("color-high", proc.percentile_high);

    syncPreparationControls();
    syncReconstructionControls();
    syncAnalysisControls();
    renderSourceSummary();
    byId("metadata-view").textContent = JSON.stringify(state.source.metadata, null, 2);

    recomputePreparation();
    if (state.prepared) reconstruct();
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
      const blob = new Blob([result.bytes], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = state.originalFilename.replace(/\.csv$/i, "") + ".hmmap";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      state.signal = event.target.value;
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
      "hist-bin-mode",
      "hist-count",
      "hist-width",
    ].forEach(id => {
      byId(id).addEventListener(
        id === "custom-expression" ? "input" : "change",
        recomputeAnalysis,
      );
    });

    byId("reconstruct-button").addEventListener("click", reconstruct);
    byId("save-project-button").addEventListener("click", saveProject);

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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  api.appState = state;
})(window);
