(function (root) {
  "use strict";

  const api = root.MapReconstructionWeb = root.MapReconstructionWeb || {};
  const math = api.math;

  const MODES = Object.freeze({
    NONE: "none",
    CONSTANT: "constant",
    MANUAL: "manual_regions",
    ROLLING: "rolling_quantile"
  });

  function normalizeRegion(region) {
    const start = math.finiteNumber(region.start_s, "Dark region start_s");
    const end = math.finiteNumber(region.end_s, "Dark region end_s");
    if (!(start < end)) throw new Error("Dark regions require finite start_s < end_s.");
    return Object.freeze({ start_s: start, end_s: end, center_s: (start + end) / 2 });
  }

  function normalizeConfig(input) {
    const source = input || {};
    const mode = source.dark_correction_mode || MODES.NONE;
    if (!Object.values(MODES).includes(mode)) throw new Error("Unsupported dark correction mode.");
    const manualFit = source.manual_region_fit || "constant";
    if (!["constant", "linear", "quadratic"].includes(manualFit)) {
      throw new Error("Unsupported manual-region fit.");
    }
    const trend = source.rolling_trend || "piecewise_linear";
    if (!["piecewise_linear", "linear", "quadratic"].includes(trend)) {
      throw new Error("Unsupported rolling trend.");
    }
    const response = source.response_direction || "negative";
    if (!["negative", "positive"].includes(response)) throw new Error("Unsupported response direction.");

    let applyBaseline;
    let invertSignal;
    const requestedConvention = source.output_convention || "measured_minus_dark";
    if (mode === MODES.NONE) {
      applyBaseline = false;
      invertSignal = source.invert_signal == null ? false : Boolean(source.invert_signal);
    } else {
      applyBaseline = source.apply_baseline == null ? true : Boolean(source.apply_baseline);
      invertSignal = source.invert_signal == null
        ? requestedConvention === "dark_minus_measured"
        : Boolean(source.invert_signal);
    }

    const baseline = Number(source.constant_baseline == null ? 0 : source.constant_baseline);
    if (!Number.isFinite(baseline)) throw new Error("constant_baseline must be finite.");
    const quantile = Number(source.rolling_quantile == null ? 0.9 : source.rolling_quantile);
    if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1) {
      throw new Error("rolling_quantile must be between 0 and 1.");
    }
    const windowS = Number(source.rolling_window_s == null ? 10 : source.rolling_window_s);
    if (!Number.isFinite(windowS) || windowS <= 0) {
      throw new Error("rolling_window_s must be greater than zero.");
    }

    const gateEnabled = Boolean(source.value_gate_enabled);
    const gateMin = Number(source.value_gate_min == null ? -Infinity : source.value_gate_min);
    const gateMax = Number(source.value_gate_max == null ? Infinity : source.value_gate_max);
    if (gateEnabled && (!Number.isFinite(gateMin) || !Number.isFinite(gateMax) || gateMin > gateMax)) {
      throw new Error("Value-gate limits must be finite with min <= max.");
    }

    return Object.freeze({
      dark_correction_mode: mode,
      constant_baseline: baseline,
      manual_dark_regions: Object.freeze((source.manual_dark_regions || []).map(normalizeRegion)),
      manual_region_fit: manualFit,
      rolling_quantile: quantile,
      rolling_window_s: windowS,
      rolling_trend: trend,
      response_direction: response,
      value_gate_enabled: gateEnabled,
      value_gate_min: gateMin,
      value_gate_max: gateMax,
      output_convention: invertSignal ? "dark_minus_measured" : "measured_minus_dark",
      apply_baseline: applyBaseline,
      invert_signal: invertSignal
    });
  }

  function eligible(values, config) {
    const mask = new Uint8Array(values.length);
    for (let index = 0; index < values.length; index += 1) {
      mask[index] = !config.value_gate_enabled ||
        (values[index] >= config.value_gate_min && values[index] <= config.value_gate_max) ? 1 : 0;
    }
    return mask;
  }

  function manualBaseline(time, values, config) {
    const estimatesT = [];
    const estimatesB = [];
    const warnings = [];
    const mask = eligible(values, config);
    config.manual_dark_regions.forEach(function (region, regionIndex) {
      const candidates = [];
      for (let index = 0; index < time.length; index += 1) {
        if (time[index] >= region.start_s && time[index] < region.end_s && mask[index]) {
          candidates.push(values[index]);
        }
      }
      if (!candidates.length) {
        warnings.push("Dark region " + (regionIndex + 1) + " contains no eligible samples and was skipped.");
        return;
      }
      estimatesT.push(region.center_s);
      estimatesB.push(math.median(candidates));
    });

    const degree = config.manual_region_fit === "constant" ? 0 :
      (config.manual_region_fit === "linear" ? 1 : 2);
    if (estimatesT.length < degree + 1) {
      throw new Error(
        config.manual_region_fit[0].toUpperCase() + config.manual_region_fit.slice(1) +
        " baseline fit requires at least " + (degree + 1) + " valid regions."
      );
    }

    let baseline;
    if (degree === 0) {
      baseline = new Float64Array(time.length);
      baseline.fill(math.median(estimatesB));
    } else {
      baseline = math.polynomialFitEvaluate(estimatesT, estimatesB, degree, time);
    }
    return { baseline, warnings, candidateCount: estimatesT.length };
  }

  function effectiveRollingQuantile(config) {
    return config.response_direction === "negative"
      ? config.rolling_quantile
      : 1 - config.rolling_quantile;
  }

  function rollingBaseline(time, values, config) {
    const mask = eligible(values, config);
    const start = time[0];
    const stop = time[time.length - 1];
    const edges = [];
    let stepIndex = 0;
    const upper = stop + config.rolling_window_s;
    while (start + stepIndex * config.rolling_window_s < upper) {
      edges.push(start + stepIndex * config.rolling_window_s);
      stepIndex += 1;
      if (stepIndex > 10000000) throw new Error("Rolling window generated too many time bins.");
    }
    if (edges.length < 2 || edges[edges.length - 1] < stop) edges.push(stop);

    const anchorT = [];
    const anchorB = [];
    const warnings = [];
    const q = effectiveRollingQuantile(config);

    for (let bin = 0; bin < edges.length - 1; bin += 1) {
      const left = edges[bin], right = edges[bin + 1];
      const candidateTimes = [], candidateValues = [];
      for (let index = 0; index < time.length; index += 1) {
        const inside = time[index] >= left &&
          (right < stop ? time[index] < right : time[index] <= right);
        if (inside && mask[index]) {
          candidateTimes.push(time[index]);
          candidateValues.push(values[index]);
        }
      }
      if (!candidateTimes.length) {
        warnings.push("No eligible dark candidates in time bin " + left + "–" + right + " s.");
        continue;
      }
      anchorT.push(math.median(candidateTimes));
      anchorB.push(math.quantile(candidateValues, q));
    }

    if (!anchorT.length) throw new Error("Rolling quantile produced no eligible dark-current candidates.");

    let baseline;
    if (config.rolling_trend === "piecewise_linear" || anchorT.length === 1) {
      baseline = math.interpolateLinear(anchorT, anchorB, time);
    } else {
      const degree = config.rolling_trend === "linear" ? 1 : 2;
      if (anchorT.length < degree + 1) {
        throw new Error(
          config.rolling_trend[0].toUpperCase() + config.rolling_trend.slice(1) +
          " rolling trend requires at least " + (degree + 1) + " populated bins."
        );
      }
      baseline = math.polynomialFitEvaluate(anchorT, anchorB, degree, time);
      for (let index = 0; index < time.length; index += 1) {
        if (time[index] < anchorT[0]) baseline[index] = anchorB[0];
        else if (time[index] > anchorT[anchorT.length - 1]) baseline[index] = anchorB[anchorB.length - 1];
      }
    }
    return { baseline, warnings, candidateCount: anchorT.length };
  }

  function prepareSignal(data, signal, inputConfig) {
    const config = normalizeConfig(inputConfig);
    if (!data || !data.signals || !Object.prototype.hasOwnProperty.call(data.signals, signal)) {
      throw new Error("Unknown signal " + JSON.stringify(signal) + ".");
    }
    const time = Float64Array.from(data.timeS);
    const sourceValues = Float64Array.from(data.signals[signal]);
    if (!time.length) throw new Error("Cannot prepare an empty signal.");

    if (config.dark_correction_mode === MODES.NONE) {
      const values = Float64Array.from(sourceValues, function (value) {
        return config.invert_signal ? -value : value;
      });
      return Object.freeze({
        time_s: time,
        values,
        source_signal: signal,
        baseline: null,
        warnings: Object.freeze([]),
        metadata: Object.freeze({
          mode: "none",
          apply_baseline: false,
          invert_signal: config.invert_signal
        }),
        config
      });
    }

    let model;
    if (config.dark_correction_mode === MODES.CONSTANT) {
      const baseline = new Float64Array(sourceValues.length);
      baseline.fill(config.constant_baseline);
      let candidateCount = 0;
      const mask = eligible(sourceValues, config);
      for (const item of mask) candidateCount += item;
      model = { baseline, warnings: [], candidateCount };
    } else if (config.dark_correction_mode === MODES.MANUAL) {
      model = manualBaseline(time, sourceValues, config);
    } else {
      model = rollingBaseline(time, sourceValues, config);
    }

    const prepared = new Float64Array(sourceValues.length);
    for (let index = 0; index < sourceValues.length; index += 1) {
      let value = config.apply_baseline ? sourceValues[index] - model.baseline[index] : sourceValues[index];
      if (config.invert_signal) value = -value;
      prepared[index] = value;
    }

    const metadata = {
      mode: config.dark_correction_mode,
      output_convention: config.output_convention,
      apply_baseline: config.apply_baseline,
      invert_signal: config.invert_signal,
      candidate_count: model.candidateCount,
      baseline_start: model.baseline[0],
      baseline_end: model.baseline[model.baseline.length - 1]
    };
    if (config.dark_correction_mode === MODES.ROLLING) {
      metadata.response_direction = config.response_direction;
      metadata.effective_dark_quantile = effectiveRollingQuantile(config);
    }

    return Object.freeze({
      time_s: time,
      values: prepared,
      source_signal: signal,
      baseline: Float64Array.from(model.baseline),
      warnings: Object.freeze(model.warnings.slice()),
      metadata: Object.freeze(metadata),
      config
    });
  }

  api.preparation = Object.freeze({
    MODES,
    normalizeConfig,
    effectiveRollingQuantile,
    prepareSignal
  });
})(typeof window !== "undefined" ? window : globalThis);
