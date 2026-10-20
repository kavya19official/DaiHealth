import os

os.environ["DAI_APP_FACTORY_ONLY"] = "true"
os.environ["DAI_DEMO"] = "true"
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update, func
from hospital_portal.api import schema as s
from hospital_portal.api.db import database
from hospital_portal.api.seed import seed
from hospital_portal.api.main import create_app


@pytest.fixture(scope="module")
def context(tmp_path_factory):
    engine = database("sqlite:///" + str(tmp_path_factory.mktemp("portal") / "test.db"))
    seed(engine)
    with TestClient(create_app(engine)) as client:
        yield engine, client
    engine.dispose()


def login(client, role="hospital_admin"):
    challenge = client.post(
        "/api/auth/login",
        json={
            "email": role + "@dai-synthetic.invalid",
            "password": "Dai-Synthetic-2026!",
        },
    )
    assert challenge.status_code == 200, challenge.text
    result = client.post(
        "/api/auth/otp",
        json={
            "challenge_id": challenge.json()["challenge_id"],
            "code": challenge.json()["demo_otp"],
        },
    )
    assert result.status_code == 200, result.text
    return {"Authorization": "Bearer " + result.json()["access_token"]}


def test_import_integrity_and_provenance(context):
    engine, client = context
    with engine.connect() as c:
        assert not c.exec_driver_sql("PRAGMA foreign_key_check").all()
        assert c.scalar(select(func.count()).select_from(s.mother)) == 2000
        assert (
            c.scalar(
                select(func.count())
                .select_from(s.mother)
                .where(s.mother.c.clinician_high_risk)
            )
            == 240
        )
        assert c.scalar(select(func.count()).select_from(s.child)) > 0
        assert c.scalar(select(func.count()).select_from(s.seed_manifest)) == 1
        assert c.scalar(select(func.count()).select_from(s.facility)) == 12
        moms = c.execute(select(s.mother)).mappings()
        for m in moms:
            doc = (
                c.execute(select(s.user).where(s.user.c.id == m["assigned_doctor_id"]))
                .mappings()
                .one()
            )
            unit = (
                c.execute(select(s.unit).where(s.unit.c.id == m["assigned_unit_id"]))
                .mappings()
                .one()
            )
            assert (
                doc["facility_id"] == unit["facility_id"] == m["registered_facility_id"]
            )
            assert doc["unit_id"] == m["assigned_unit_id"]
            assert not m["clinician_high_risk"] or m["validated_by"]


def test_deny_default_otp_and_refresh_rotation(context):
    engine, client = context
    assert client.get("/api/patients").status_code == 401
    assert (
        client.get("/api/patients", headers={"x-hospital-role": "admin"}).status_code
        == 401
    )
    challenge = client.post(
        "/api/auth/login",
        json={
            "email": "hospital_admin@dai-synthetic.invalid",
            "password": "Dai-Synthetic-2026!",
        },
    ).json()
    wrong = "000000" if challenge["demo_otp"] != "000000" else "000001"
    assert (
        client.post(
            "/api/auth/otp",
            json={"challenge_id": challenge["challenge_id"], "code": wrong},
        ).status_code
        == 401
    )
    with engine.connect() as c:
        assert (
            c.scalar(
                select(s.auth_challenge.c.attempts).where(
                    s.auth_challenge.c.id == challenge["challenge_id"]
                )
            )
            == 1
        )
    result = client.post(
        "/api/auth/otp",
        json={"challenge_id": challenge["challenge_id"], "code": challenge["demo_otp"]},
    )
    assert result.status_code == 200
    assert (
        client.post(
            "/api/auth/otp",
            json={
                "challenge_id": challenge["challenge_id"],
                "code": challenge["demo_otp"],
            },
        ).status_code
        == 401
    )
    old_refresh = client.cookies.get("dai_refresh")
    old_access = result.json()["access_token"]
    assert client.post("/api/auth/refresh").status_code == 403
    assert (
        client.post(
            "/api/auth/refresh",
            headers={"x-dai-client": "portal", "origin": "https://untrusted.invalid"},
        ).status_code
        == 403
    )
    rotated = client.post("/api/auth/refresh", headers={"x-dai-client": "portal"})
    assert rotated.status_code == 200
    assert client.cookies.get("dai_refresh") != old_refresh
    assert (
        client.get(
            "/api/me", headers={"Authorization": "Bearer " + old_access}
        ).status_code
        == 401
    )


def test_rbac_unit_scope_and_read_audit(context):
    engine, client = context
    admin = login(client)
    listing = client.get("/api/patients", headers=admin)
    assert listing.status_code == 200
    items = listing.json()["items"]
    assert items
    with engine.connect() as c:
        assert c.scalar(
            select(func.count())
            .select_from(s.audit_log)
            .where(
                s.audit_log.c.action == "read", s.audit_log.c.entity_type == "mother"
            )
        ) >= len(items)
    nurse = login(client, "nurse")
    assert client.get("/api/patients", headers=nurse).status_code == 403
    fid = client.get("/api/me", headers=nurse).json()["facility_id"]
    assert (
        client.patch(
            "/api/facilities/" + fid, headers=nurse, json={"sos_participating": False}
        ).status_code
        == 403
    )
    doctor = login(client, "consultant")
    me = client.get("/api/me", headers=doctor).json()
    scoped = client.get("/api/patients", headers=doctor).json()["items"]
    assert all(m["assigned_unit_id"] == me["unit_id"] for m in scoped)
    with engine.connect() as c:
        outside = c.execute(
            select(s.mother.c.id).where(
                s.mother.c.registered_facility_id == fid,
                s.mother.c.assigned_unit_id != me["unit_id"],
            )
        ).scalar()
    assert client.get("/api/patients/" + outside, headers=doctor).status_code == 403


