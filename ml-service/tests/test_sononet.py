import builtins
import io
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
import numpy as np
from PIL import Image
import pytest

from ultrasound import sononet
from ultrasound.inference import register_inference

ASSETS = Path(__file__).resolve().parents[2] / "frontend/assets/ultrasound-demo"


def stacked_sample():
    top = Image.open(ASSETS / "abdomen_1427.png").convert("RGB")
    bottom = Image.open(ASSETS / "thorax_1466.png").convert("RGB")
    image = Image.new("RGB", (top.width, top.height + bottom.height + 12), "white")
    image.paste(top, (0, 0))
    image.paste(bottom, (0, top.height + 12))
    return image


def test_panel_gutter_preserves_the_real_pixels():
    image = stacked_sample()
    top, bottom = sononet.panels(image)
    assert top[0] == "top" and bottom[0] == "bottom"
    assert top[1].tobytes() == Image.open(ASSETS / "abdomen_1427.png").convert("RGB").tobytes()
    assert bottom[1].tobytes() == Image.open(ASSETS / "thorax_1466.png").convert("RGB").tobytes()
    assert sononet.panels(top[1]) == [("whole", top[1])]
    with pytest.raises(ValueError, match="checksum"):
        sononet.verify_weights(b"wrong model bytes")


def test_each_panel_reaches_the_classifier_as_a_distinct_tensor():
    seen = []

    def predict(batch):
        assert batch.shape == (2, 1, 224, 288)
        assert not np.array_equal(*batch)
        outputs = np.zeros((2, len(sononet.CLASSES)))
        outputs[0, 2] = 1
        outputs[1, 1] = 1
        return outputs

    results = sononet.classify(stacked_sample(), predict, seen.append)
    assert seen == ["preprocessing", "inference"]
    assert [view["label"] for view in results] == ["abdomen", "four_chamber"]


def test_published_weights_on_private_inference_endpoint(monkeypatch):
    original_import = builtins.__import__

    def without_onnx(name, *args, **kwargs):
        if name.split(".")[0] in {"onnx", "onnxruntime"}:
            raise ImportError("Test runtime has no ONNX packages")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", without_onnx)
    app = FastAPI()
    register_inference(app, {"DAI_ULTRASOUND_SERVICE_TOKEN": "n"*40})
    png = io.BytesIO()
    stacked_sample().save(png, "PNG")
    with TestClient(app) as client:
        url = "/internal/ultrasound/status"
        assert client.get(url).status_code == 401
        auth = {"Authorization": "Bearer " + "n"*40}
        assert client.get(url, headers=auth).json() == {"state": "ready", "model": "sononet16", "runtime": "numpy-v1"}
        response = client.post("/internal/ultrasound/analyze", content=png.getvalue(), headers={
            **auth, "Content-Type": "image/png",
        })
    assert response.status_code == 200
    result = response.json()
    assert result["state"] == "plane_analysis"
    assert result["model_version"] == sononet.WEIGHTS_SHA256
    assert [view["view"] for view in result["planes"]] == ["top", "bottom"]
    assert [view["label"] for view in result["planes"]] == ["abdomen", "four_chamber"]
    assert all(view["score"] > .80 for view in result["planes"])


def test_readiness_reports_a_bad_override(tmp_path):
    app = FastAPI()
    register_inference(app, {
        "DAI_ULTRASOUND_PLANE_WEIGHTS": str(tmp_path / "missing.npz"),
        "DAI_ULTRASOUND_SERVICE_TOKEN": "n"*40,
    })
    with TestClient(app) as client:
        assert client.get("/internal/ultrasound/status", headers={
            "Authorization": "Bearer " + "n"*40,
        }).json() == {"state": "model_error"}
