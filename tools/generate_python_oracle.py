from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from map_reconstruction.importers.happymeasure import import_happymeasure_csv_bytes
from map_reconstruction.display_units import display_unit_for_signal, format_display_value
from map_reconstruction.methods.dual_offset import reconstruct_map, solve_timing
from map_reconstruction.methods.phase_window import (
    convert_legacy_to_phase_window,
    reconstruct_phase_window_map,
    solve_phase_window_timing,
)
from map_reconstruction.models import (
    Aggregation,
    DualOffsetParams,
    PhaseWindowParams,
    ScanPattern,
    TimeSeriesData,
    WindowMode,
)
from map_reconstruction.preparation import (
    DarkCorrectionMode,
    DarkRegion,
    ManualRegionFit,
    OutputConvention,
    PhotocurrentPolarity,
    RollingTrend,
    SignalPreparationConfig,
    prepare_signal,
)
from map_reconstruction.processing import (
    BaselineMode,
    MapProcessingConfig,
    NormalizationMode,
    ValueScale,
    ValueTransform,
    compute_color_limits,
    process_map,
)
from map_reconstruction.project_io import ProjectState, save_project
from map_reconstruction.qc.distribution import HistogramBinMode, HistogramConfig, make_histogram_data


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "oracle"
OUT.mkdir(parents=True, exist_ok=True)


def enc_number(value: float) -> float | str:
    value = float(value)
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"
    return value


def enc_array(values) -> list[float | str]:
    return [enc_number(value) for value in np.asarray(values, dtype=float).ravel()]


raw_text = "\ufeff" + "\r\n".join(
    [
        "# schema,single-v2",
        '# metadata,"{""operator"":""A, B"",""mode"":""time""}"',
        "# section,data",
        "Elapsed_s,Current_A,Voltage_V",
        "2,20,0.20",
        "1,10,0.10",
        "1,11,0.11",
    ]
)
raw_bytes = raw_text.encode("utf-8")
csv_data = import_happymeasure_csv_bytes(raw_bytes, "oracle.csv")

constant_input = TimeSeriesData(
    np.arange(3, dtype=float),
    {"Current_A": np.asarray([-10.0, -12.0, -8.0])},
)
constant_config = SignalPreparationConfig(
    dark_correction_mode=DarkCorrectionMode.CONSTANT,
    constant_baseline=-10.0,
    output_convention=OutputConvention.DARK_MINUS_MEASURED,
)
constant_result = prepare_signal(constant_input, "Current_A", constant_config)

manual_input = TimeSeriesData(
    np.arange(6, dtype=float),
    {"Current_A": np.asarray([-5.0, -5.0, -5.0, -7.0, -7.0, -7.0])},
)
manual_config = SignalPreparationConfig(
    dark_correction_mode=DarkCorrectionMode.MANUAL_REGIONS,
    manual_dark_regions=(DarkRegion(0.0, 1.0), DarkRegion(3.0, 5.0)),
    manual_region_fit=ManualRegionFit.LINEAR,
)
manual_result = prepare_signal(manual_input, "Current_A", manual_config)

rolling_time = np.asarray([0.0, 0.2, 2.0, 2.1, 5.0])
rolling_values = np.asarray([-10.0, -9.0, -8.0, -7.0, -6.0])
rolling_input = TimeSeriesData(rolling_time, {"Current_A": rolling_values})
rolling_config = SignalPreparationConfig(
    dark_correction_mode=DarkCorrectionMode.ROLLING_QUANTILE,
    rolling_window_s=2.0,
    rolling_quantile=0.9,
    response_direction=PhotocurrentPolarity.NEGATIVE,
    rolling_trend=RollingTrend.PIECEWISE_LINEAR,
)
rolling_result = prepare_signal(rolling_input, "Current_A", rolling_config)

dual_params = DualOffsetParams(
    rows=3,
    cols=4,
    row_a_s=20.0,
    row_b_s=50.0,
    rows_apart=3,
    row_offset=2,
    point_a_s=12.5,
    point_b_s=15.5,
    points_apart=6,
    point_offset=1,
)
dual_timing = solve_timing(dual_params)

phase_params = PhaseWindowParams(
    rows=1,
    cols=1,
    row_a_s=0.0,
    row_b_s=10.0,
    rows_apart=1,
    row_offset=0,
    y_phase_fraction=0.0,
    point_a_s=1.0,
    point_b_s=4.0,
    points_apart=3,
    x_period_offset=1,
    x_phase_fraction=0.5,
    window_mode=WindowMode.FRACTION,
    window_fraction=0.5,
    aggregation=Aggregation.MEDIAN,
)
phase_data = TimeSeriesData(
    np.asarray([1.25, 1.5, 1.75]),
    {"Current_A": np.asarray([1.0, 2.0, 3.0])},
)
phase_result = reconstruct_phase_window_map(phase_data, "Current_A", phase_params)
phase_timing = solve_phase_window_timing(phase_params)

