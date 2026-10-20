"""The richer interface reads actual source records without widening patient access."""

import os

os.environ["DAI_APP_FACTORY_ONLY"] = "true"
os.environ["DAI_DEMO"] = "true"
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from hospital_portal.api.db import database
from hospital_portal.api.seed import seed
from hospital_portal.api.main import create_app
from hospital_portal.api import schema as s


@pytest.fixture(scope="module")
def workspace(tmp_path_factory):
    engine = database(
        "sqlite:///" + str(tmp_path_factory.mktemp("workspace") / "preview.db")
    )
    seed(engine)
    with TestClient(create_app(engine)) as client:
        yield engine, client
    engine.dispose()


def sign_in(client, role):
    challenge = client.post(
        "/api/auth/login",
        json={
            "email": role + "@dai-synthetic.invalid",
            "password": "Dai-Synthetic-2026!",
        },
    ).json()
    result = client.post(
        "/api/auth/otp",
        json={"challenge_id": challenge["challenge_id"], "code": challenge["demo_otp"]},
    )
    assert result.status_code == 200, result.text
    return {"Authorization": "Bearer " + result.json()["access_token"]}


def test_admin_can_browse_real_source_views(workspace):
    engine, client = workspace
    headers = sign_in(client, "hospital_admin")
    summary = client.get("/api/workspace/summary", headers=headers)
    assert summary.status_code == 200, summary.text
    body = summary.json()
    assert body["beds"]["total"] == 1227
    assert body["beds"]["available"] > 0
    assert len(body["delivery_history"]) == 7
    assert "admissions" in body["delivery_history"][0]
    assert body["critical"] and "ventilators" in body["critical"][0]
    for view in [
        "beds",
        "critical",
        "blood",
        "equipment",
        "staffing",
        "census",
        "organisation",
        "ambulances",
        "sos",
        "referrals",
        "appointments",
        "gaps",
        "readiness",
        "diagnostics",
    ]:
        response = client.get("/api/workspace/" + view, headers=headers)
        assert response.status_code == 200, (view, response.text)
        assert response.json()["data_label"] == "Simulated on synthetic data"
        assert response.json()["items"], view
    beds = client.get("/api/workspace/beds?status=available", headers=headers).json()
    assert all(b["status"] == "available" for b in beds["items"])
    assert len(beds["items"]) <= 60
    last = client.get("/api/workspace/beds?page=999", headers=headers).json()
    assert not last["items"]


def test_restricted_roles_and_audited_patient_rows(workspace):
    engine, client = workspace
    assert client.get("/api/workspace/beds").status_code == 401
    nurse = sign_in(client, "nurse")
    assert client.get("/api/workspace/beds", headers=nurse).status_code == 200
    assert client.get("/api/workspace/blood", headers=nurse).status_code == 403
    assert client.get("/api/workspace/gaps", headers=nurse).status_code == 403
    assert client.get("/api/workspace/summary", headers=nurse).json()["arrivals"] == []
    blood = sign_in(client, "blood_bank")
    assert client.get("/api/workspace/blood", headers=blood).status_code == 200
    assert client.get("/api/workspace/beds", headers=blood).status_code == 403
    doctor = sign_in(client, "consultant")
    appointments = client.get("/api/workspace/appointments", headers=doctor).json()[
        "items"
    ]
    permitted = {
        m["id"]
        for m in client.get("/api/patients?limit=100", headers=doctor).json()["items"]
    }
    assert all(r["portal_mother_id"] in permitted for r in appointments)
    with engine.connect() as c:
        logs = (
            c.execute(select(s.audit_log).where(s.audit_log.c.action == "read"))
            .mappings()
            .all()
        )
        audited = {
            r["entity_id"] for r in logs if r["details"].get("view") == "appointments"
        }
        assert all(r["portal_mother_id"] in audited for r in appointments)
    assert (
        client.get("/api/patients?q=not-a-synthetic-name", headers=doctor).json()[
            "items"
        ]
        == []
    )
