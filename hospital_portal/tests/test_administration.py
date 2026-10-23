"""Administration tests use isolated synthetic records, never a user's preview DB."""

from hospital_portal.tests.test_care_and_green import portal, login, scope_data
from hospital_portal.api import schema as s
from sqlalchemy import select, update
from uuid import uuid4


def context(portal):
    engine, client = portal
    admin, resident, mother, outside = scope_data(engine)
    return (
        engine,
        client,
        admin,
        resident,
        mother,
        outside,
        login(client, "hospital_admin"),
    )


def test_profile_history_version_and_validation(portal):
    engine, client, admin, _, _, _, headers = context(portal)
    body = dict(
        organisation="DAI synthetic clinic",
        address="Synthetic address Delhi",
        pincode="110001",
        latitude=28.6,
        longitude=77.2,
        hours="09:00–17:00",
        contact="Demo contact",
        emergency_contact="Demo emergency",
        version=0,
        reason="Initial onboarding",
    )
    first = client.put("/api/administration/profile", json=body, headers=headers)
    assert first.status_code == 200, first.text
    assert (
        client.put(
            "/api/administration/profile", json=body, headers=headers
        ).status_code
        == 409
    )
    body.update(
        version=1, contact="Corrected demo contact", reason="Correct contact details"
    )
    assert (
        client.put(
            "/api/administration/profile", json=body, headers=headers
        ).status_code
        == 200
    )
    with engine.connect() as c:
        event = (
            c.execute(
                select(s.audit_log).where(
                    s.audit_log.c.entity_id == first.json()["id"],
                    s.audit_log.c.action == "correct",
                )
            )
            .mappings()
            .one()
        )
        assert event["details"]["before"]["contact"] == "Demo contact"
        assert event["details"]["after"]["contact"] == "Corrected demo contact"
    body["pincode"] = "invalid"
    assert (
        client.put(
            "/api/administration/profile", json=body, headers=headers
        ).status_code
        == 422
    )
    assert (
        client.get("/api/administration", headers=login(client, "resident")).status_code
        == 403
    )


def test_services_scope_and_conflict(portal):
    _, client, admin, resident, _, outside, h = context(portal)
    body = dict(
        name="ANC clinic",
        department_id=resident["department_id"],
        clinician_id=resident["id"],
        capacity=4,
        contact="Demo contact",
        reason="New scheduled clinic",
    )
    path = "/api/administration/services/" + str(uuid4())
    first = client.put(path, json=body, headers=h)
    assert first.status_code == 200, first.text
    assert client.put(path, json=body, headers=h).status_code == 409
    body.update(version=1, available=False)
    assert client.put(path, json=body, headers=h).status_code == 422
    body.update(closure_reason="Staff training")
    assert client.put(path, json=body, headers=h).status_code == 200
    with portal[0].connect() as c:
        other = c.scalar(
            select(s.department.c.id).where(
                s.department.c.facility_id == outside["registered_facility_id"]
            )
        )
    body.update(version=2, department_id=other)
    assert client.put(path, json=body, headers=h).status_code == 403


