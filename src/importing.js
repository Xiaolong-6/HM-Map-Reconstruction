(function (root) {
  "use strict";

  const api = root.MapReconstructionWeb = root.MapReconstructionWeb || {};
  const math = api.math;

  function parseSeparatedLine(line, delimiter) {
    if (delimiter === "whitespace") {
      return line.trim().split(/\s+/);
    }
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (quoted) {
        if (char === '"') {
          if (line[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            quoted = false;
          }
        } else {
          field += char;
        }
      } else if (char === '"' && field.length === 0) {
        quoted = true;
      } else if (char === delimiter) {
        row.push(field.trim());
        field = "";
      } else {
        field += char;
      }
    }
    if (quoted) throw new Error("Delimited text contains an unterminated quoted field.");
    row.push(field.trim());
    rows.push(row);
    return rows[0];
  }

  function candidateWidths(lines, delimiter) {
    return lines.slice(0, 12).map(line => parseSeparatedLine(line, delimiter).length);
  }

  function detectDelimiter(lines) {
    const candidates = [",", "\t", ";", "whitespace"];
    let best = null;
    for (const delimiter of candidates) {
      const widths = candidateWidths(lines, delimiter);
      const width = widths[0] || 0;
      if (width < 2) continue;
      const consistent = widths.filter(value => value === width).length;
      const score = consistent * 100 + width;
      if (!best || score > best.score) best = { delimiter, width, score };
    }
    if (!best) throw new Error("Could not detect a tabular delimiter with at least two columns.");
    return best.delimiter;
  }

  function isFiniteCell(value) {
    return value !== "" && Number.isFinite(Number(value));
  }

  function uniqueNames(names) {
    const seen = new Map();
    return names.map((raw, index) => {
      const base = String(raw || "").trim() || "Column_" + (index + 1);
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      return count ? base + "_" + (count + 1) : base;
    });
  }

  function inspectDelimited(input, sourceName, requestedDelimiter) {
    const text = String(input).replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).filter(line => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("//");
    });
    if (lines.length < 2) throw new Error("Data file must contain at least two non-comment rows.");

    const delimiter = requestedDelimiter && requestedDelimiter !== "auto"
      ? requestedDelimiter
      : detectDelimiter(lines);
    const rawRows = lines.map(line => parseSeparatedLine(line, delimiter));
    const width = rawRows[0].length;
    if (width < 2) throw new Error("Data file must contain at least two columns.");
    rawRows.forEach((row, index) => {
      if (row.length !== width) {
        throw new Error("Row " + (index + 1) + " has " + row.length + " columns; expected " + width + ".");
      }
    });

    const hasHeader = rawRows[0].some(cell => !isFiniteCell(cell));
    const names = uniqueNames(hasHeader ? rawRows[0] : rawRows[0].map((_, index) => "Column_" + (index + 1)));
    const dataRows = hasHeader ? rawRows.slice(1) : rawRows;
    if (!dataRows.length) throw new Error("Data file contains a header but no data.");

    const numericColumns = names.map((name, columnIndex) => {
      let finiteCount = 0;
      for (const row of dataRows) if (isFiniteCell(row[columnIndex])) finiteCount += 1;
      return Object.freeze({
        index: columnIndex,
        name,
        finiteCount,
        rowCount: dataRows.length,
        numeric: finiteCount > 0,
        completeness: dataRows.length ? finiteCount / dataRows.length : 0,
      });
    });

    const model = {
      sourceName: String(sourceName || "data.txt"),
      delimiter,
      hasHeader,
      names: Object.freeze(names),
      rows: Object.freeze(dataRows.map(row => Object.freeze(row.slice()))),
      columns: Object.freeze(numericColumns),
      rowCount: dataRows.length,
      preview: Object.freeze(dataRows.slice(0, 12).map(row => Object.freeze(row.slice()))),
    };
    return Object.freeze(model);
  }

  function resolveColumn(model, value, label) {
    if (Number.isInteger(value)) {
      if (value < 0 || value >= model.names.length) throw new Error(label + " column index is out of range.");
      return value;
    }
    const index = model.names.indexOf(String(value));
    if (index < 0) throw new Error(label + " column " + JSON.stringify(value) + " was not found.");
    return index;
  }

  function toFiniteColumn(model, columnIndex, label) {
    const values = new Float64Array(model.rows.length);
    for (let rowIndex = 0; rowIndex < model.rows.length; rowIndex += 1) {
      const raw = model.rows[rowIndex][columnIndex];
      const value = Number(raw);
      if (raw === "" || !Number.isFinite(value)) {
        throw new Error(label + " has a non-numeric or non-finite value at data row " + (rowIndex + 1) + ".");
      }
      values[rowIndex] = value;
    }
    return values;
  }

  function canonicalizeDelimited(model, options) {
    const current = options || {};
    const timeMode = current.timeMode || "column";
    let timeValues;
    let timeLabel;
    let timeIndex = null;
    if (timeMode === "index") {
      const interval = Number(current.sampleIntervalS);
      if (!Number.isFinite(interval) || interval <= 0) {
        throw new Error("Sample interval must be finite and greater than zero.");
      }
      timeValues = Float64Array.from({ length: model.rowCount }, (_, index) => index * interval);
      timeLabel = "Generated sample index";
    } else {
      timeIndex = resolveColumn(model, current.timeColumn, "Time");
      timeValues = new Float64Array(model.rows.length);
      for (let rowIndex = 0; rowIndex < model.rows.length; rowIndex += 1) {
        const raw = model.rows[rowIndex][timeIndex];
        timeValues[rowIndex] = raw === "" ? NaN : Number(raw);
      }
      const scale = current.timeScale == null ? 1 : Number(current.timeScale);
      if (!Number.isFinite(scale) || scale <= 0) throw new Error("Time scale must be finite and greater than zero.");
      if (scale !== 1) {
        for (let index = 0; index < timeValues.length; index += 1) timeValues[index] *= scale;
      }
      timeLabel = model.names[timeIndex];
    }

    const selected = Array.from(current.signalColumns || []);
    if (!selected.length) throw new Error("Select at least one signal column.");
    const signalIndices = selected.map(value => resolveColumn(model, value, "Signal"));
    for (const columnIndex of signalIndices) {
      const column = model.columns[columnIndex];
      if (!column || !column.numeric) {
        throw new Error("Signal column " + JSON.stringify(model.names[columnIndex]) + " is non-numeric.");
      }
    }
    if (timeMode === "column") {
      const timeColumn = model.columns[timeIndex];
      if (!timeColumn || !timeColumn.numeric) {
        throw new Error("Time column " + JSON.stringify(model.names[timeIndex]) + " is non-numeric.");
      }
    }
    const uniqueIndices = Array.from(new Set(signalIndices));
    if (uniqueIndices.length !== signalIndices.length) throw new Error("Signal columns must be unique.");

    const signalsUnsorted = {};
    for (const columnIndex of signalIndices) {
      const name = model.names[columnIndex];
      const values = new Float64Array(model.rows.length);
      for (let rowIndex = 0; rowIndex < model.rows.length; rowIndex += 1) {
        const raw = model.rows[rowIndex][columnIndex];
        values[rowIndex] = raw === "" ? NaN : Number(raw);
      }
      signalsUnsorted[name] = values;
    }

    const validRows = [];
    for (let rowIndex = 0; rowIndex < model.rows.length; rowIndex += 1) {
      if (!Number.isFinite(timeValues[rowIndex])) continue;
      let valid = true;
      for (const name of Object.keys(signalsUnsorted)) {
        if (!Number.isFinite(signalsUnsorted[name][rowIndex])) { valid = false; break; }
      }
      if (valid) validRows.push(rowIndex);
    }
    if (!validRows.length) {
      throw new Error("No rows contain finite time and all selected signal values.");
    }

    const validTimes = Float64Array.from(validRows, rowIndex => timeValues[rowIndex]);
    const orderWithinValid = math.stableNumericOrder(validTimes);
    const order = orderWithinValid.map(index => validRows[index]);
    const timeS = new Float64Array(order.length);
    const signals = {};
    for (const name of Object.keys(signalsUnsorted)) signals[name] = new Float64Array(order.length);
    for (let index = 0; index < order.length; index += 1) {
      const sourceIndex = order[index];
      timeS[index] = timeValues[sourceIndex];
      for (const name of Object.keys(signals)) signals[name][index] = signalsUnsorted[name][sourceIndex];
    }

    const metadata = {
      schema: "HappyMeasure CSV v2",
      imported_from: model.sourceName,
      import_format: "generic-delimited",
      delimiter: model.delimiter === "\t" ? "tab" : model.delimiter,
      original_time_column: timeLabel,
      imported_signal_columns: Object.keys(signals),
      original_row_count: model.rowCount,
      retained_row_count: timeS.length,
      dropped_row_count: model.rowCount - timeS.length,
    };

    function csvCell(value) {
      const text = String(value);
      return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
    }

    const header = ["Elapsed_s", ...Object.keys(signals)];
    const lines = [
      "# HappyMeasure measurement export",
      "# schema,single-v2",
      "# metadata," + csvCell(JSON.stringify(metadata)),
      "# section,data",
      header.join(","),
    ];
    for (let rowIndex = 0; rowIndex < timeS.length; rowIndex += 1) {
      const row = [timeS[rowIndex].toPrecision(17)];
      for (const name of Object.keys(signals)) row.push(signals[name][rowIndex].toPrecision(17));
      lines.push(row.join(","));
    }
    const canonicalText = lines.join("\n") + "\n";

    return Object.freeze({
      sourceName: model.sourceName,
      canonicalText,
      metadata: Object.freeze(metadata),
      timeS,
      signals: Object.freeze(signals),
      signalNames: Object.freeze(Object.keys(signals)),
      sampleCount: timeS.length,
    });
  }

  function looksLikeHappyMeasure(input) {
    const text = String(input).replace(/^\uFEFF/, "");
    return /(^|\n)#\s*schema\s*,\s*single-v2\s*(\r?\n|$)/.test(text);
  }

  api.importing = Object.freeze({
    parseSeparatedLine,
    detectDelimiter,
    inspectDelimited,
    canonicalizeDelimited,
    looksLikeHappyMeasure,
  });
})(typeof window !== "undefined" ? window : globalThis);
