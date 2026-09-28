(function (root) {
  "use strict";

  const api = root.MapReconstructionWeb = root.MapReconstructionWeb || {};

  function displayUnit(label, unit, scale) {
    const safeScale = Number(scale == null ? 1 : scale);
    if (!Number.isFinite(safeScale) || safeScale <= 0) {
      throw new Error("Display-unit scale must be finite and greater than zero.");
    }
    return Object.freeze({
      label: String(label || "Signal"),
      unit: String(unit || ""),
      scale: safeScale,
      axisLabel: unit ? String(label || "Signal") + " (" + unit + ")" : String(label || "Signal"),
    });
  }

  function scientificUnitForSignal(signalName) {
    if (signalName === "Current_A") return "A";
    if (signalName === "Voltage_V") return "V";
    return "";
  }

  function engineeringUnit(label, baseUnit, values, candidates) {
    if (values == null) {
      return baseUnit === "A"
        ? displayUnit(label, "µA", 1e6)
        : displayUnit(label, baseUnit, 1);
    }
    let magnitude = 0;
    for (const raw of values) {
      const value = Number(raw);
      if (Number.isFinite(value)) magnitude = Math.max(magnitude, Math.abs(value));
    }
    for (let index = 0; index < candidates.length; index += 1) {
      const [unit, scale] = candidates[index];
      if (magnitude * scale >= 1 || index === candidates.length - 1) {
        return displayUnit(label, unit, scale);
      }
    }
    return displayUnit(label, baseUnit, 1);
  }

  function displayUnitForSignal(signalName, values) {
    if (signalName === "Current_A") {
      return engineeringUnit("Current", "A", values, [
        ["A", 1], ["mA", 1e3], ["µA", 1e6], ["nA", 1e9], ["pA", 1e12],
      ]);
    }
    if (signalName === "Voltage_V") {
      return engineeringUnit("Voltage", "V", values, [
        ["V", 1], ["mV", 1e3], ["µV", 1e6],
      ]);
    }
    return displayUnit(signalName || "Signal", "", 1);
  }

  function toDisplayValues(values, unit) {
    const scale = unit && Number.isFinite(unit.scale) ? unit.scale : 1;
    return Float64Array.from(values || [], value => Number(value) * scale);
  }

  function general6(value) {
    if (!Number.isFinite(value)) return String(value);
    if (value === 0) return "0";
    return Number(value.toPrecision(6)).toString();
  }

  function formatDisplayValue(value, unit) {
    const current = unit || displayUnit("Signal", "", 1);
    const suffix = current.unit ? " " + current.unit : "";
    return general6(Number(value) * current.scale) + suffix;
  }

  api.displayUnits = Object.freeze({
    displayUnit,
    scientificUnitForSignal,
    displayUnitForSignal,
    toDisplayValues,
    formatDisplayValue,
  });
})(typeof window !== "undefined" ? window : globalThis);
