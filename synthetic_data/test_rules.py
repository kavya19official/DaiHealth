"""Small invariants plus an adversarial exported-dataset audit (unittest)."""

import argparse
import contextlib
import io
import json
import shutil
import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path
from core import ROOT, config_load, ddl, derive_gaps, stage, vaccine_due, haversine

DATASET = ROOT / "output"


class ScheduleAndConstraintTests(unittest.TestCase):
    def test_calendar_month_not_thirty_day_shortcut(self):
        self.assertEqual(
            vaccine_due({"date_of_birth": "2024-05-31"}, ["MR1", 0, 9]),
            date(2025, 2, 28),
        )
        self.assertEqual(
            vaccine_due({"date_of_birth": "2024-01-01"}, ["Penta1", 42, 0]),
            date(2024, 2, 12),
        )

    def test_concluded_gestation_and_postpartum_stage(self):
        p = {
            "lmp": "2025-01-01",
            "outcome_date": "2025-10-01",
            "labour_started_at": None,
        }
        self.assertEqual(stage(p, date(2025, 10, 20)), "Postpartum 0-6wk")

    def test_rejects_orphans_and_double_current_bed(self):
        db = sqlite3.connect(":memory:")
        db.executescript(ddl())
        self.assertEqual(db.execute("PRAGMA foreign_keys").fetchone()[0], 1)
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute(
                "INSERT INTO mothers (mother_id,registered_hospital_id,assigned_obgyn_id) VALUES ('missing','missing','missing')"
            )
        db.execute(
            "INSERT INTO patients VALUES ('P-SYN-1','background_inpatient','SYNTHETIC',1)"
        )
        db.execute(
            "INSERT INTO hospitals (hospital_id,name,tier) VALUES ('H-SYN-1','SYNTHETIC','PHC')"
        )
        db.execute(
            "INSERT INTO wards (ward_id,hospital_id) VALUES ('W-SYN-1','H-SYN-1')"
        )
        db.execute(
            "INSERT INTO beds (bed_id,ward_id,status,current_patient_id) VALUES ('B-SYN-1','W-SYN-1','occupied','P-SYN-1')"
        )
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute(
                "INSERT INTO beds (bed_id,ward_id,status,current_patient_id) VALUES ('B-SYN-2','W-SYN-1','occupied','P-SYN-1')"
            )
        db.close()

    def test_gap_is_derived_and_late_completion_closes_it(self):
        cfg = config_load()
        d = {
            k: []
            for k in (
                "pregnancies",
                "anc_expected",
                "anc_visits",
                "postpartum_expected",
                "postpartum_visits",
                "investigations",
                "vaccinations",
                "risk_flags",
            )
        }
        d["pregnancies"] = [{"pregnancy_id": "P1", "mother_id": "M1"}]
        d["anc_expected"] = [
            {
                "expected_id": "E1",
                "pregnancy_id": "P1",
                "gestational_week": 12,
                "due_date": "2026-09-01",
            }
        ]
        gap = derive_gaps(d, cfg)[0]
        self.assertEqual(gap["status"], "open")
        d["anc_visits"] = [{"expected_id": "E1", "visit_date": "2026-09-05"}]
        closed = derive_gaps(d, cfg)[0]
        self.assertEqual(gap["gap_id"], closed["gap_id"])
        self.assertEqual(closed["closed_on"], "2026-09-05")

    def test_haversine_known_zero_and_symmetry(self):
        self.assertEqual(haversine(28, 77, 28, 77), 0)
        self.assertAlmostEqual(haversine(28, 77, 26, 80), haversine(26, 80, 28, 77))


class ExportedDatasetAdversarialTests(unittest.TestCase):
    def test_validator_detects_independent_corruption(self):
        if not (DATASET / "dai.db").exists():
            self.skipTest("Generate a dataset first or pass --dataset PATH")
        from validate import validate_output

        with tempfile.TemporaryDirectory(prefix="dai-audit-") as tmp:
            root = Path(tmp)
            shutil.copy2(DATASET / "dai.db", root / "dai.db")
            for name in ("config.snapshot.json", "manifest.json", "schema.sql"):
                shutil.copy2(DATASET / name, root / name)
            (root / "csv").symlink_to(
                (DATASET / "csv").resolve(), target_is_directory=True
            )
            db = sqlite3.connect(root / "dai.db")
            db.execute(
                "UPDATE pregnancies SET clinical_hb=12.5 WHERE pregnancy_id=(SELECT pregnancy_id FROM pregnancies WHERE conditions LIKE '%anaemia_severe%' LIMIT 1)"
            )
            db.execute(
                "DELETE FROM care_gaps WHERE gap_id=(SELECT gap_id FROM care_gaps LIMIT 1)"
            )
            db.execute(
                "UPDATE doctors SET max_daily_patients=0 WHERE doctor_id=(SELECT doctor_id FROM appointments LIMIT 1)"
            )
            db.execute(
                "UPDATE emergency_events SET distance_km=distance_km+100 WHERE event_id=(SELECT event_id FROM emergency_events LIMIT 1)"
            )
            db.commit()
            db.close()
            with contextlib.redirect_stdout(io.StringIO()):
                passed = validate_output(root)
            self.assertFalse(passed)
            report = json.loads((root / "validation_report.json").read_text())["rules"]
            for rule in ("8", "11", "14", "15", "formats"):
                self.assertGreater(report[rule]["failures"], 0, rule)
            self.assertEqual(report["1"]["failures"], 0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=DATASET)
    opts, rest = parser.parse_known_args()
    DATASET = opts.dataset
    unittest.main(argv=["test_rules.py"] + rest)