legacy_params = DualOffsetParams(
    rows=2,
    cols=4,
    row_a_s=10.0,
    row_b_s=30.0,
    rows_apart=2,
    row_offset=0,
    point_a_s=2.0,
    point_b_s=5.0,
    points_apart=3,
    point_offset=0,
    scan_pattern=ScanPattern.SERPENTINE,
    first_row_ltr=False,
)
legacy_time = np.arange(0.0, 30.0, 0.1) + 0.013
legacy_data = TimeSeriesData(legacy_time, {"Current_A": legacy_time.copy()})
legacy_result = reconstruct_map(legacy_data, "Current_A", legacy_params)
legacy_conversion = convert_legacy_to_phase_window(legacy_params)
legacy_phase_result = reconstruct_phase_window_map(
    legacy_data, "Current_A", legacy_conversion.params
)

process_abs = process_map(
    np.asarray([[-12.0, -8.0]]),
    MapProcessingConfig(
        baseline_mode=BaselineMode.MANUAL,
        baseline_value=-10.0,
        transform=ValueTransform.ABSOLUTE,
    ),
)
process_minmax = process_map(
    np.asarray([[2.0, 4.0, 6.0]]),
    MapProcessingConfig(normalization=NormalizationMode.MIN_MAX),
)
process_log = process_map(
    np.asarray([[100.0, 10.0, 1.0, 0.0, -1.0]]),
    MapProcessingConfig(value_scale=ValueScale.LOG10),
)
color_cfg = MapProcessingConfig()
color = compute_color_limits(np.asarray([[2.0, 2.0]]), color_cfg)

hist = make_histogram_data(
    np.asarray([0.0, 1.0, 2.0, 3.0, np.nan]),
    HistogramConfig(bin_mode=HistogramBinMode.COUNT, bin_count=4),
)
assert hist is not None

current_display = display_unit_for_signal(
    "Current_A", np.asarray([-103e-6, 0.0, 125e-6])
)
voltage_display = display_unit_for_signal(
    "Voltage_V", np.asarray([0.1, 0.2])
)
default_current_display = display_unit_for_signal("Current_A")
unknown_display = display_unit_for_signal("Auxiliary")

