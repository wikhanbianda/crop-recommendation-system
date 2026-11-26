"""Layanan inferensi Python untuk Crop Recommendation System.

Memuat artefak joblib (model, scaler, label encoder) SEKALI dan hanya memanggil
transform/predict_proba. Tidak ada fit ulang scaler dan tidak ada training saat prediksi.

Endpoint (semua kecuali /health butuh header X-Service-Key):
  GET  /health            status (tanpa rahasia)
  GET  /model             metadata model aktif
  POST /predict           {"features": {N,P,K,temperature,humidity,ph,rainfall}}
  POST /admin/validate    body CSV -> laporan validasi (tanpa training, tanpa menyimpan)
  GET  /admin/dataset/builtin  CSV dataset bawaan (v1.0.0) untuk pratinjau/latih ulang
  POST /admin/train       body CSV; query ?version=...&name=... -> kandidat baru (TIDAK otomatis aktif)
  GET  /admin/versions    daftar versi di disk
  POST /admin/activate    {"version": "..."}  -> jadikan aktif (dipanggil setelah persetujuan admin)
"""
from __future__ import annotations

import hmac
import io
import json
import math
import os
import re
import sys
import threading
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from flask import Flask, jsonify, request

ML_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_ROOT))
sys.path.insert(0, str(ML_ROOT / "training"))
from preprocessing.pipeline import DOMAIN_BOUNDS, FEATURES, DatasetError  # noqa: E402

ARTIFACTS = Path(os.environ.get("ARTIFACTS_DIR", ML_ROOT / "artifacts"))
SERVICE_KEY = os.environ.get("INFERENCE_SERVICE_KEY", "")
MAX_CSV_BYTES = 2 * 1024 * 1024
VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$")

app = Flask(__name__)
from soil.routes import bp as soil_bp  # noqa: E402  (fitur tambahan: foto tanah)
app.register_blueprint(soil_bp)
app.config["MAX_CONTENT_LENGTH"] = MAX_CSV_BYTES
_lock = threading.Lock()
_state: dict = {}


def _active_version() -> str | None:
    f = ARTIFACTS / "active.json"
    if f.exists():
        return json.loads(f.read_text()).get("version")
    return None


def _load(version: str) -> dict:
    d = ARTIFACTS / version
    meta = json.loads((d / "metadata.json").read_text())
    return {"version": version, "meta": meta, "model": joblib.load(d / "model.joblib"),
            "scaler": joblib.load(d / "scaler.joblib"), "le": joblib.load(d / "label_encoder.joblib")}


def current() -> dict | None:
    v = _active_version()
    if not v:
        return None
    with _lock:
        if _state.get("version") != v:
            _state.clear(); _state.update(_load(v))
        return dict(_state)


@app.before_request
def guard():
    if request.path == "/health":
        return None
    if not SERVICE_KEY:
        return jsonify(error="service_not_configured"), 503
    given = request.headers.get("X-Service-Key", "")
    if not hmac.compare_digest(given.encode(), SERVICE_KEY.encode()):
        return jsonify(error="unauthorized"), 401
    return None


@app.errorhandler(413)
def too_large(_):
    return jsonify(error="payload_too_large"), 413


@app.errorhandler(Exception)
def unexpected(e):
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return jsonify(error=e.name.lower().replace(" ", "_")), e.code
    app.logger.exception("unhandled")
    return jsonify(error="internal_error"), 500  # tanpa stack trace


@app.get("/health")
def health():
    try:
        c = current()
    except Exception:
        return jsonify(status="degraded", model_loaded=False), 503
    return jsonify(status="ok" if c else "no_model", model_loaded=bool(c), version=c["version"] if c else None)


@app.get("/model")
def model_info():
    c = current()
    if not c:
        return jsonify(error="no_active_model"), 503
    ev = json.loads((ARTIFACTS / c["version"] / "evaluation.json").read_text())
    return jsonify(metadata=c["meta"], evaluation=ev)


def validate_features(obj) -> tuple[dict | None, dict]:
    errors = {}
    if not isinstance(obj, dict):
        return None, {"features": "harus berupa objek"}
    clean = {}
    for f in FEATURES:
        v = obj.get(f)
        if v is None or isinstance(v, (bool, str)) and v == "":
            errors[f] = "wajib diisi"; continue
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            errors[f] = "harus berupa angka"; continue
        if not math.isfinite(v):
            errors[f] = "harus berupa angka terhingga"; continue
        lo, hi, _ = DOMAIN_BOUNDS[f]
        if v < lo or v > hi:
            errors[f] = f"harus antara {lo} dan {hi}"; continue
        clean[f] = float(v)
    extra = set(obj) - set(FEATURES)
    if extra:
        errors["_extra"] = "field tidak dikenal: " + ", ".join(sorted(map(str, extra))[:5])
    return (None if errors else clean), errors


