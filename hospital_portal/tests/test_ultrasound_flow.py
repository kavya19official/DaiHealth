import asyncio
from datetime import timedelta
from io import BytesIO
import hashlib

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
import jwt
from sqlalchemy import select, update

from hospital_portal.api import schema as s
from hospital_portal.api.db import database, initialize
from hospital_portal.api.ultrasound import Ultrasound, Scores, purge_expired, utc
from hospital_portal.api.ultrasound_workspace import register_workspace
from hospital_portal.api.ultrasound_processing import process_next


def test_workspace_release_privacy_concurrency_and_retention(tmp_path):
    key = "test-workspace-signing-key-fixture-only"
    engine = database("sqlite:///" + str(tmp_path / "portal.sqlite"))
    initialize(engine)
    service = Ultrasound({
        "DAI_ULTRASOUND_ENABLED":"true", "DAI_ULTRASOUND_IMAGE_KEY":"21"*32,
        "DAI_ULTRASOUND_SERVICE_TOKEN":"fixture-inference-key-for-tests-only",
    })

    received = []
    async def analyze(frame, progress):
        received.append(frame)
        await progress("quality")
        if len(received) == 1:
            from hospital_portal.api.ultrasound import unavailable
            return unavailable("inference_timeout")
        await progress("preprocessing")
        await progress("inference")
        return Scores(state="prediction", label="normal", probabilities={"normal":.9,"benign":.05,"malignant":.05},
                      confidence=.9, model_version="a"*64, reasons=[], quality={"width":128, "height":128})

    service.analyze = analyze
    app = FastAPI()
    register_workspace(app, engine, service, key)
    endpoint = "/internal/ultrasound-workspace/scans"
    mother = dict(role="mother", actor=101, patient=101)
    doctor = dict(role="doctor", actor=42, doctor=42, patient=101, facilities=["fixture-facility"])
    create = dict(**mother, doctor=42, facility="fixture-facility", facilities=["fixture-facility"],
                  episode="2026-01-01", context={"stage":"pregnant"})
    png = BytesIO()
    Image.new("L",(128,128),40).save(png,"PNG")

    def call(client, grant, suffix="", *, method="GET", value=None, media="application/json"):
        import json
        raw = b"" if value is None else value if isinstance(value, bytes) else json.dumps(value).encode()
        path = endpoint + suffix
        token = jwt.encode(dict(**grant, method=method, path=path, iat=utc(), exp=utc()+timedelta(seconds=60),
            iss="dai-workspace", aud="dai-ultrasound-workspace", sha256=hashlib.sha256(raw).hexdigest()), key)
        return client.request(method, path, content=raw,
                              headers={"x-dai-ultrasound-workspace":token,"content-type":media})

    with TestClient(app) as client:
        assert client.get(endpoint).status_code == 401
        assert call(client, {**mother,"patient":102}).status_code == 401
        reply = call(client,create,method="POST",value=b"wrong",media="image/png")
        assert reply.status_code == 422
        reply = call(client,create,method="POST",value=png.getvalue(),media="image/png")
        assert reply.status_code == 201, reply.text
        scan_id = reply.json()["id"]
        route = "/"+scan_id
        assert call(client,create,method="POST",value=png.getvalue(),media="image/png").json()["duplicate"]
        pending = call(client,mother).json()["items"][0]
        assert pending["status"] == "pending" and pending["report"] is None
        assert pending["processing"] and pending["assessment"]["state"] == "queued"
        assert call(client,doctor,route+"/start",method="POST",value={"revision":1}).status_code == 409
        assert call(client,dict(role="mother",actor=102,patient=102),route).status_code == 404
        assert asyncio.run(process_next(engine,service))
        timed_out = call(client,mother,route).json()
        assert timed_out["assessment"]["flag"]["category"] == "review_recommended"
        assert "timed out" in timed_out["assessment"]["flag"]["reasons"][0]
        retry = {"revision": timed_out["retry_revision"]}
        assert call(client,dict(role="mother",actor=102,patient=102),route+"/retry",method="POST",value=retry).status_code == 404
        assert call(client,mother,route+"/retry",method="POST",value=retry).status_code == 200
        assert call(client,mother,route+"/retry",method="POST",value=retry).status_code == 409
        assert asyncio.run(process_next(engine,service))
        assert received[0] == received[1]
        assert Image.open(BytesIO(received[0])).convert("L").tobytes() == Image.open(BytesIO(png.getvalue())).tobytes()
        done = call(client,mother,route).json()
        assert not done["processing"] and done["assessment"]["model_ran"]
        assert done["assessment"]["steps"] == ["quality", "preprocessing", "inference", "report"]
        assert done["assessment"]["started_at"] <= done["assessment"]["stage_times"]["inference"] <= done["assessment"]["finished_at"]
        assert done["assessment"]["flag"]["category"] == "review_recommended"
        assert not ({"confidence","probabilities","label"} & done["assessment"].keys())
        assert not ({"analysis","note","draft","pregnancy_context","revision"} & pending.keys())
        assert call(client,{**doctor,"facilities":["other"]}).json()["items"] == []
        assert call(client,dict(role="doctor",actor=99,doctor=99,patient=101,facilities=["fixture-facility"]),
                    route+"/image").status_code == 404
        assert call(client,dict(role="mother",actor=102,patient=102), route+"/image").status_code == 404
        image = call(client,doctor,route+"/image")
        assert image.headers["content-type"] == "image/png"
        with engine.begin() as conn:
            ciphertext = conn.scalar(select(s.ultrasound_workspace_scan.c.image_ciphertext))
            assert ciphertext != image.content and not ciphertext.startswith(b"\x89PNG")
        assert call(client,doctor,route+"/release",method="POST",value={"revision":2}).status_code == 409
        assert call(client,doctor,route+"/start",method="POST",value={"revision":2}).status_code == 200
        assert call(client,mother).json()["items"][0]["status"] == "under_review"
        form = {"revision":3,"decision":"follow_up_needed","interpretation":"corrected","findings":"Recorded by clinician.",
                "instructions":"Contact your care team.","note":"Private clinician content."}
        assert call(client,mother,route+"/review",method="POST",value=form).status_code == 403
        assert call(client,doctor,route+"/review",method="POST",value=form).status_code == 200
        assert call(client,doctor,route+"/release",method="POST",value={"revision":3}).status_code == 409
        draft = call(client,mother).json()["items"][0]
        assert draft["report"] is None and draft["status"] == "under_review"
        clinician = call(client,doctor).json()["items"][0]
        assert clinician["note"] == form["note"] and clinician["analysis"]["confidence"] == .9
        assert clinician["draft"]["interpretation"] == "corrected"
        assert call(client,doctor,route+"/release",method="POST",value={"revision":4}).status_code == 200
        released = call(client,mother).json()["items"][0]
        assert released["status"] == "reviewed" and released["report"]["instructions"] == form["instructions"]
        assert not ({"analysis","note","draft","pregnancy_context","revision"} & released.keys())
        assert call(client,doctor,route+"/review",method="POST",value={**form,"revision":4}).status_code == 409
        with engine.begin() as conn:
            actions = set(conn.scalars(select(s.audit_log.c.action).where(s.audit_log.c.entity_id==scan_id)).all())
            assert {"workspace_upload","workspace_start","workspace_review","workspace_release"} <= actions
            conn.execute(update(s.ultrasound_workspace_scan).values(image_expires_at=utc()-timedelta(seconds=1)))
        assert purge_expired(engine) == 1
        assert call(client,mother,route+"/image").status_code == 410
        assert call(client,mother).json()["items"][0]["report"] is not None
    engine.dispose()
