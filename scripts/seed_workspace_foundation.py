"""Project the local Node seed into the existing Hospital/Admin and scan records."""

import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import select

from hospital_portal.api import schema as s
from hospital_portal.api.db import database
from hospital_portal.api.ultrasound import Ultrasound

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".local"
SYNTHETIC = {"synthetic": True, "source": "workspace-foundation-v1"}
FRAMES = ("brain_1012.png", "abdomen_1427.png", "femur_1135.png",
          "profile_14.png", "thorax_1466.png", "brain_1013.png")


def insert_once(conn, table, source_id, **values):
    found = conn.execute(select(table.c.id).where(table.c.source_id == source_id)).scalar_one_or_none()
    if found is not None:
        if "id" in values and UUID(found) != UUID(values["id"]):
            raise RuntimeError(f"Source link mismatch for {source_id}")
        return found
    return conn.execute(table.insert().values(source_id=source_id, **values).returning(table.c.id)).scalar_one()


def scan(conn, patient, doctor, service):
    code = patient["code"] + "-scan"
    if conn.execute(select(s.ultrasound_workspace_scan.c.id).where(
        s.ultrasound_workspace_scan.c.source_id == code
    )).first():
        return
    pending = patient.get("scan") == "pending"
    visit = patient["visits"][2 if pending else 1]
    created = datetime.fromisoformat(visit["date"] + "T10:30:00+05:30").astimezone(timezone.utc)
    image = (ROOT / "frontend/assets/ultrasound-demo" / FRAMES[patient["index"] % len(FRAMES)]).read_bytes()
    scan_id = str(uuid4())
    released = None if pending else created + timedelta(hours=4)
    insert_once(conn, s.ultrasound_workspace_scan, code, id=scan_id,
        patient_account_id=patient["id"], doctor_account_id=doctor["id"],
        facility_ref=doctor["facility"]["facility_id"], episode=patient["lmp"],
        image_ciphertext=service.encrypt(scan_id, image), image_digest=hashlib.sha256(image).hexdigest(),
        image_expires_at=datetime.now(timezone.utc) + timedelta(days=service.retention),
        pregnancy_context={"lmp": patient["lmp"], "edd": patient["edd"],
            "gestation_weeks": visit["week"], "scan_date": visit["date"], "stage": "pregnant",
            "workspace_appointment_id": visit["id"], "demo": True},
        analysis={"state": "model_unavailable", "reasons": [],
            "measurements": {"demo": True, "teaching_frame": True, "note": "Teaching frame from the credited example assets."}},
        revision=3 if released else 1, created_at=created,
        started_at=created + timedelta(hours=2) if released else None,
        reviewed_at=created + timedelta(hours=3) if released else None, released_at=released,
        decision="review_complete" if released else None,
        review_note="Synthetic review workflow demonstration." if released else None,
        findings="Synthetic record. This teaching frame has no patient-specific findings." if released else None,
        instructions="See the synthetic patient's antenatal follow-up in the care timeline." if released else None)


