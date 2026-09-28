from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
PACKAGE = DIST / "HM-Map-Reconstruction-offline.zip"
MANIFEST = DIST / "offline-package.json"

FILES = [
    ROOT / "index.html",
    ROOT / "styles.css",
    ROOT / "README.md",
    *sorted((ROOT / "src").glob("*.js")),
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    missing = [path for path in FILES if not path.is_file()]
    if missing:
        raise SystemExit("Missing offline package files: " + ", ".join(str(p) for p in missing))

    DIST.mkdir(exist_ok=True)
    if PACKAGE.exists():
        PACKAGE.unlink()

    with zipfile.ZipFile(PACKAGE, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in FILES:
            archive.write(path, path.relative_to(ROOT).as_posix())

    payload = {
        "filename": PACKAGE.name,
        "bytes": PACKAGE.stat().st_size,
        "sha256": sha256(PACKAGE),
        "files": [path.relative_to(ROOT).as_posix() for path in FILES],
        "entrypoint": "index.html",
        "runtime": "static-browser",
        "network_required": False,
    }
    MANIFEST.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
