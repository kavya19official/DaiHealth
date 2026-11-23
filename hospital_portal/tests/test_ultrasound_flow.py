from datetime import datetime, timedelta, timezone
from io import BytesIO
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient
import numpy as np
from PIL import Image, PngImagePlugin
import pytest
from sqlalchemy import select, update

from hospital_portal.api import schema as s
from hospital_portal.api.clinical_monitor import scan_batch
from hospital_portal.api.db import database, initialize
from hospital_portal.api.security import password_hash
from hospital_portal.api.ultrasound import Ultrasound, purge_expired

TODAY = datetime.now(timezone.utc).date()


def sample(seed=1, *, metadata=None):
    image = Image.fromarray(np.random.default_rng(seed).integers(0, 256, size=(128, 128), dtype=np.uint8))
    out = BytesIO()
    info = PngImagePlugin.PngInfo()
    if metadata:
        info.add_text("description", metadata)
    image.save(out, format="PNG", pnginfo=info)
    return out.getvalue()


@pytest.fixture
def portal(tmp_path, monkeypatch):
    monkeypatch.setenv("DAI_APP_FACTORY_ONLY", "true")
    monkeypatch.setenv("DAI_DEMO", "true")
    monkeypatch.setenv("DAI_CLINICAL_MONITOR_ENABLED", "false")
    monkeypatch.setenv("DAI_ULTRASOUND_ENABLED", "true")
    monkeypatch.setenv("DAI_ULTRASOUND_IMAGE_KEY", "12" * 32)
    monkeypatch.setenv("DAI_ULTRASOUND_SERVICE_TOKEN", "fixture-token-" * 4)
    from hospital_portal.api.main import create_app

    engine = database("sqlite:///" + str(tmp_path / "portal.sqlite"))
    initialize(engine)
    with engine.begin() as conn:
        def add(table, **fields):
            identifier = str(uuid4())
            conn.execute(table.insert().values(id=identifier, **fields))
            return identifier

        def facility(name):
            return add(s.facility, name=name, tier="test", ownership="test", address="test",
                       lat=0, lng=0, authorized_beds=0, functional_beds=0)

        def clinician(email, role, fid, department, unit):
            return add(s.user, facility_id=fid, department_id=department, unit_id=unit, name=email,
                       email=email+"@test.invalid", role=role, verified=True, registration_no="fixture",
                       password_hash=password_hash("Test-Access-Password!"))

        fid, other_fid = facility("Test facility"), facility("Other facility")
        department = add(s.department, facility_id=fid, name="Obstetrics")
        other_department = add(s.department, facility_id=other_fid, name="Obstetrics")
        unit = add(s.unit, facility_id=fid, department_id=department, code="A")
        other_unit = add(s.unit, facility_id=fid, department_id=department, code="B")
        outside_unit = add(s.unit, facility_id=other_fid, department_id=other_department, code="C")
        consultant = clinician("consultant", "consultant", fid, department, unit)
        resident = clinician("resident", "resident", fid, department, unit)
        clinician("wrong-unit", "consultant", fid, department, other_unit)
        clinician("outside", "consultant", other_fid, other_department, outside_unit)
        clinician("admin", "hospital_admin", fid, department, unit)
        def mother(label, staff):
            patient = add(s.patient, facility_id=fid, subject_type="mother", name=label)
            return add(s.mother, patient_id=patient, registered_facility_id=fid, assigned_unit_id=unit,
                       assigned_doctor_id=staff, uhid=label, age=24,
                       edd=(TODAY+timedelta(days=140)).isoformat(), gestation_weeks=20,
                       details={"stage":"t2","lmp":(TODAY-timedelta(days=140)).isoformat(),"name":label},
                       consent_flags={"care_coordination":True,"clinical_monitoring":True})
        mid, neighbor = mother("Review fixture", resident), mother("Unassigned fixture", consultant)
        add(s.anc_visit, mother_id=mid, doctor_id=consultant, facility_id=fid,
            visit_date=TODAY.isoformat(), details={"bp_systolic":162,"bp_diastolic":110,"weight_kg":67,
                        "glucose":96,"glucose_unit":"mg/dL","glucose_context":"fasting"})
    yield create_app, engine, mid, neighbor
    engine.dispose()


def login(client, who):
    challenge = client.post("/api/auth/login", json={
        "email":who+"@test.invalid", "password":"Test-Access-Password!",
    }).json()
    response = client.post("/api/auth/otp", json={
        "challenge_id":challenge["challenge_id"], "code":challenge["demo_otp"],
    })
    assert response.status_code == 200, response.text
    return {"Authorization":"Bearer "+response.json()["access_token"]}