def project_patient(conn, patient, doctor, service, snapshot_date):
    code = patient["code"]
    facility = doctor["facility"]
    mid = patient["portalId"]
    pid = insert_once(conn, s.patient, code, facility_id=facility["facility_id"], name=patient["name"], subject_type="mother")
    insert_once(conn, s.mother, code, id=mid, patient_id=pid, registered_facility_id=facility["facility_id"],
        assigned_unit_id=facility["unit_id"], assigned_doctor_id=doctor["portalId"],
        uhid=code.upper(), age=patient["age"], edd=patient["edd"], gestation_weeks=patient["week"], blood_group=patient["blood"],
        consent_flags={"synthetic_demo":True, "care_coordination":True, "clinical_monitoring":True},
        details={**SYNTHETIC, "name":patient["name"], "workspace_patient_id":patient["id"], "lmp":patient["lmp"], "stage":"Pregnant",
                 "workspace_snapshot_date":snapshot_date, "plurality":"singleton",
                 "prepregnancy_bmi":round(patient["prepregnancy_weight_kg"] / (patient["height"] / 100) ** 2, 1),
                 "risk_factors":patient.get("risks", [])})
    for visit in patient["visits"]:
        source = f"{code}-visit-{visit['week']}"
        insert_once(conn, s.anc_visit, source, mother_id=mid, doctor_id=doctor["portalId"],
            facility_id=facility["facility_id"], visit_date=visit["date"],
            details={**SYNTHETIC, **visit["values"], "workspace_appointment_id":visit["id"],
                     "gestational_week_at_visit":visit["week"], "note":visit["note"]})
        report = visit["report"]
        for index, lab in enumerate(report["observations"]):
            lab_source = f"{source}-lab-{index}"
            test = lab["label"]
            order = insert_once(conn, s.investigation_order, lab_source, mother_id=mid,
                facility_id=facility["facility_id"], test=test, status="completed", due_date=visit["date"],
                details={**SYNTHETIC, "completed_date":visit["date"], "workspace_appointment_id":visit["id"]})
            context = {"OGTT fasting":"fasting", "OGTT 1 hour":"postprandial_1h", "OGTT 2 hour":"postprandial_2h"}.get(test)
            insert_once(conn, s.investigation_result, lab_source, order_id=order, uploaded_by=doctor["portalId"],
                values={**SYNTHETIC, "status":"final", "reported_on":visit["date"], "measured_on":lab["measured_on"],
                    "result_value":lab["value"], "unit":lab["unit"], "reference_range":lab.get("reference_range"),
                    "workspace_document_id":report["document_id"], "workspace_verified_report_id":report["verified_id"],
                    **({"protocol":"75 g OGTT", "glucose_context":context} if context else {})})
    if patient.get("pendingDate"):
        insert_once(conn, s.investigation_order, code + "-pending-ogtt", mother_id=mid,
            facility_id=facility["facility_id"], test="Gestational diabetes screening (OGTT)",
            status="pending", due_date=patient["pendingDate"], details=SYNTHETIC)
    if patient.get("missedDate"):
        insert_once(conn, s.care_gap, code + "-missed-anc", mother_id=mid,
            expected_item="Missed antenatal follow-up", due_date=patient["missedDate"],
            status="missed", details={**SYNTHETIC, "source_table":"anc_expected"})
    scan(conn, patient, doctor, service)


def main():
    expected_url = "sqlite:///" + str(STATE / "portal.db")
    if (os.environ.get("DAI_SEED_WORKSPACE_FOUNDATION") != "true" or
        os.environ.get("DAI_LOCAL") != "true" or os.environ.get("DAI_DEMO") != "true" or
        os.environ.get("DAI_HOSTED_DEMO") == "true" or os.environ.get("DAI_CONTAINER_DEMO") == "true" or
        os.environ.get("DATABASE_URL") != expected_url):
        raise RuntimeError("Workspace fixtures require the launcher-managed local synthetic database")
    data = json.loads((STATE / "workspace-foundation.json").read_text())
    if data["version"] != SYNTHETIC["source"]:
        raise RuntimeError("Unexpected workspace fixture version")
    service = Ultrasound(os.environ)
    if not service.enabled:
        raise RuntimeError("Enable the local ultrasound workspace before seeding the cohort")
    engine = database(expected_url)
    with engine.begin() as conn:
        demo_hash = conn.execute(select(s.user.c.password_hash).where(
            s.user.c.source_id == "demo:consultant")).scalar_one_or_none()
        if not demo_hash:
            raise RuntimeError("Import the existing synthetic portal cohort before seeding the workspace")
        for doctor in data["doctors"]:
            facility = doctor["facility"]
            insert_once(conn, s.user, doctor["code"], id=doctor["portalId"],
                facility_id=facility["facility_id"], department_id=facility["department_id"], unit_id=facility["unit_id"],
                name=doctor["name"], email=doctor["code"] + "@dai-synthetic.invalid", role="consultant",
                registration_no=doctor["license"], verified=True, password_hash=demo_hash,
                details={**SYNTHETIC, "demo":True, "qualification":doctor["qualification"],
                         "specialty":doctor["specialty"], "availability":doctor["availability"]})
        for patient in data["patients"]:
            project_patient(conn, patient, data["doctors"][patient["doctor"]], service, data["today"])
    print(f"Workspace foundation: linked {len(data['patients'])} maternal records to Hospital/Admin and Ultrasound Review.")


if __name__ == "__main__":
    main()