@app.post("/predict")
def predict():
    c = current()
    if not c:
        return jsonify(error="no_active_model"), 503
    body = request.get_json(silent=True)
    clean, errors = validate_features((body or {}).get("features") if isinstance(body, dict) else None)
    if errors:
        return jsonify(error="validation_error", fields=errors), 422
    x = pd.DataFrame([[clean[f] for f in c["meta"]["features"]]], columns=c["meta"]["features"])
    xs = c["scaler"].transform(x)          # transform saja, bukan fit
    model = c["model"]
    out = {"model_version": c["version"], "algorithm": c["meta"]["algorithm"]}
    if hasattr(model, "predict_proba"):
        proba = model.predict_proba(xs)[0]
        order = np.argsort(proba)[::-1]
        classes = c["le"].inverse_transform(model.classes_[order])
        out["predicted_crop"] = str(classes[0])
        out["probabilities"] = [{"crop": str(classes[i]), "probability": float(proba[order[i]])}
                                for i in range(min(5, len(order)))]
    else:
        out["predicted_crop"] = str(c["le"].inverse_transform(model.predict(xs))[0])
        out["probabilities"] = None  # tidak ada angka palsu
    tr = c["meta"]["feature_training_range"]
    out["out_of_training_range"] = [f for f in FEATURES if clean[f] < tr[f]["min"] or clean[f] > tr[f]["max"]]
    return jsonify(out)


MIN_ROWS, MIN_PER_CLASS = 100, 10


def dataset_report(raw: bytes) -> dict:
    """Validasi dataset tanpa training. Hanya membaca; tidak menyimpan apa pun."""
    from preprocessing.pipeline import TARGET, clean, iqr_outliers
    errors: list[str] = []
    if b"\x00" in raw[:4096]:
        return {"valid": False, "errors": ["Berkas bukan teks CSV (mengandung byte biner)."]}
    try:
        df0 = pd.read_csv(io.BytesIO(raw), nrows=200_000)
    except Exception:
        return {"valid": False, "errors": ["Berkas tidak dapat dibaca sebagai CSV."]}
    rep = {"columns": [{"name": str(c), "dtype": str(t)} for c, t in df0.dtypes.items()],
           "rows_in_file": int(len(df0)),
           "sample": json.loads(df0.head(10).to_json(orient="records"))}
    try:
        df, cl = clean(df0)
    except DatasetError as e:
        return {"valid": False, "errors": [str(e)], **rep}
    rep.update(cl)
    counts = df[TARGET].value_counts()
    rep.update(n_features=len(FEATURES), n_classes=int(counts.size), classes=sorted(map(str, counts.index)),
               class_counts={str(k): int(v) for k, v in counts.sort_index().items()})
    if len(df) < MIN_ROWS:
        errors.append(f"Data terlalu sedikit setelah pembersihan ({len(df)}; minimal {MIN_ROWS}).")
    if counts.size < 2:
        errors.append("Minimal 2 kelas tanaman diperlukan.")
    small = [str(k) for k, v in counts.items() if v < MIN_PER_CLASS]
    if small:
        errors.append(f"Kelas dengan data < {MIN_PER_CLASS} baris: {', '.join(sorted(small)[:8])}.")
    out = []
    for f in FEATURES:
        lo, hi, _ = DOMAIN_BOUNDS[f]
        bad = int(((df[f] < lo) | (df[f] > hi)).sum())
        if bad:
            out.append(f"{f}: {bad} nilai di luar batas wajar {lo}..{hi}")
    if out:
        errors.append("Nilai di luar batas wajar domain: " + "; ".join(out))
    rep["feature_stats"] = {f: {"min": float(df[f].min()), "max": float(df[f].max()), "mean": float(df[f].mean())} for f in FEATURES}
    rep["outliers_iqr"] = {f: v["count"] for f, v in iqr_outliers(df).items()}
    rep["valid"] = not errors
    rep["errors"] = errors
    return rep


@app.post("/admin/validate")
def validate_dataset():
    raw = request.get_data()
    if not raw:
        return jsonify(error="empty_body"), 422
    return jsonify(dataset_report(raw))


