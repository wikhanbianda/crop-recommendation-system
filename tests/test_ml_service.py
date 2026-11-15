"""Uji layanan inferensi dan artefak ML. Jalankan: python -m pytest tests/test_ml_service.py -q"""
import json, os, sys
from pathlib import Path
import joblib, numpy as np, pandas as pd, pytest

ROOT = Path(__file__).resolve().parents[1]
ML = ROOT / "ml"
os.environ["INFERENCE_SERVICE_KEY"] = "test-key"
sys.path.insert(0, str(ML)); sys.path.insert(0, str(ML / "service"))
import app as svc  # noqa
from preprocessing.pipeline import FEATURES, clean, split_and_scale

H = {"X-Service-Key": "test-key"}
OK = {"N": 90, "P": 42, "K": 43, "temperature": 20.9, "humidity": 82, "ph": 6.5, "rainfall": 203}

@pytest.fixture(scope="module")
def c(): return svc.app.test_client()

def test_split_matches_uts():
    df, rep = clean(pd.read_csv(ML / "data/Crop_recommendation.csv"))
    assert df.shape == (2200, 8) and rep["duplicates_removed"] == 0
    d = split_and_scale(df)
    assert len(d["y_train"]) == 1760 and len(d["y_test"]) == 440
    assert len(d["label_encoder"].classes_) == 22
    assert np.allclose(d["scaler"].mean_, d["X_train_raw"].mean().values)  # fit hanya di train

def test_health_open_and_others_need_key(c):
    assert c.get("/health").status_code == 200
    assert c.post("/predict", json={"features": OK}).status_code == 401
    assert c.post("/predict", json={"features": OK}, headers={"X-Service-Key": "x"}).status_code == 401
    assert c.get("/model").status_code == 401

def test_predict_is_real_model_and_matches_sklearn_on_all_test_rows(c):
    meta = json.loads((ML / "artifacts/v1.0.0/metadata.json").read_text())
    model = joblib.load(ML / "artifacts/v1.0.0/model.joblib")
    df, _ = clean(pd.read_csv(ML / "data/Crop_recommendation.csv")); d = split_and_scale(df)
    le = d["label_encoder"]; correct = 0
    for i in range(len(d["y_test"])):
        row = d["X_test_raw"].iloc[i]
        r = c.post("/predict", json={"features": {f: float(row[f]) for f in FEATURES}}, headers=H)
        assert r.status_code == 200
        j = r.get_json()
        direct = le.inverse_transform(model.predict(d["X_test"][i:i+1]))[0]
        assert j["predicted_crop"] == direct
        correct += j["predicted_crop"] == le.inverse_transform([d["y_test"][i]])[0]
        assert abs(sum(p["probability"] for p in j["probabilities"]) - 1) <= 1.0001
    assert correct / 440 == pytest.approx(meta["metrics"]["accuracy"])  # akurasi layanan == metadata

def test_prediction_response_shape(c):
    j = c.post("/predict", json={"features": OK}, headers=H).get_json()
    assert j["predicted_crop"] == "rice" and j["model_version"] == "v1.0.0"
    assert len(j["probabilities"]) == 5 and j["probabilities"][0]["crop"] == "rice"
    ps = [p["probability"] for p in j["probabilities"]]; assert ps == sorted(ps, reverse=True)

@pytest.mark.parametrize("patch,field", [
    ({"N": None}, "N"), ({"N": ""}, "N"), ({"N": "abc"}, "N"), ({"N": -1}, "N"), ({"ph": 15}, "ph"),
    ({"humidity": 101}, "humidity"), ({"rainfall": float("inf")}, "rainfall"), ({"K": True}, "K"),
    ({"temperature": [1]}, "temperature")])
def test_invalid_inputs_rejected(c, patch, field):
    f = {**OK, **patch}
    r = c.post("/predict", data=json.dumps({"features": f}, allow_nan=True), content_type="application/json", headers=H)
    assert r.status_code == 422 and field in r.get_json()["fields"]

def test_missing_and_extra_fields_and_bad_body(c):
    f = dict(OK); f.pop("P")
    assert c.post("/predict", json={"features": f}, headers=H).status_code == 422
    assert c.post("/predict", json={"features": {**OK, "role": "admin"}}, headers=H).status_code == 422
    assert c.post("/predict", data="not json", content_type="application/json", headers=H).status_code == 422
    assert c.post("/predict", json=[1, 2], headers=H).status_code == 422

def test_out_of_training_range_flagged(c):
    j = c.post("/predict", json={"features": {**OK, "rainfall": 450}}, headers=H).get_json()
    assert "rainfall" in j["out_of_training_range"]

def test_train_candidate_does_not_change_active(c, tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "ARTIFACTS", tmp_path)
    import shutil; shutil.copytree(ML / "artifacts/v1.0.0", tmp_path / "v1.0.0"); (tmp_path / "active.json").write_text('{"version":"v1.0.0"}')
    svc._state.clear()
    csv = (ML / "data/Crop_recommendation.csv").read_bytes()
    r = c.post("/admin/train?version=v2-test&name=ulang&sync=1", data=csv, content_type="text/csv", headers=H)
    assert r.status_code == 201, r.get_data(as_text=True)
    assert json.loads((tmp_path / "active.json").read_text())["version"] == "v1.0.0"   # belum aktif
    assert c.post("/admin/train?version=v2-test", data=csv, headers=H).status_code == 409
    assert c.post("/admin/train?version=../x", data=csv, headers=H).status_code == 422
    bad = c.post("/admin/train?version=v3", data=b"a,b\n1,2\n", headers=H)
    assert bad.status_code == 422 and bad.get_json()["error"] == "dataset_invalid" and not (tmp_path / "v3").exists()
    assert c.post("/admin/activate", json={"version": "nope"}, headers=H).status_code == 404
    assert c.post("/admin/activate", json={"version": "v2-test"}, headers=H).get_json()["active"] == "v2-test"
    assert c.get("/health").get_json()["version"] == "v2-test"

def test_train_async_job_status(c, tmp_path, monkeypatch):
    import time
    monkeypatch.setattr(svc, "ARTIFACTS", tmp_path)
    csv = (ML / "data/Crop_recommendation.csv").read_bytes()
    r = c.post("/admin/train?version=v9-async&dataset_id=abc", data=csv, headers=H)
    assert r.status_code == 202 and r.get_json()["status"] == "running"
    for _ in range(120):
        j = c.get("/admin/train/v9-async", headers=H).get_json()
        if j["status"] != "running": break
        time.sleep(1)
    assert j["status"] == "done" and j["dataset_id"] == "abc" and len(j["comparison"]) == 6
    assert c.get("/admin/train/nope", headers=H).status_code == 404

def test_validate_dataset_report(c):
    csv = (ML / "data/Crop_recommendation.csv").read_bytes()
    j = c.post("/admin/validate", data=csv, headers=H).get_json()
    assert j["valid"] and j["rows_clean"] == 2200 and j["n_classes"] == 22 and len(j["sample"]) == 10
    bad = c.post("/admin/validate", data=b"a,b\n1,2\n", headers=H).get_json()
    assert not bad["valid"] and "Kolom wajib" in bad["errors"][0]
    assert not c.post("/admin/validate", data=b"\x00\x01\x02binary", headers=H).get_json()["valid"]
