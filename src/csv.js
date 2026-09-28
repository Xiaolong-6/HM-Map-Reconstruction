(function (root) {
  "use strict";

  const api = root.MapReconstructionWeb = root.MapReconstructionWeb || {};
  const math = api.math;

  function parseCsvRows(input) {
    const text = String(input).replace(/^\uFEFF/, "");
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"') {
          if (text[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            quoted = false;
          }
        } else {
          field += char;
        }
        continue;
      }

      if (char === '"' && field.length === 0) {
        quoted = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && text[index + 1] === "\n") index += 1;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }

    if (quoted) throw new Error("CSV contains an unterminated quoted field.");
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function markerRow(rows, marker) {
    return rows.find(function (row) {
      return row.length && row[0].trim() === marker;
    }) || null;
  }

  function parseFiniteColumn(rows, columnIndex, name, firstDataRowNumber) {
    const values = new Float64Array(rows.length);
    for (let index = 0; index < rows.length; index += 1) {
      const raw = rows[index][columnIndex].trim();
      const value = Number(raw);
      if (raw === "" || !Number.isFinite(value)) {
        throw new Error(
          "Column " + JSON.stringify(name) + " has a non-numeric or non-finite value at row " +
          (firstDataRowNumber + index) + ": " + JSON.stringify(raw) + "."
        );
      }
      values[index] = value;
    }
    return values;
  }

  function reorder(values, order) {
    const output = new Float64Array(order.length);
    for (let index = 0; index < order.length; index += 1) output[index] = values[order[index]];
    return output;
  }

  function parseHappyMeasureCsv(input, sourceName) {
    const rows = parseCsvRows(input);
    if (!rows.length) throw new Error("CSV file is empty.");

    const schemaRow = markerRow(rows, "# schema");
    const schema = schemaRow && schemaRow.length > 1 ? schemaRow[1].trim() : "";
    if (schema === "combined-v2" || schema.startsWith("combined-")) {
      throw new Error("Combined HappyMeasure CSV exports are not supported; choose a single-v2 export.");
    }
    if (schema !== "single-v2") {
      throw new Error("Expected HappyMeasure single-v2 CSV schema, got " + JSON.stringify(schema || "missing") + ".");
    }

    let metadata = {};
    const metadataRow = markerRow(rows, "# metadata");
    if (metadataRow) {
      if (metadataRow.length < 2) throw new Error("HappyMeasure metadata row is missing its JSON field.");
      try {
        metadata = JSON.parse(metadataRow[1]);
      } catch (error) {
        throw new Error("HappyMeasure metadata is not valid JSON: " + error.message + ".");
      }
      if (!metadata || Array.isArray(metadata) || typeof metadata !== "object") {
        throw new Error("HappyMeasure metadata JSON must be an object.");
      }
    }

    const sectionIndex = rows.findIndex(function (row) {
      return row.length >= 2 && row[0].trim() === "# section" && row[1].trim() === "data";
    });
    if (sectionIndex < 0) throw new Error("HappyMeasure CSV is missing its '# section,data' row.");

    const dataRows = rows.slice(sectionIndex + 1).filter(function (row) {
      return row.length && !row[0].trim().startsWith("#");
    });
    if (!dataRows.length) throw new Error("HappyMeasure CSV data section is empty.");

    const header = dataRows[0].map(function (cell) { return cell.trim(); });
    if (header.some(function (name) { return !name; }) || new Set(header).size !== header.length) {
      throw new Error("HappyMeasure data header must contain unique non-empty names.");
    }
    const timeIndex = header.indexOf("Elapsed_s");
    if (timeIndex < 0) throw new Error("HappyMeasure data header must contain an 'Elapsed_s' column.");

    const rowsData = dataRows.slice(1);
    if (!rowsData.length) throw new Error("HappyMeasure CSV contains a header but no data rows.");
    const expectedWidth = header.length;
    rowsData.forEach(function (row, index) {
      if (row.length !== expectedWidth) {
        throw new Error(
          "HappyMeasure row " + (sectionIndex + 3 + index) + " has " + row.length +
          " fields; expected " + expectedWidth + "."
        );
      }
    });

    const firstDataRowNumber = sectionIndex + 3;
    const timeUnsorted = parseFiniteColumn(rowsData, timeIndex, "Elapsed_s", firstDataRowNumber);
    const unsortedSignals = {};
    header.forEach(function (name, index) {
      if (index !== timeIndex) {
        unsortedSignals[name] = parseFiniteColumn(rowsData, index, name, firstDataRowNumber);
      }
    });

    const order = math.stableNumericOrder(timeUnsorted);
    const signals = {};
    Object.keys(unsortedSignals).forEach(function (name) {
      signals[name] = reorder(unsortedSignals[name], order);
    });

    const model = {
      sourceName: String(sourceName || "source.csv"),
      schema,
      timeS: reorder(timeUnsorted, order),
      signals,
      signalNames: Object.freeze(Object.keys(signals)),
      metadata: Object.freeze(Object.assign({}, metadata)),
      sampleCount: rowsData.length
    };
    if (!model.signalNames.length) throw new Error("At least one signal column is required.");
    return Object.freeze(model);
  }

  api.csv = Object.freeze({ parseCsvRows, parseHappyMeasureCsv });
})(typeof window !== "undefined" ? window : globalThis);