@app.get("/admin/dataset/builtin")
def builtin_dataset():
    f = ML_ROOT / "data" / "Crop_recommendation.csv"
    if not f.exists():
        return jsonify(error="not_found"), 404
    return app.response_class(f.read_bytes(), mimetype="text/csv")


@app.get("/admin/versions")
def versions():
    act = _active_version()
    items = []
    for d in sorted(ARTIFACTS.iterdir()) if ARTIFACTS.exists() else []:
        if (d / "metadata.json").exists():
            m = json.loads((d / "metadata.json").read_text())
            items.append({"version": d.name, "algorithm": m["algorithm"], "trained_at": m["trained_at"],
                          "metrics": m["metrics"], "active": d.name == act})
    return jsonify(versions=items)


def _jobs() -> Path:
    return ARTIFACTS / ".jobs"


def _job_file(version: str) -> Path:
    return _jobs() / f"{version}.json"


def _write_job(version: str, data: dict) -> None:
    _jobs().mkdir(parents=True, exist_ok=True)
    tmp = _jobs() / f".{version}.tmp"
    tmp.write_text(json.dumps(data))
    os.replace(tmp, _job_file(version))


def _run_job(csv: Path, version: str, name: str | None, extra: dict) -> None:
    import shutil
    from train import run_training
    try:
        meta = run_training(csv, ARTIFACTS / version, version, name)
        ev = json.loads((ARTIFACTS / version / "evaluation.json").read_text())
        _write_job(version, {"status": "done", **extra, "metadata": meta, "comparison": ev["comparison"]})
    except DatasetError as e:
        shutil.rmtree(ARTIFACTS / version, ignore_errors=True)
        _write_job(version, {"status": "failed", **extra, "error": "dataset_invalid", "message": str(e)})
    except Exception:
        shutil.rmtree(ARTIFACTS / version, ignore_errors=True)
        app.logger.exception("train failed")
        _write_job(version, {"status": "failed", **extra, "error": "training_failed", "message": "Training gagal."})
    finally:
        csv.unlink(missing_ok=True)


@app.post("/admin/train")
def train():
    """Latih kandidat baru. Default ASINKRON (202) karena training penuh bisa lebih lama dari batas waktu
    fungsi serverless; pantau lewat GET /admin/train/<version>. ?sync=1 menunggu sampai selesai (dipakai CLI/uji)."""
    version = request.args.get("version", "")
    if not VERSION_RE.match(version):
        return jsonify(error="invalid_version"), 422
    if (ARTIFACTS / version).exists() or _job_file(version).exists():
        return jsonify(error="version_exists"), 409
    raw = request.get_data()
    if not raw:
        return jsonify(error="empty_body"), 422
    rep = dataset_report(raw)          # validasi dulu: gagal cepat dengan pesan jelas
    if not rep["valid"]:
        return jsonify(error="dataset_invalid", message=" ".join(rep["errors"])), 422
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    tmp = ARTIFACTS / f".upload-{version}.csv"
    tmp.write_bytes(raw)
    extra = {"dataset_id": request.args.get("dataset_id")}
    _write_job(version, {"status": "running", **extra})
    name = request.args.get("name")
    if request.args.get("sync") == "1":
        _run_job(tmp, version, name, extra)
        j = json.loads(_job_file(version).read_text())
        if j["status"] != "done":
            return jsonify(error=j.get("error"), message=j.get("message")), (422 if j.get("error") == "dataset_invalid" else 500)
        return jsonify(metadata=j["metadata"], comparison=j["comparison"]), 201
    threading.Thread(target=_run_job, args=(tmp, version, name, extra), daemon=True).start()
    return jsonify(status="running", version=version), 202


@app.get("/admin/train/<version>")
def train_status(version):
    if not VERSION_RE.match(version) or not _job_file(version).exists():
        return jsonify(error="unknown_job"), 404
    return jsonify(json.loads(_job_file(version).read_text()))


@app.post("/admin/activate")
def activate():
    body = request.get_json(silent=True) or {}
    v = str(body.get("version", ""))
    if not VERSION_RE.match(v) or not (ARTIFACTS / v / "model.joblib").exists():
        return jsonify(error="unknown_version"), 404
    tmp = ARTIFACTS / "active.json.tmp"
    tmp.write_text(json.dumps({"version": v}))
    os.replace(tmp, ARTIFACTS / "active.json")
    return jsonify(active=v)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
