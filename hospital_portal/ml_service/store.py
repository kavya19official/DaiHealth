"""Serve immutable JSON reports. Never unpickle a model through an HTTP request."""

import hashlib
import json
import os
import re
from pathlib import Path

DEFAULT_ARTIFACTS = Path(__file__).resolve().parent / "artifacts"


class ForecastUnavailable(Exception):
    pass


def artifact_root():
    return Path(os.getenv("DAI_ML_ARTIFACT_DIR", str(DEFAULT_ARTIFACTS)))


def manifest(root=None):
    root = Path(root or artifact_root())
    try:
        pointer = json.loads((root / "current.json").read_text())
        version = pointer["version"]
        if not re.fullmatch("[a-f0-9]{16}", version):
            raise ValueError("Invalid artifact version")
        result = json.loads((root / version / "manifest.json").read_text())
        if result["version"] != version:
            raise ValueError("Artifact version mismatch")
        return result
    except (OSError, ValueError, KeyError) as exc:
        raise ForecastUnavailable(
            "No valid trained forecast. Run python -m hospital_portal.ml_service.train --persist from the repository root."
        ) from exc


def forecast(hospital_id, root=None):
    if not re.fullmatch(r"HOSP-SYN-\d{4}", hospital_id):
        raise ForecastUnavailable("Invalid source hospital identifier")
    root = Path(root or artifact_root())
    info = manifest(root)
    filename = hospital_id + ".json"
    try:
        raw = (root / info["version"] / filename).read_bytes()
        if hashlib.sha256(raw).hexdigest() != info["files"][filename]:
            raise ValueError("Forecast checksum mismatch")
        report = json.loads(raw)
        if (
            report["hospital_id"] != hospital_id
            or report["model_version"] != info["version"]
        ):
            raise ValueError("Forecast identity mismatch")
    except (OSError, ValueError, KeyError) as exc:
        raise ForecastUnavailable(
            "This hospital forecast is missing or failed integrity checks. Retrain the synthetic model artifacts."
        ) from exc
    return {
        **report,
        "provenance": {
            "source_sha256": info["source_sha256"],
            "history_rows": info["history_rows"],
            "facility_count": info["facility_count"],
            "sklearn_version": info["sklearn_version"],
            "scope": info["scope"],
        },
    }
