import csv
import json
from io import BytesIO
from zipfile import ZipFile

from fastapi import FastAPI
from fastapi.testclient import TestClient
import numpy as np
from PIL import Image
import pytest
from scipy.special import softmax

from ultrasound.audit import CLASSES, SPLITS, audit, sha_file
from ultrasound.inference import register_inference, load_model
from ultrasound.imaging import PREPROCESS, QUALITY, decode, preprocess
from ultrasound.audit import VERSION, dump
from ultrasound.training import approve_dataset, fit_temperature, metrics


def png(seed, *, flat=False):
    pixels = np.full((128, 128), 128, dtype="uint8") if flat else (
        np.random.default_rng(seed).integers(30, 230, size=(128, 128), dtype="uint8")
    )
    result = BytesIO()
    Image.fromarray(pixels).save(result, format="PNG")
    return result.getvalue()


def fixture_dataset(tmp_path, contamination=False):
    archive = tmp_path/"data.zip"
    groups = tmp_path/"group.csv"
    rows = []
    with ZipFile(archive,"w") as z:
        for split_index, split in enumerate(SPLITS):
            for j,label in enumerate(CLASSES):
                index = split_index*3 + j
                path = f"root/{split}/{label}/frame.png"
                z.writestr(path,png(index))
                rows.append((path,f"fixture-patient-{index}"))
        z.writestr("root/OverlayedImages/normal/overlay.png",png(90))
        z.writestr("root/Datasets/normal/aggregate.png",png(0))
        z.writestr("root/train/malignant/frame_Annotation.png",png(3))
        if contamination:
            z.writestr("root/test/benign/conflicting.png",png(0))
            z.writestr("root/train/malignant/corrupt.png",b"not raster data")
            z.writestr("root/validation/normal/low_contrast.png",png(0,flat=True))
            rows.append(("root/test/benign/conflicting.png","fixture-patient-0"))
            rows.append(("root/validation/normal/low_contrast.png","fixture-patient-90"))
    with open(groups,"w",newline="") as f:
        writer=csv.writer(f)
        writer.writerow(("path","group_id"))
        writer.writerows(rows)
    approval=dict(archive_sha256=sha_file(archive),group_map_sha256=sha_file(groups),
                  reviewer="Synthetic fixture",grouping_provenance="Known generated group IDs",
                  label_reference_standard="Generated labels for integration tests",
                  approved_for_research=True)
    return archive,groups,approval


def test_audit_quarantines_duplicates_foreign_folders_derivatives_and_corrupt_files(tmp_path):
    archive, groups, review = fixture_dataset(tmp_path,True)
    result=audit(archive,groups)
    assert result["exact_bytes"]["cross_split_groups"]==1
    assert result["exact_pixels"]["cross_label_groups"]==1
    assert result["original_counts"]["train"]["normal"]==1
    assert result["eligible_counts"]["train"]["normal"]==0
    assert result["derivative_counts"]["train"]["malignant"]==1
    assert len(result["corrupt"])==1
    assert result["quality_counts"]["validation"]["normal"]==1
    assert result["patient_groups"]["cross_split_groups"]==1
    with pytest.raises(ValueError,match="Training blocked"):
        approve_dataset(archive,groups,review)


def test_only_complete_verified_group_map_and_matching_review_open_training_gate(tmp_path):
    archive, groups, review = fixture_dataset(tmp_path)
    assert not audit(archive,groups)["blockers"]
    assert audit(archive)["blockers"]
    with pytest.raises(ValueError,match="must match"):
        approve_dataset(archive,groups,{**review,"archive_sha256":"0"*64})
    assert not approve_dataset(archive,groups,review)["blockers"]


def test_metrics_class_order_and_temperature():
    labels=np.array([0,1,2,0,1,2])
    logits=np.array([[6,0,1],[0,4,1],[4,0,1],[3,0,1],[0,2,1],[0,1,3]],dtype=float)
    temperature=fit_temperature(logits,labels)
    base=metrics(labels,softmax(logits,axis=1))
    calibrated=metrics(labels,softmax(logits/temperature,axis=1))
    assert calibrated["log_loss"]<=base["log_loss"]
    assert calibrated["per_class"]["malignant"]["recall"]==.5
    assert calibrated["confusion_matrix"][2]==[1,0,1]
    assert calibrated["class_order"]==CLASSES
    assert len(calibrated["roc_auc_ovr"])==3


def test_preprocessing_matches_training_shape_and_letterboxes():
    image = Image.new("RGB", (256, 128), (128, 128, 128))
    tensor = preprocess(image)
    assert tensor.shape == (3, 224, 224)
    assert tensor.dtype == np.float32
    np.testing.assert_allclose(tensor[:, 0, 0], -np.array(PREPROCESS["mean"])/PREPROCESS["std"], rtol=1e-6)
    np.testing.assert_allclose(tensor[:, 112, 112],
                               (128/255-np.array(PREPROCESS["mean"]))/PREPROCESS["std"], rtol=1e-6)
    with pytest.raises((ValueError, OSError)):
        decode(b"invalid")