def test_staff_workflow_auth_isolation_encryption_retry_review_agent_and_retention(portal, monkeypatch):
    create, engine, mid, neighbor = portal
    base = "/api/ultrasound"
    upload = base + "/patients/" + mid
    calls = []
    def ml_result(request):
        assert request.url.path == "/internal/ultrasound/analyze"
        assert request.headers["Authorization"] == "Bearer " + "fixture-token-" * 4
        assert "patient" not in request.headers
        assert not Image.open(BytesIO(request.content)).info
        calls.append(request)
        if len(calls) == 1:
            raise httpx.ReadTimeout("test deadline", request=request)
        return httpx.Response(200, json={
            "state":"priority_review", "label":"malignant", "confidence":.91, "model_version":"a"*64,
            "probabilities":{"normal":.05,"benign":.04,"malignant":.91},
            "quality":{"width":128,"height":128}, "reasons":["non_normal_archive_label_score"],
        })
    real_client = httpx.AsyncClient
    monkeypatch.setattr("hospital_portal.api.ultrasound.httpx.AsyncClient",
                        lambda **kwargs: real_client(transport=httpx.MockTransport(ml_result), **kwargs))

    with TestClient(create(engine)) as client:
        doctor, resident, wrong_unit, outsider, admin = [
            login(client, who) for who in ("consultant", "resident", "wrong-unit", "outside", "admin")
        ]
        raster = {"Content-Type":"image/png"}
        raw = sample(metadata="test private metadata")
        assert client.get(base).status_code == 401
        assert client.get(base, headers=admin).status_code == 403
        assert client.post(upload, headers=raster, content=raw).status_code == 401
        assert client.post(upload, headers={**wrong_unit, **raster}, content=raw).status_code == 404
        assert client.post(base+"/patients/"+neighbor, headers={**resident, **raster}, content=raw).status_code == 404
        assert client.post(upload, headers=resident, content=raw).status_code == 415
        assert client.post(upload, headers={**resident, **raster}, content=b"corrupt").status_code == 422
        assert client.post(upload, headers={**resident, **raster}, content=b"x"*(12*1024*1024+1)).status_code == 413
        assert not calls
        result = client.post(upload, headers={**resident, **raster}, content=raw)
        assert result.status_code == 201, result.text
        identifier = result.json()["id"]
        detail = base + "/" + identifier
        duplicate = client.post(upload, headers={**resident, **raster}, content=sample())
        assert duplicate.status_code == 200 and duplicate.json() == {"id":identifier,"duplicate":True}
        assert len(calls) == 1
        assert client.get(detail, headers=doctor).json()["analysis"]["reasons"] == ["inference_timeout"]
        assert client.get(detail, headers=wrong_unit).status_code == 404
        assert client.get(detail+"/image", headers=outsider).status_code == 404
        assert client.get(detail+"/image").status_code == 401
        binary = client.get(detail+"/image", headers=doctor)
        assert binary.status_code == 200 and "no-store" in binary.headers["cache-control"]
        assert not Image.open(BytesIO(binary.content)).info
        with engine.begin() as conn:
            stored = conn.scalar(select(s.ultrasound_analysis.c.image_ciphertext))
            assert stored != binary.content and not stored.startswith(b"\x89PNG")
        assert client.post(detail+"/retry", headers=doctor).json()["state"] == "priority_review"
        assert client.get(detail, headers=doctor).json()["revision"] == 2
        assert client.get(base, headers=doctor).json()["items"][0]["id"] == identifier

        scan_batch(engine, False, today=TODAY, include_ultrasound=True)
        queue = client.get("/api/clinical-monitor", headers=doctor).json()["items"]
        flag = next(row for row in queue if row.get("ultrasound_id") == identifier)
        assert flag["priority"] == 2 and flag["evidence"][0]["record_id"] == identifier
        assert any(x["values"].get("systolic") == 162 for x in flag["evidence"])
        assert any(x["values"].get("weight_kg") == 67 for x in flag["evidence"])
        assert client.post("/api/clinical-monitor/flags/"+flag["id"]+"/review", headers=doctor,
                           json={"fingerprint":flag["fingerprint"],"disposition":"reviewed","note":"Wrong route."}).status_code == 409

        review = {"revision":2,"decision":"follow_up_needed","note":"Reviewed uploaded frame and requested follow-up."}
        assert client.post(detail+"/review", headers=resident, json=review).status_code == 403
        assert client.post(detail+"/review", headers=outsider, json=review).status_code == 404
        assert client.post(detail+"/review", headers=doctor, json={**review,"revision":1}).status_code == 409
        assert client.post(detail+"/review", headers=doctor, json=review).json() == {"reviewed":True}
        assert client.post(detail+"/review", headers=doctor, json=review).status_code == 409
        assert client.post(detail+"/retry", headers=doctor).status_code == 409

    with TestClient(create(engine)) as restarted:
        doctor = login(restarted,"consultant")
        reviewed = restarted.get(base+"?reviewed=true",headers=doctor).json()["items"][0]
        assert reviewed["review_status"] == "reviewed" and reviewed["review_note"] == review["note"]
        scan_batch(engine, False, today=TODAY, include_ultrasound=True)
        agent_reviewed = restarted.get("/api/clinical-monitor?reviewed=true",headers=doctor).json()["items"]
        flag = next(row for row in agent_reviewed if row.get("ultrasound_id") == identifier)
        assert flag["evidence"][0]["values"]["review_status"] == "reviewed"

        with engine.begin() as conn:
            assert conn.scalar(select(s.mother.c.clinician_high_risk).where(s.mother.c.id==mid)) is False
            audited = conn.scalars(select(s.audit_log.c.action).where(
                s.audit_log.c.entity_id==identifier,s.audit_log.c.entity_type=="ultrasound_analysis")).all()
            assert {"upload","read","read_image","retry","review"}.issubset(audited)
            conn.execute(update(s.ultrasound_analysis).values(image_expires_at=datetime.now(timezone.utc)-timedelta(seconds=1)))
        assert restarted.get(detail+"/image",headers=doctor).status_code == 410
        purge_expired(engine)
        with engine.begin() as conn:
            assert conn.scalar(select(s.ultrasound_analysis.c.image_ciphertext)) is None
            conn.execute(update(s.mother).where(s.mother.c.id==mid).values(
                consent_flags={"care_coordination":True,"clinical_monitoring":False}))
        assert restarted.get(detail,headers=doctor).status_code == 404
        assert restarted.get(base+"?reviewed=true",headers=doctor).json()["items"] == []
