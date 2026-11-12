"""Import a CSV saved from MainUI_v3's Data tab (the Save button).

The backup for the live link: a run where the link was down or not set up.
Same path into the database as the link (`sensor_store.ingest`), so all-zero
rows are skipped and rows already stored are left alone.

    python -m app.db.import_rig_csv path/to/data.csv [more.csv ...]

The HMI writes local wall-clock time with no zone. `DAEDALUS_RIG_TZ` names the
rig PC's zone (e.g. Asia/Kuala_Lumpur); empty uses this machine's zone. The
zone used is printed, so a wrong one shows at once.
"""

from __future__ import annotations

import csv
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from . import sensor_store

# MainUI_v3 `update_table` headers → sensor_readings columns.
COLUMNS = {"T-101[C]": "temp_c", "P-101[barg]": "pressure_barg", "pH-101[-]": "ph", "CO2[ppm]": "co2_ppm"}
KNOWN_MODES = {"Manual", "Absorption", "Desorption"}


def _zone():
    name = os.environ.get("DAEDALUS_RIG_TZ", "").strip()
    return ZoneInfo(name) if name else datetime.now().astimezone().tzinfo


def _number(text: str) -> float | None:
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


# MainUI writes ISO dates; a CSV re-saved in Excel comes back day-first (25/7/2025).
DATE_FORMATS = ("%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M:%S")


def _local(text: str) -> datetime:
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            pass
    raise ValueError(f"unrecognised date/time {text!r}")


def rows(path: Path, zone) -> list[dict]:  # noqa: ANN001
    out = []
    with path.open(newline="", encoding="utf-8-sig") as f:
        for line in csv.DictReader(f):
            if not (line.get("Date") or "").strip():  # Excel leaves blank trailing rows
                continue
            local = _local(f"{line['Date'].strip()} {line['Time'].strip()}").replace(tzinfo=zone)
            out.append({
                "timestamp": local.astimezone(timezone.utc).isoformat(),
                "mode": (line.get("Mode") or "").strip() or None,
                **{column: _number(line.get(header)) for header, column in COLUMNS.items()},
            })
    return out


def main(paths: list[str]) -> int:
    if not paths:
        print(__doc__)
        return 2
    zone, device = _zone(), sensor_store.device_id()
    print(f"rig time zone: {zone}   device: {device}")
    for name in paths:
        found = rows(Path(name), zone)
        for mode in sorted({r["mode"] for r in found if r["mode"] and r["mode"] not in KNOWN_MODES}):
            print(f"  warning: new mode {mode!r}, stored as-is")
        result = sensor_store.ingest(found, device)
        print(f"{name}: {result['inserted']} new, {result['duplicates']} already stored, "
              f"{result['skipped_zero']} all-zero skipped")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