def test_m1_crud_and_foreign_facility_guard(context):
    engine, client = context
    admin = login(client)
    fid = client.get("/api/me", headers=admin).json()["facility_id"]
    structure = client.get(f"/api/facilities/{fid}/structure", headers=admin).json()
    assert (
        len(
            [
                u
                for u in structure["units"]
                if u["anc_day"] is not None and u["code"] != "FP"
            ]
        )
        == 6
    )
    created = client.post(
        f"/api/facilities/{fid}/structure/departments",
        headers=admin,
        json={"name": "SYNTHETIC phase acceptance department"},
    )
    assert created.status_code == 201, created.text
    did = created.json()["id"]
    assert (
        client.patch(
            f"/api/facilities/{fid}/structure/departments/{did}",
            headers=admin,
            json={"name": "SYNTHETIC acceptance renamed"},
        ).status_code
        == 200
    )
    assert (
        client.delete(
            f"/api/facilities/{fid}/structure/departments/{did}", headers=admin
        ).status_code
        == 200
    )
    assert (
        client.delete(
            f"/api/facilities/{fid}/structure/departments/{structure['departments'][0]['id']}",
            headers=admin,
        ).status_code
        == 409
    )
    with engine.connect() as c:
        other = c.scalar(
            select(s.department.c.id).where(s.department.c.facility_id != fid)
        )
    bad = client.post(
        f"/api/facilities/{fid}/structure/units",
        headers=admin,
        json={"department_id": other, "code": "BAD"},
    )
    assert bad.status_code == 422
    assert (
        client.patch(
            f"/api/facilities/{fid}", headers=admin, json={"authorized_beds": 9000}
        ).status_code
        == 422
    )


def test_unverified_clinical_identity_and_demo_switch(context):
    engine, client = context
    admin = login(client)
    switched = client.post(
        "/api/demo/switch", headers=admin, json={"role": "bed_manager"}
    )
    assert switched.status_code == 200
    impersonated = {"Authorization": "Bearer " + switched.json()["access_token"]}
    assert client.get("/api/patients", headers=impersonated).status_code == 403
    assert (
        client.post(
            "/api/demo/switch", headers=impersonated, json={"role": "hospital_admin"}
        ).status_code
        == 200
    )
    nurse = login(client, "nurse")
    assert (
        client.post(
            "/api/demo/switch", headers=nurse, json={"role": "hospital_admin"}
        ).status_code
        == 403
    )
    with engine.begin() as c:
        c.execute(
            update(s.user)
            .where(s.user.c.source_id == "demo:resident")
            .values(verified=False)
        )
    challenge = client.post(
        "/api/auth/login",
        json={
            "email": "resident@dai-synthetic.invalid",
            "password": "Dai-Synthetic-2026!",
        },
    ).json()
    assert (
        client.post(
            "/api/auth/otp",
            json={
                "challenge_id": challenge["challenge_id"],
                "code": challenge["demo_otp"],
            },
        ).status_code
        == 403
    )


def test_structure_validation_and_otp_lockout(context):
    engine, client = context
    admin = login(client)
    fid = client.get("/api/me", headers=admin).json()["facility_id"]
    structure = client.get(f"/api/facilities/{fid}/structure", headers=admin).json()
    clinic = structure["clinics"][0]
    route = f"/api/facilities/{fid}/structure/clinics/{clinic['id']}"
    assert (
        client.patch(route, headers=admin, json={"end_time": "00:01"}).status_code
        == 422
    )
    assert client.patch(route, headers=admin, json={"name": None}).status_code == 422
    assert client.patch(route, headers=admin, json={"day": True}).status_code == 422
    assert (
        client.post(
            f"/api/facilities/{fid}/structure/units",
            headers=admin,
            json={"code": "BAD", "department_id": "invalid-uuid"},
        ).status_code
        == 422
    )
    assert client.get("/api/patients/invalid-uuid", headers=admin).status_code == 422
    challenge = client.post(
        "/api/auth/login",
        json={
            "email": "bed_manager@dai-synthetic.invalid",
            "password": "Dai-Synthetic-2026!",
        },
    ).json()
    wrong = "000000" if challenge["demo_otp"] != "000000" else "000001"
    for _ in range(5):
        assert (
            client.post(
                "/api/auth/otp",
                json={"challenge_id": challenge["challenge_id"], "code": wrong},
            ).status_code
            == 401
        )
    assert (
        client.post(
            "/api/auth/otp",
            json={
                "challenge_id": challenge["challenge_id"],
                "code": challenge["demo_otp"],
            },
        ).status_code
        == 401
    )
