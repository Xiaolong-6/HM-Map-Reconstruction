from pathlib import Path

from map_reconstruction.project_io import (
    PROJECT_SCHEMA,
    PROJECT_SCHEMA_V2,
    PROJECT_SCHEMA_V3,
    load_project,
)

root = Path(__file__).resolve().parents[1] / "tests" / "oracle"
expected = {
    "web_v1.hmmap": PROJECT_SCHEMA,
    "web_v2.hmmap": PROJECT_SCHEMA_V2,
    "web_v3.hmmap": PROJECT_SCHEMA_V3,
}
for filename, schema in expected.items():
    loaded = load_project(root / filename)
    assert loaded.project_metadata["schema"] == schema
    assert loaded.state.signal == "Current_A"
    assert loaded.state.original_filename == "oracle.csv"
    assert loaded.raw_csv_bytes.startswith(b"\xef\xbb\xbf# schema,single-v2")
