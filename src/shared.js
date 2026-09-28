(function (root) {
  "use strict";

  const api = root.MapReconstructionWeb = root.MapReconstructionWeb || {};

  function finiteNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(label + " must be finite.");
    return number;
  }

  function stableNumericOrder(values) {
    return Array.from(values, function (_, index) { return index; })
      .sort(function (left, right) {
        const delta = values[left] - values[right];
        return delta || left - right;
      });
  }

  function lowerBound(values, target) {
    let low = 0, high = values.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (values[middle] < target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function upperBound(values, target) {
    let low = 0, high = values.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (values[middle] <= target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function sortedFinite(values) {
    return Array.from(values).filter(Number.isFinite).sort(function (a, b) { return a - b; });
  }

  function quantile(values, q) {
    const sorted = sortedFinite(values);
    if (!sorted.length) throw new Error("Cannot calculate a quantile of an empty array.");
    if (!Number.isFinite(q) || q < 0 || q > 1) throw new Error("Quantile must be between 0 and 1.");
    if (sorted.length === 1) return sorted[0];
    const position = (sorted.length - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const fraction = position - lower;
    return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
  }

  function median(values) { return quantile(values, 0.5); }

  function mean(values) {
    if (!values.length) throw new Error("Cannot calculate a mean of an empty array.");
    let total = 0;
    for (const value of values) total += value;
    return total / values.length;
  }

  function solveLinearSystem(matrix, vector) {
    const n = vector.length;
    const a = matrix.map(function (row, index) { return row.slice().concat(vector[index]); });
    for (let column = 0; column < n; column += 1) {
      let pivot = column;
      for (let row = column + 1; row < n; row += 1) {
        if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
      }
      if (Math.abs(a[pivot][column]) <= Number.EPSILON) {
        throw new Error("Polynomial fit is singular.");
      }
      if (pivot !== column) {
        const swap = a[column]; a[column] = a[pivot]; a[pivot] = swap;
      }
      const divisor = a[column][column];
      for (let item = column; item <= n; item += 1) a[column][item] /= divisor;
      for (let row = 0; row < n; row += 1) {
        if (row === column) continue;
        const factor = a[row][column];
        for (let item = column; item <= n; item += 1) a[row][item] -= factor * a[column][item];
      }
    }
    return a.map(function (row) { return row[n]; });
  }

  function polynomialFitEvaluate(x, y, degree, targets) {
    if (x.length !== y.length || x.length < degree + 1) {
      throw new Error("Polynomial fit has insufficient anchors.");
    }
    const center = mean(x);
    let scale = 0;
    for (const value of x) scale = Math.max(scale, Math.abs(value - center));
    if (scale === 0) scale = 1;
    const size = degree + 1;
    const gram = Array.from({ length: size }, function () { return Array(size).fill(0); });
    const rhs = Array(size).fill(0);
    for (let index = 0; index < x.length; index += 1) {
      const z = (x[index] - center) / scale;
      const powers = [1];
      for (let power = 1; power <= degree; power += 1) powers.push(powers[power - 1] * z);
      for (let row = 0; row < size; row += 1) {
        rhs[row] += powers[row] * y[index];
        for (let column = 0; column < size; column += 1) {
          gram[row][column] += powers[row] * powers[column];
        }
      }
    }
    const coefficients = solveLinearSystem(gram, rhs);
    const output = new Float64Array(targets.length);
    for (let index = 0; index < targets.length; index += 1) {
      const z = (targets[index] - center) / scale;
      let value = 0, power = 1;
      for (let coefficient = 0; coefficient < coefficients.length; coefficient += 1) {
        value += coefficients[coefficient] * power;
        power *= z;
      }
      output[index] = value;
    }
    return output;
  }

  function interpolateLinear(x, y, targets) {
    if (!x.length || x.length !== y.length) throw new Error("Interpolation anchors are invalid.");
    const output = new Float64Array(targets.length);
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      if (target <= x[0] || x.length === 1) { output[index] = y[0]; continue; }
      if (target >= x[x.length - 1]) { output[index] = y[y.length - 1]; continue; }
      const right = upperBound(x, target);
      const left = right - 1;
      const fraction = (target - x[left]) / (x[right] - x[left]);
      output[index] = y[left] * (1 - fraction) + y[right] * fraction;
    }
    return output;
  }

  api.math = Object.freeze({
    finiteNumber,
    stableNumericOrder,
    lowerBound,
    upperBound,
    quantile,
    median,
    mean,
    sortedFinite,
    polynomialFitEvaluate,
    interpolateLinear
  });
})(typeof window !== "undefined" ? window : globalThis);