def test_internal_route_authentication_quality_and_score_states(tmp_path):
    app = FastAPI()
    config = dict(DAI_ULTRASOUND_MODEL_DIR=str(tmp_path), DAI_ULTRASOUND_SERVICE_TOKEN="a"*40)
    headers = {"Authorization": "Bearer " + "a"*40, "Content-Type": "image/png"}
    route = "/internal/ultrasound/analyze"
    scores = [.75, .20, .05]
    calls = []
    def load(_):
        calls.append("loaded")
        return lambda image: scores, "1"*64

    register_inference(app, config, load)
    with TestClient(app) as client:
        assert client.post(route, content=png(0)).status_code == 401
        assert client.post(route, headers=headers, content=b"no raster").status_code == 422
        assert client.post(route, headers={**headers,"Content-Type":"text/plain"},content=png(0)).status_code == 415
        bad = client.post(route, headers=headers, content=png(0, flat=True)).json()
        assert bad["state"] == "quality_issue" and "probabilities" not in bad and not calls
        result = client.post(route, headers=headers, content=png(0)).json()
        assert result["state"] == "low_confidence" and result["confidence"] == .75
        stream_headers = {**headers, "Accept": "application/x-ndjson"}
        success = client.post(route, headers=stream_headers, content=png(0))
        events = [json.loads(line) for line in success.text.splitlines()]
        assert events == [{"stage":"quality"}, {"stage":"inference"}, {"result":result}]
        invalid = client.post(route, headers=stream_headers, content=png(0, flat=True))
        events = [json.loads(line) for line in invalid.text.splitlines()]
        assert events == [{"stage":"quality"}, {"result":bad}]

        scores[:] = [.03, .02, .95]
        assert client.post(route, headers=headers, content=png(0)).json()["state"] == "priority_review"
        scores[:] = [.93, .04, .03]
        assert client.post(route, headers=headers, content=png(0)).json()["state"] == "prediction"
        scores[:] = [.93, -.04, .11]
        assert client.post(route, headers=headers, content=png(0)).json()["state"] == "model_unavailable"
        assert len(calls) == 1
        assert route not in client.get("/openapi.json").json()["paths"]

    app = FastAPI()
    register_inference(app, {**config, "DAI_ULTRASOUND_MODEL_DIR": ""})
    with TestClient(app) as client:
        reply = client.post(route, headers=headers, content=png(7)).json()
        assert reply["state"] == "model_unavailable" and reply["reasons"] == ["no_approved_model"]


def test_real_torch_checkpoint_load_requires_integrity_and_research_release(tmp_path):
    torch = pytest.importorskip("torch")
    torchvision = pytest.importorskip("torchvision")
    torch.set_num_threads(1)
    from ultrasound.training import LOW_CONFIDENCE, NON_NORMAL_SCORE, WEIGHTS

    with pytest.raises(OSError):
        load_model(tmp_path)
    model = torchvision.models.efficientnet_b0(weights=None)
    model.classifier[1] = torch.nn.Linear(model.classifier[1].in_features, len(CLASSES))
    # Serialization fixture only. No fitted or evaluated model is produced by this test.
    torch.save(model.state_dict(), tmp_path/WEIGHTS)
    archive_sha = "2"*64
    dump(tmp_path/"dataset_audit.json", dict(audit_version=VERSION, blockers=[],
        patient_groups={"complete":True}, archive_sha256=archive_sha))
    dump(tmp_path/"report.json", {"fixture":True})
    dump(tmp_path/"model.json", dict(schema=1, research_only=True, architecture="efficientnet_b0",
        classes=CLASSES, preprocess=PREPROCESS, quality=QUALITY, temperature=1,
        review_policy={"low_confidence": LOW_CONFIDENCE, "non_normal_score": NON_NORMAL_SCORE},
        weights_sha256=sha_file(tmp_path/WEIGHTS), report_sha256=sha_file(tmp_path/"report.json"),
        audit_sha256=sha_file(tmp_path/"dataset_audit.json"), archive_sha256=archive_sha))
    with pytest.raises(OSError):
        load_model(tmp_path)
    version = sha_file(tmp_path/"model.json")
    dump(tmp_path/"release.json", dict(approved_for_research_inference=True, reviewer="Fixture",
                                      model_manifest_sha256=version))
    predict, identifier = load_model(tmp_path)
    assert identifier == version
    assert predict(decode(png(0))).sum() == pytest.approx(1)
    dump(tmp_path/"report.json", {"tampered":True})
    with pytest.raises(ValueError, match="hash mismatch"):
        load_model(tmp_path)
