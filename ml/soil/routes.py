"""Endpoint inferensi gambar tanah (Blueprint). Kunci layanan diperiksa oleh guard() di app.py (berlaku untuk semua rute).

  GET  /soil-model     status & metadata model gambar (503 bila belum dilatih)
  POST /predict-soil   body = bytes gambar (JPG/PNG/WebP) -> jenis tanah + tanaman yang cocok
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path

import joblib
import numpy as np
from flask import Blueprint, jsonify, request

from soil.features import ImageError, extract, load_image

ML_ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(os.environ.get("SOIL_ARTIFACTS_DIR", ML_ROOT / "soil_artifacts"))
MAPPING_FILE = Path(__file__).resolve().parent / "soil_crop_map.json"
LOW_CONFIDENCE = 0.5

bp = Blueprint("soil", __name__)
_lock = threading.Lock()
_state: dict = {}


def _current() -> dict | None:
    f = ARTIFACTS / "active.json"
    if not f.exists():
        return None
    v = json.loads(f.read_text()).get("version")
    d = ARTIFACTS / str(v)
    if not v or not (d / "model.joblib").exists():
        return None
    with _lock:
        if _state.get("version") != v:
            _state.clear()
            _state.update({"version": v, "meta": json.loads((d / "metadata.json").read_text()), "model": joblib.load(d / "model.joblib")})
        return dict(_state)


def _mapping() -> dict:
    return {k: v for k, v in json.loads(MAPPING_FILE.read_text()).items() if not k.startswith("_")}


@bp.get("/soil-model")
def soil_model():
    c = _current()
    if not c:
        return jsonify(error="no_soil_model"), 503
    m = c["meta"]
    return jsonify(version=c["version"], algorithm=m["algorithm"], classes=m["classes"], metrics=m["metrics"],
                   trained_at=m["trained_at"], images_used=m["dataset"]["images_used"])


@bp.post("/predict-soil")
def predict_soil():
    c = _current()
    if not c:
        return jsonify(error="no_soil_model"), 503
    try:
        feats = extract(load_image(request.get_data()))
    except ImageError as e:
        return jsonify(error="invalid_image", message=str(e)), 422
    model = c["model"]
    proba = model.predict_proba(feats.reshape(1, -1))[0]
    classes = [str(x) for x in model.classes_]
    order = np.argsort(proba)[::-1]
    soils = [{"soil": classes[i], "probability": float(proba[i])} for i in order[:3]]
    mapping = _mapping()
    scores: dict[str, float] = {}
    for i, s in enumerate(classes):
        for crop, w in mapping.get(s, {}).items():
            scores[crop] = scores.get(crop, 0.0) + float(proba[i]) * float(w)
    crops = [{"crop": k, "score": round(v, 4)} for k, v in sorted(scores.items(), key=lambda kv: -kv[1]) if v > 0][:5]
    return jsonify(model_version=c["version"], algorithm=c["meta"]["algorithm"], predicted_soil=soils[0]["soil"],
                   soil_probabilities=soils, crops=crops, low_confidence=bool(soils[0]["probability"] < LOW_CONFIDENCE),
                   unmapped_soils=[s for s in classes if s not in mapping])
