"""Backend tests — stdlib `unittest`, no extra dependency.

    cd backend && python -m unittest discover -s tests -t .

Importing this package points every store at a throwaway directory **before**
`app.db.paths` is imported, because paths are read from the environment once,
at import. Nothing a test does can touch `data/` or `config/`: the sensor
database is a small deterministic fixture (`fixtures.py`), the audit and chat
stores are empty, and the config directory holds only what a test writes —
so the knowledge graph falls back to the seed copy shipped with the code.

`DAEDALUS_TZ=UTC` makes "at 10:00" mean 10:00 in the stored timestamps, so a
test's expectations do not depend on the machine it runs on.
"""

import os
import tempfile

_ROOT = tempfile.mkdtemp(prefix="daedalus-tests-")
os.environ["DAEDALUS_DATA_DIR"] = _ROOT
os.environ["DAEDALUS_LOG_DIR"] = os.path.join(_ROOT, "logs")
os.environ["DAEDALUS_PREFS_DB"] = os.path.join(_ROOT, "prefs.db")
os.environ["DAEDALUS_CONFIG_DIR"] = os.path.join(_ROOT, "config")
os.environ["DAEDALUS_TZ"] = "UTC"
os.makedirs(os.environ["DAEDALUS_CONFIG_DIR"], exist_ok=True)

TEST_ROOT = _ROOT
