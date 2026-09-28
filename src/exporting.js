(function (root) {
  "use strict";
  const api = root.MapReconstructionWeb = root.MapReconstructionWeb || {};

  function formatGeneral(value, precision) {
    const number = Number(value);
    if (Number.isNaN(number)) return "nan";
    if (number === Infinity) return "inf";
    if (number === -Infinity) return "-inf";
    if (number === 0) return "0";
    const p = Math.max(1, Number(precision) || 12);
    const exponent = Math.floor(Math.log10(Math.abs(number)));
    if (exponent < -4 || exponent >= p) {
      const parts = number.toExponential(p - 1).split("e");
      const mantissa = parts[0].replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
      const expNumber = Number(parts[1]);
      return mantissa + "e" + (expNumber >= 0 ? "+" : "-") +
        String(Math.abs(expNumber)).padStart(2, "0");
    }
    const decimals = Math.max(0, p - exponent - 1);
    return number.toFixed(decimals).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
  }

  function matrixCsv(values, rows, cols) {
    const r = Number(rows), c = Number(cols);
    if (!Number.isInteger(r) || r <= 0 || !Number.isInteger(c) || c <= 0) {
      throw new Error("Map export requires positive integer rows and columns.");
    }
    if (!values || values.length !== r * c) {
      throw new Error("Map export dimensions do not match the value array.");
    }
    const lines = [];
    for (let row = 0; row < r; row += 1) {
      const cells = [];
      for (let col = 0; col < c; col += 1) {
        cells.push(formatGeneral(values[row * c + col], 12));
      }
      lines.push(cells.join(","));
    }
    return lines.join("\n") + "\n";
  }

  function preparedCsv(prepared, rawValues) {
    if (!prepared || !rawValues || prepared.time_s.length !== rawValues.length) {
      throw new Error("Prepared export requires matching raw and prepared arrays.");
    }
    const signal = prepared.source_signal;
    const hasBaseline = prepared.baseline != null;
    const header = ["Elapsed_s", "Raw_" + signal];
    if (hasBaseline) header.push("Baseline_" + signal);
    header.push("Prepared_" + signal);
    const lines = [header.join(",")];
    for (let index = 0; index < prepared.time_s.length; index += 1) {
      const row = [
        formatGeneral(prepared.time_s[index], 12),
        formatGeneral(rawValues[index], 12),
      ];
      if (hasBaseline) row.push(formatGeneral(prepared.baseline[index], 12));
      row.push(formatGeneral(prepared.values[index], 12));
      lines.push(row.join(","));
    }
    return lines.join("\n") + "\n";
  }

  function preparationToDict(config) {
    const current = config || {};
    const regions = (current.manual_dark_regions || []).map(region => ({
      start_s: Number(region.start_s),
      end_s: Number(region.end_s),
    }));
    return {
      mode: current.dark_correction_mode,
      dark_correction: {
        mode: current.dark_correction_mode,
        quantile: Number(current.rolling_quantile) * 100,
        window_s: Number(current.rolling_window_s),
        trend: current.rolling_trend,
        manual_regions: regions,
        manual_region_fit: current.manual_region_fit,
      },
      constant_baseline: Number(current.constant_baseline),
      manual_region_fit: current.manual_region_fit,
      manual_regions: regions,
      rolling_quantile: Number(current.rolling_quantile),
      rolling_window_s: Number(current.rolling_window_s),
      rolling_trend: current.rolling_trend,
      response_direction: current.response_direction,
      value_gate: current.value_gate_enabled
        ? { min: Number(current.value_gate_min), max: Number(current.value_gate_max) }
        : null,
      output_convention: current.output_convention,
      baseline_model: current.dark_correction_mode,
      apply_baseline: Boolean(current.apply_baseline),
      invert_signal: Boolean(current.invert_signal),
    };
  }

  function processedMetadata(options) {
    const current = options || {};
    return {
      source_signal: current.signal,
      source_physical_unit: current.scientificUnit || "",
      raw_physical_unit: current.scientificUnit || "",
      display_unit: current.rawDisplayUnit ? current.rawDisplayUnit.unit : "",
      display_scale: current.rawDisplayUnit ? current.rawDisplayUnit.scale : 1,
      signal_preparation: preparationToDict(current.preparation),
      prepared_metadata: current.preparedMetadata || {},
      baseline_used_si: current.processed ? current.processed.baseline_used : null,
      processing: current.processing || {},
      processing_warnings: current.processed ? Array.from(current.processed.warnings || []) : [],
      value_label: current.processed ? current.processed.value_label : "",
      dimensionless: Boolean(current.processed && current.processed.is_dimensionless),
      display_color_limits: current.displayColorLimits || null,
    };
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function titleWords(value) {
    return String(value || "")
      .replaceAll("_", " ")
      .replace(/\b\w/g, character => character.toUpperCase());
  }

  function formatDuration(seconds) {
    const value = Number(seconds);
    return Math.abs(value) < 0.1
      ? (value * 1000).toFixed(1) + " ms"
      : value.toFixed(4) + " s";
  }

  function formatPhase(fraction, period) {
    const percent = (Number(fraction) * 100).toFixed(1) + " %";
    return period == null
      ? percent
      : percent + " (" + formatDuration(Number(fraction) * Number(period)) + ")";
  }

  function valueWithUnit(value, unit) {
    return formatGeneral(value, 6) + (unit ? " " + unit : "");
  }

  function processingLines(config, sourceUnit) {
    const current = config || {};
    const valueNames = { raw: "Raw signed", absolute: "Absolute value", negate: "Negate", custom: "Custom expression" };
    const baselineNames = {
      none: "None", manual: "Manual", mean: "Mean", median: "Median",
      minimum: "Minimum", maximum: "Maximum", percentile: "Percentile",
    };
    const normalizationNames = {
      none: "None", max_magnitude: "Max magnitude", min_max: "Min-max", reference: "Reference",
    };
    const colorNames = { auto: "Auto data range", percentile: "Percentile", manual: "Manual" };
    const lines = [
      "Value: " + (valueNames[current.transform] || current.transform),
      "Baseline: " + (baselineNames[current.baseline_mode] || current.baseline_mode),
    ];
    if (current.baseline_mode === "manual" && current.baseline_value != null) {
      lines.push("Baseline value: " + valueWithUnit(current.baseline_value, sourceUnit));
    } else if (current.baseline_mode === "percentile") {
      lines.push("Baseline percentile: " + formatGeneral(current.baseline_percentile, 6) + "%");
    }
    lines.push("Normalization: " + (normalizationNames[current.normalization] || current.normalization));
    if (current.normalization === "reference" && current.normalization_reference != null) {
      lines.push("Normalization reference: " + valueWithUnit(
        current.normalization_reference,
        current.transform === "custom" ? "" : sourceUnit,
      ));
    }
    lines.push("Scale: " + (current.value_scale === "log10" ? "Log10" : "Linear"));
    lines.push("Color limits: " + (colorNames[current.color_range_mode] || current.color_range_mode));
    if (current.color_range_mode === "percentile") {
      lines.push("Low percentile: " + formatGeneral(current.percentile_low, 6) + "%");
      lines.push("High percentile: " + formatGeneral(current.percentile_high, 6) + "%");
    } else if (current.color_range_mode === "manual") {
      const unit = current.transform === "custom" ||
        current.normalization !== "none" ||
        current.value_scale === "log10" ? "" : sourceUnit;
      if (current.color_min != null) lines.push("Color minimum: " + valueWithUnit(current.color_min, unit));
      if (current.color_max != null) lines.push("Color maximum: " + valueWithUnit(current.color_max, unit));
    }
    if (current.transform === "custom") lines.push("f(x): " + current.custom_expression);
    return lines;
  }

  function parameterSummary(options) {
    const o = options || {};
    const source = o.source;
    const result = o.result;
    const processed = o.processed;
    const params = o.params || {};
    const preparation = o.preparation || {};
    const processing = o.processing || {};
    const timing = result ? result.timing : null;
    const sourceUnit = o.scientificUnit || "";
    const rows = Number(params.rows || 0), cols = Number(params.cols || 0);
    const geometry = rows && cols ? rows + " × " + cols : "—";
    const legacy = o.method === "dual_offset";
    const aggregation = legacy ? (params.use_median ? "median" : "mean") : (params.aggregation || "median");
    const rowPeriod = timing ? Number(timing.row_period_s).toFixed(4) + " s" : "—";
    const pointPeriod = timing ? Number(timing.point_period_s).toFixed(4) + " s" : "—";
    const rowSlack = timing
      ? (Number(timing.row_period_s) - cols * Number(timing.point_period_s)).toFixed(3) + " s"
      : "—";

    let valid = "—", medianSamples = "—";
    const warnings = [];
    if (result) {
      let finiteCount = 0;
      const samples = [];
      for (let index = 0; index < result.values.length; index += 1) {
        if (Number.isFinite(result.values[index])) {
          finiteCount += 1;
          samples.push(Number(result.sample_counts[index]));
        }
      }
      valid = Math.round(100 * finiteCount / result.values.length) + " %";
      medianSamples = formatGeneral(median(samples), 3);
      warnings.push(...Array.from(result.warnings || []));
    }
    if (processed) warnings.push(...Array.from(processed.warnings || []));

    const sampleCount = source ? String(source.sampleCount) : "—";
    const elapsed = source && source.timeS.length
      ? Number(source.timeS[0]).toFixed(3) + " - " +
        Number(source.timeS[source.timeS.length - 1]).toFixed(3) + " s"
      : "—";

    const registration = [
      "Registration",
      "------------",
      "Method: " + (legacy ? "Dual Offset (Legacy)" : "Dual Offset — Phase Window"),
      "YA: " + Number(params.row_a_s || 0).toFixed(3) + " s",
      "YB: " + Number(params.row_b_s || 0).toFixed(3) + " s",
      "Rows apart: " + (params.rows_apart == null ? "—" : params.rows_apart),
      "Row period: " + rowPeriod,
      "Row offset: " + (params.row_offset == null ? "—" : params.row_offset),
    ];
    if (legacy) {
      registration.push(
        "XA: " + Number(params.point_a_s || 0).toFixed(3) + " s",
        "XB: " + Number(params.point_b_s || 0).toFixed(3) + " s",
        "Points apart: " + (params.points_apart == null ? "—" : params.points_apart),
        "Point period: " + pointPeriod,
        "Point offset: " + (params.point_offset == null ? "—" : params.point_offset),
        "Unused / row: " + rowSlack,
      );
    } else {
      registration.push(
        "Y phase: " + formatPhase(params.y_phase_fraction || 0, timing ? timing.row_period_s : null),
        "XA: " + Number(params.point_a_s || 0).toFixed(3) + " s",
        "XB: " + Number(params.point_b_s || 0).toFixed(3) + " s",
        "Points apart: " + (params.points_apart == null ? "—" : params.points_apart),
        "Point period: " + pointPeriod,
        "X offset: " + (params.x_period_offset == null ? "—" : params.x_period_offset),
        "X phase: " + formatPhase(params.x_phase_fraction || 0, timing ? timing.point_period_s : null),
        "Window mode: " + (params.window_mode === "fixed_duration" ? "Fixed duration" : "Fraction of point period"),
        "Window width: " + (params.window_mode === "fixed_duration"
          ? formatDuration(params.window_duration_s || 0)
          : formatPhase(params.window_fraction || 0, timing ? timing.point_period_s : null)),
        "Aggregation: " + titleWords(aggregation),
        "Point-train slack / row: " + rowSlack,
      );
    }

    const prepLines = [
      "Mode: " + titleWords(preparation.dark_correction_mode),
      "Output convention: " + titleWords(preparation.output_convention),
    ];
    if (preparation.dark_correction_mode === "constant") {
      prepLines.push("Constant baseline: " + valueWithUnit(preparation.constant_baseline, sourceUnit));
    } else if (preparation.dark_correction_mode === "manual_regions") {
      prepLines.push("Manual regions: " + (preparation.manual_dark_regions || []).length);
      prepLines.push("Manual fit: " + titleWords(preparation.manual_region_fit));
    } else if (preparation.dark_correction_mode === "rolling_quantile") {
      prepLines.push("Response direction: " + titleWords(preparation.response_direction) + " photocurrent");
      prepLines.push("Quantile: " + (Number(preparation.rolling_quantile) * 100).toFixed(1) + " %");
      prepLines.push("Window: " + formatGeneral(preparation.rolling_window_s, 4) + " s");
      prepLines.push("Trend: " + titleWords(preparation.rolling_trend));
    }

    const lines = [
      "Map Reconstruction Parameters",
      "============================",
      "",
      "Source",
      "------",
      "File: " + (o.originalFilename || "map.csv"),
      "Signal: " + (o.signal || ""),
      "Samples: " + sampleCount,
      "Elapsed time: " + elapsed,
      "",
      "Signal Preparation",
      "------------------",
      ...prepLines,
      "",
      "Geometry",
      "--------",
      "Rows × columns: " + geometry,
      "Scan pattern: " + titleWords(params.scan_pattern),
      "First row: " + (params.first_row_ltr ? "L -> R" : "R -> L"),
      "Aggregation: " + titleWords(aggregation),
      "Flip Y display: " + (o.flipY ? "Yes" : "No"),
      "",
      ...registration,
      "",
      "Processing",
      "----------",
      ...processingLines(processing, sourceUnit),
      "",
      "QC",
      "--",
      "Valid pixels: " + valid,
      "Median samples / pixel: " + medianSamples,
      "Warnings: " + (warnings.length ? warnings.join(" | ") : "None"),
    ];
    if (result && !processed) lines.push("", "Processed map unavailable; raw reconstruction retained.");
    else if (result && processed && !Array.from(processed.values).some(Number.isFinite)) {
      lines.push("", "No finite processed values; raw reconstruction retained.");
    }
    return lines.join("\n") + "\n";
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function htmlReport(options) {
    const current = options || {};
    const figures = (current.figures || []).map(figure =>
      "<figure>" +
      '<img src="' + String(figure.dataUri || "") + '" alt="' + escapeHtml(figure.alt || figure.title || "") + '">' +
      "<figcaption>" + escapeHtml(figure.title || "") + "</figcaption>" +
      "</figure>"
    ).join("\n");
    return "<!doctype html>\n" +
      '<html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<title>Map Reconstruction Report</title><style>" +
      "body{max-width:1180px;margin:2rem auto;padding:0 1rem;color:#172033;background:#fff;font:16px/1.45 system-ui,sans-serif}" +
      "h1{margin-bottom:.2rem}.note{color:#4b5563}" +
      "pre{overflow-x:auto;padding:1rem;border:1px solid #d1d5db;border-radius:6px;background:#f8fafc;white-space:pre-wrap}" +
      ".figures{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:1.25rem}" +
      "figure{margin:0;padding:.75rem;border:1px solid #d1d5db;border-radius:6px;background:#fff}" +
      "img{display:block;width:100%;height:auto}figcaption{margin-top:.5rem;font-weight:600}" +
      "</style></head><body>" +
      "<h1>Map Reconstruction Report</h1>" +
      '<p class="note">Self-contained HTML export. Figures show the current scientific views.</p>' +
      "<h2>Reproducibility and QC summary</h2><pre>" + escapeHtml(current.summary || "") + "</pre>" +
      '<h2>Current views</h2><section class="figures">' + figures + "</section>" +
      "</body></html>\n";
  }

  api.exporting = Object.freeze({
    formatGeneral,
    matrixCsv,
    preparedCsv,
    preparationToDict,
    processedMetadata,
    parameterSummary,
    htmlReport,
  });
})(typeof window !== "undefined" ? window : globalThis);