def test_invitation_single_use_and_account_deactivation(portal):
    _, client, _, _, _, _, h = context(portal)
    body = dict(
        email="invite-test@dai-synthetic.invalid",
        name="Synthetic invite",
        role="front_desk",
        reason="Add front office staff",
    )
    invite = client.put("/api/administration/staff", json=body, headers=h)
    assert invite.status_code == 200, invite.text
    token = invite.json()["invitation_token"]
    secret = dict(token=token, password="Synthetic-only-password!")
    assert (
        client.post("/api/administration/invitations/accept", json=secret).status_code
        == 200
    )
    assert (
        client.post("/api/administration/invitations/accept", json=secret).status_code
        == 400
    )
    challenge = client.post(
        "/api/auth/login", json={"email": body["email"], "password": secret["password"]}
    ).json()
    session = client.post(
        "/api/auth/otp",
        json={"challenge_id": challenge["challenge_id"], "code": challenge["demo_otp"]},
    ).json()
    auth = {"Authorization": "Bearer " + session["access_token"]}
    assert client.get("/api/me", headers=auth).status_code == 200
    body.update(version=1, active=False, reason="Account no longer required")
    assert (
        client.put("/api/administration/staff", json=body, headers=h).status_code == 200
    )
    assert client.get("/api/me", headers=auth).status_code == 401
    challenge = client.post(
        "/api/auth/login", json={"email": body["email"], "password": secret["password"]}
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


def test_patient_records_scope_consent_and_corrections(portal):
    engine, client, _, resident, mother, outside, h = context(portal)
    rh = login(client, "resident")
    body = dict(
        kind="visit",
        title="Synthetic review",
        notes="Recorded synthetic review only",
        status="completed",
        occurred_on="2026-10-20",
        reason="Record completed review",
    )
    path = "/api/patients/" + mother["id"] + "/staff-records/" + str(uuid4())
    assert client.put(path, json=body, headers=h).status_code == 403
    first = client.put(path, json=body, headers=rh)
    assert first.status_code == 200, first.text
    assert client.put(path, json=body, headers=rh).status_code == 409
    assert (
        client.get(
            "/api/patients/" + outside["id"] + "/staff-records", headers=rh
        ).status_code
        == 403
    )
    body.update(
        version=1, notes="Corrected synthetic review", reason="Correct transcription"
    )
    assert client.put(path, json=body, headers=rh).status_code == 200
    with engine.begin() as c:
        original = c.execute(
            select(s.mother.c.consent_flags).where(s.mother.c.id == mother["id"])
        ).scalar()
        c.execute(
            update(s.mother)
            .where(s.mother.c.id == mother["id"])
            .values(consent_flags={**original, "care_coordination": False})
        )
    assert (
        client.get(
            "/api/patients/" + mother["id"] + "/staff-records", headers=rh
        ).status_code
        == 403
    )
    with engine.begin() as c:
        c.execute(
            update(s.mother)
            .where(s.mother.c.id == mother["id"])
            .values(consent_flags=original)
        )


def test_documents_scoped_and_validated(portal, tmp_path, monkeypatch):
    _, client, _, _, _, _, h = context(portal)
    monkeypatch.setenv("DAI_ADMIN_DOCUMENTS", str(tmp_path))
    assert (
        client.post(
            "/api/administration/documents", content=b"bad", headers=h
        ).status_code
        == 422
    )
    result = client.post(
        "/api/administration/documents",
        content=b"%PDF-1.4\nSynthetic verification",
        headers=h,
    )
    assert result.status_code == 200, result.text
    assert (
        client.get(
            "/api/administration/documents/" + result.json()["id"], headers=h
        ).status_code
        == 200
    )
    assert (
        client.get(
            "/api/administration/documents/" + result.json()["id"],
            headers=login(client, "resident"),
        ).status_code
        == 403
    )


def test_multiple_facilities_do_not_share_scope(portal):
    engine, client, admin, resident, mother, outside, h = context(portal)
    # A separate facility's administrator approves this clinician's local affiliation.
    with engine.begin() as c:
        other_facility = outside["registered_facility_id"]
        other_admin = (
            c.execute(
                select(s.user).where(
                    s.user.c.facility_id == other_facility,
                    s.user.c.role == "hospital_admin",
                )
            )
            .mappings()
            .first()
        )
        if not other_admin:
            from hospital_portal.api.security import password_hash

            aid = str(uuid4())
            c.execute(
                s.user.insert().values(
                    id=aid,
                    facility_id=other_facility,
                    name="Synthetic other admin",
                    email="other-admin@dai-synthetic.invalid",
                    role="hospital_admin",
                    password_hash=password_hash("Dai-Synthetic-2026!"),
                    verified=False,
                )
            )
        else:
            aid = other_admin["id"]
        affiliation = str(uuid4())
        c.execute(
            s.staff_affiliation.insert().values(
                id=affiliation,
                facility_id=other_facility,
                user_id=resident["id"],
                email=resident["email"],
                name=resident["name"],
                role="consultant",
                department_id=outside["assigned_unit_id"]
                and c.scalar(
                    select(s.unit.c.department_id).where(
                        s.unit.c.id == outside["assigned_unit_id"]
                    )
                ),
                unit_id=outside["assigned_unit_id"],
                registration_no="SYNTHETIC-TEST",
                verified=True,
                active=True,
                version=1,
            )
        )
    rh = login(client, "resident")
    assert (
        client.post(
            "/api/affiliations/" + affiliation + "/switch", headers=h
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/affiliations/" + affiliation + "/switch", headers=rh
        ).status_code
        == 200
    )
    me = client.get("/api/me", headers=rh).json()
    assert me["facility_id"] == other_facility and me["role"] == "consultant"
    assert client.get("/api/patients/" + mother["id"], headers=rh).status_code == 403
    assert client.get("/api/patients/" + outside["id"], headers=rh).status_code == 200
    # Refresh must retain the facility selected in this session.
    challenge = client.post(
        "/api/auth/login",
        json={"email": resident["email"], "password": "Dai-Synthetic-2026!"},
    ).json()
    session = client.post(
        "/api/auth/otp",
        json={"challenge_id": challenge["challenge_id"], "code": challenge["demo_otp"]},
    ).json()
    fresh = {"Authorization": "Bearer " + session["access_token"]}
    assert (
        client.post(
            "/api/affiliations/" + affiliation + "/switch", headers=fresh
        ).status_code
        == 200
    )
    refreshed = client.post("/api/auth/refresh", headers={"x-dai-client": "portal"})
    assert refreshed.status_code == 200, refreshed.text
    rh = {"Authorization": "Bearer " + refreshed.json()["access_token"]}
    assert client.get("/api/me", headers=rh).json()["facility_id"] == other_facility
    assert (
        client.post(
            "/api/affiliations/" + resident["id"] + "/switch", headers=rh
        ).status_code
        == 200
    )
    assert (
        client.get("/api/me", headers=rh).json()["facility_id"] == admin["facility_id"]
    )
    assert (
        client.post(
            "/api/affiliations/" + affiliation + "/switch", headers=rh
        ).status_code
        == 200
    )
    with engine.begin() as c:
        c.execute(
            update(s.staff_affiliation)
            .where(s.staff_affiliation.c.id == affiliation)
            .values(active=False)
        )
    assert client.get("/api/me", headers=rh).status_code == 403
    with engine.begin() as c:
        c.execute(
            s.session_scope.delete().where(
                s.session_scope.c.affiliation_id == affiliation
            )
        )


def test_referral_receiving_scope_and_outcome(portal):
    engine, client, admin, resident, mother, outside, h = context(portal)
    rh = login(client, "resident")
    created = client.post(
        "/api/care-referrals",
        headers=rh,
        json={
            "mother_id": mother["id"],
            "to_facility_id": outside["registered_facility_id"],
            "reason": "Synthetic specialist review",
            "summary": "Synthetic handoff packet only",
        },
    )
    assert created.status_code == 200, created.text
    identifier = created.json()["id"]
    path = "/api/care-referrals/" + identifier
    assert (
        client.patch(
            path,
            headers=h,
            json={"status": "accepted", "notes": "Intake approved", "version": 1},
        ).status_code
        == 403
    )
    # Create a receiver session without relying on another fixture's cookie state.
    with engine.begin() as c:
        from hospital_portal.api.security import password_hash

        uid = str(uuid4())
        c.execute(
            s.user.insert().values(
                id=uid,
                facility_id=outside["registered_facility_id"],
                name="Synthetic receiving admin",
                email="receiver@dai-synthetic.invalid",
                role="hospital_admin",
                password_hash=password_hash("Synthetic-receiver-password!"),
                verified=False,
            )
        )
    ch = client.post(
        "/api/auth/login",
        json={
            "email": "receiver@dai-synthetic.invalid",
            "password": "Synthetic-receiver-password!",
        },
    ).json()
    token = client.post(
        "/api/auth/otp",
        json={"challenge_id": ch["challenge_id"], "code": ch["demo_otp"]},
    ).json()["access_token"]
    receiver = {"Authorization": "Bearer " + token}
    assert (
        client.get("/api/patients/" + mother["id"], headers=receiver).status_code == 403
    )
    assert any(
        r["id"] == identifier
        for r in client.get("/api/care-referrals", headers=receiver).json()["items"]
    )
    assert (
        client.patch(
            path,
            headers=receiver,
            json={"status": "completed", "notes": "Claim completed care", "version": 1},
        ).status_code
        == 403
    )
    assert (
        client.patch(
            path,
            headers=receiver,
            json={"status": "accepted", "notes": "Intake approved", "version": 1},
        ).status_code
        == 200
    )
    assert (
        client.patch(
            path,
            headers=receiver,
            json={"status": "arrived", "notes": "Patient arrived", "version": 1},
        ).status_code
        == 409
    )
    assert (
        client.patch(
            path,
            headers=receiver,
            json={"status": "arrived", "notes": "Patient arrived", "version": 2},
        ).status_code
        == 200
    )
