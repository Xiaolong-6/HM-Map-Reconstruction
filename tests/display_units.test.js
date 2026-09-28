const test = require("node:test");
const assert = require("node:assert/strict");
require("../src/shared.js");
require("../src/display_units.js");
const u = globalThis.MapReconstructionWeb.displayUnits;

test("current engineering unit is display-only", () => {
  const source = Float64Array.from([-103e-6, 0, 125e-6]);
  const before = Array.from(source);
  const unit = u.displayUnitForSignal("Current_A", source);
  assert.equal(unit.axisLabel, "Current (µA)");
  assert.equal(unit.scale, 1e6);
  assert.deepEqual(Array.from(u.toDisplayValues(source, unit)), [-103, 0, 125]);
  assert.deepEqual(Array.from(source), before);
  assert.equal(u.formatDisplayValue(-103e-6, unit), "-103 µA");
});

test("voltage and unknown signals keep Python engineering rules", () => {
  assert.equal(u.displayUnitForSignal("Voltage_V").axisLabel, "Voltage (V)");
  assert.equal(u.displayUnitForSignal("Voltage_V", [0.2]).axisLabel, "Voltage (mV)");
  assert.equal(u.displayUnitForSignal("Auxiliary").axisLabel, "Auxiliary");
  assert.equal(u.scientificUnitForSignal("Current_A"), "A");
  assert.equal(u.scientificUnitForSignal("Voltage_V"), "V");
  assert.equal(u.scientificUnitForSignal("Auxiliary"), "");
});