oracle = {
    "oracle": {
        "repository": "Xiaolong-6/HappyMeasure",
        "commit": "402b88f1c42cff41bf6054e1724bc62b4deb7af3",
    },
    "csv": {
        "raw_text": raw_text,
        "time_s": enc_array(csv_data.time_s),
        "signals": {name: enc_array(values) for name, values in csv_data.signals.items()},
        "metadata": csv_data.metadata,
    },
    "preparation": {
        "constant": {
            "time_s": enc_array(constant_input.time_s),
            "values_in": enc_array(constant_input.signals["Current_A"]),
            "config": {
                "dark_correction_mode": "constant",
                "constant_baseline": -10.0,
                "output_convention": "dark_minus_measured",
            },
            "values": enc_array(constant_result.values),
            "baseline": enc_array(constant_result.baseline),
            "metadata": dict(constant_result.metadata),
        },
        "manual_linear": {
            "time_s": enc_array(manual_input.time_s),
            "values_in": enc_array(manual_input.signals["Current_A"]),
            "config": {
                "dark_correction_mode": "manual_regions",
                "manual_dark_regions": [
                    {"start_s": 0.0, "end_s": 1.0},
                    {"start_s": 3.0, "end_s": 5.0},
                ],
                "manual_region_fit": "linear",
            },
            "values": enc_array(manual_result.values),
            "baseline": enc_array(manual_result.baseline),
        },
        "rolling": {
            "time_s": enc_array(rolling_time),
            "values_in": enc_array(rolling_values),
            "config": {
                "dark_correction_mode": "rolling_quantile",
                "rolling_window_s": 2.0,
                "rolling_quantile": 0.9,
                "response_direction": "negative",
                "rolling_trend": "piecewise_linear",
            },
            "values": enc_array(rolling_result.values),
            "baseline": enc_array(rolling_result.baseline),
            "metadata": dict(rolling_result.metadata),
        },
    },
    "reconstruction": {
        "dual_timing": {
            "params": {
                "rows": 3,
                "cols": 4,
                "row_a_s": 20.0,
                "row_b_s": 50.0,
                "rows_apart": 3,
                "row_offset": 2,
                "point_a_s": 12.5,
                "point_b_s": 15.5,
                "points_apart": 6,
                "point_offset": 1,
            },
            "timing": {
                "row_period_s": dual_timing.row_period_s,
                "row_ref0_s": dual_timing.row_ref0_s,
                "point_period_s": dual_timing.point_period_s,
                "pixel1_phase_s": dual_timing.pixel1_phase_s,
            },
        },
        "phase_single": {
            "time_s": enc_array(phase_data.time_s),
            "values_in": enc_array(phase_data.signals["Current_A"]),
            "params": {
                "rows": 1,
                "cols": 1,
                "row_a_s": 0.0,
                "row_b_s": 10.0,
                "rows_apart": 1,
                "row_offset": 0,
                "y_phase_fraction": 0.0,
                "point_a_s": 1.0,
                "point_b_s": 4.0,
                "points_apart": 3,
                "x_period_offset": 1,
                "x_phase_fraction": 0.5,
                "window_mode": "fraction",
                "window_fraction": 0.5,
                "aggregation": "median",
            },
            "values": enc_array(phase_result.values),
            "sample_counts": phase_result.sample_counts.ravel().tolist(),
            "timing": {
                "row_period_s": phase_timing.row_period_s,
                "point_period_s": phase_timing.point_period_s,
                "row0_s": phase_timing.row0_s,
                "first_window_center_phase_s": phase_timing.first_window_center_phase_s,
                "window_width_s": phase_timing.window_width_s,
            },
        },
        "legacy_conversion": {
            "params": {
                "rows": 2,
                "cols": 4,
                "row_a_s": 10.0,
                "row_b_s": 30.0,
                "rows_apart": 2,
                "row_offset": 0,
                "point_a_s": 2.0,
                "point_b_s": 5.0,
                "points_apart": 3,
                "point_offset": 0,
                "scan_pattern": "serpentine",
                "first_row_ltr": False,
                "use_median": True,
            },
            "values": enc_array(legacy_result.values),
            "sample_counts": legacy_result.sample_counts.ravel().tolist(),
            "phase_values": enc_array(legacy_phase_result.values),
            "phase_sample_counts": legacy_phase_result.sample_counts.ravel().tolist(),
            "window_width_s": legacy_conversion.timing.window_width_s,
        },
    },
    "display_units": {
        "current": {
            "label": current_display.label,
            "unit": current_display.unit,
            "scale": current_display.scale,
            "axis_label": current_display.axis_label,
            "formatted": format_display_value(-103e-6, current_display),
        },
        "voltage": {
            "label": voltage_display.label,
            "unit": voltage_display.unit,
            "scale": voltage_display.scale,
            "axis_label": voltage_display.axis_label,
        },
        "default_current": {
            "unit": default_current_display.unit,
            "scale": default_current_display.scale,
            "axis_label": default_current_display.axis_label,
        },
        "unknown": {
            "unit": unknown_display.unit,
            "scale": unknown_display.scale,
            "axis_label": unknown_display.axis_label,
        },
    },
    "processing": {
        "baseline_absolute": {
            "input": [-12.0, -8.0],
            "config": {
                "baseline_mode": "manual",
                "baseline_value": -10.0,
                "transform": "absolute",
            },
            "values": enc_array(process_abs.values),
            "baseline_used": process_abs.baseline_used,
        },
        "min_max": {
            "input": [2.0, 4.0, 6.0],
            "config": {"normalization": "min_max"},
            "values": enc_array(process_minmax.values),
        },
        "log10": {
            "input": [100.0, 10.0, 1.0, 0.0, -1.0],
            "config": {"value_scale": "log10"},
            "values": enc_array(process_log.values),
            "warnings": list(process_log.warnings),
        },
        "constant_color_limits": {
            "values": [2.0, 2.0],
            "minimum": color.minimum,
            "maximum": color.maximum,
        },
        "histogram": {
            "input": [0.0, 1.0, 2.0, 3.0, "NaN"],
            "config": {"bin_mode": "count", "bin_count": 4},
            "counts": hist.counts.tolist(),
            "edges": enc_array(hist.edges),
            "finite_count": hist.finite_count,
            "total_count": hist.total_count,
            "mean": hist.mean,
            "median": hist.median,
        },
    },
}

(OUT / "python_oracle.json").write_text(
    json.dumps(oracle, indent=2, sort_keys=True, allow_nan=False),
    encoding="utf-8",
)

default_processing = MapProcessingConfig()
base_state = dict(
    original_filename="oracle.csv",
    signal="Current_A",
    rows=1,
    columns=1,
    scan_pattern=ScanPattern.SAME_DIRECTION,
    first_row_ltr=True,
    aggregation="median",
    row_a_s=0.0,
    row_b_s=1.0,
    rows_apart=1,
    row_offset=0,
    point_a_s=0.0,
    point_b_s=1.0,
    points_apart=1,
    point_offset=0,
    processing=default_processing,
    flip_y=False,
)

save_project(OUT / "python_v1.hmmap", ProjectState(**base_state), raw_bytes)
save_project(
    OUT / "python_v3.hmmap",
    ProjectState(
        **base_state,
        preparation=SignalPreparationConfig(
            dark_correction_mode=DarkCorrectionMode.CONSTANT,
            constant_baseline=1.0,
            apply_baseline=False,
        ),
    ),
    raw_bytes,
)
