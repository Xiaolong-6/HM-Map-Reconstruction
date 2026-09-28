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

  api.exporting = Object.freeze({
    formatGeneral,
    matrixCsv,
    preparedCsv,
    preparationToDict,
    processedMetadata,
  });
})(typeof window !== "undefined" ? window : globalThis);
