"""Latih model klasifikasi jenis tanah dari FOTO. Dijalankan SEKALI saat dataset gambar sudah ada.

Pemakaian:
  python ml/soil/train_soil.py --data PATH/dataset --version s1.0.0

Struktur dataset: satu folder per jenis tanah, mis. PATH/dataset/alluvial/*.jpg, PATH/dataset/black/*.jpg ...
Nama folder (huruf kecil) harus ada di soil_crop_map.json.

Protokol (mirip UTS): split ~80/20 stratified, random_state=42; gambar duplikat persis dibuang SEBELUM split; foto
yang tampak varian dari foto yang sama (nama berkas sama dengan akhiran huruf, mis. 20.jpg, 20a.jpg, 20c.jpg) dianggap
SATU GRUP dan tidak boleh terpisah antara data latih dan uji (mencegah kebocoran -> akurasi tidak palsu-tinggi).
Pemilihan algoritma memakai cross-validation 5-fold (juga per grup) pada data latih SAJA; data uji dipakai SEKALI.
Gunakan gambar ASLI, bukan hasil augmentasi, atau lakukan augmentasi hanya pada data latih setelah split.
Nama folder dinormalisasi: "Red_Soil" -> "red", "Black Soil" -> "black".
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import warnings

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold, cross_val_predict, cross_val_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

warnings.filterwarnings("ignore", category=FutureWarning)
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from soil import synth  # noqa: E402
from soil.features import GATE_NAMES, NAMES, ImageError, extract, gate_extras, gate_features, load_image  # noqa: E402

EXTS = {".jpg", ".jpeg", ".png", ".webp"}
MIN_PER_CLASS = 20


def norm_class(name: str) -> str:
    n = re.sub(r"[\s\-]+", "_", name.strip().lower())
    return re.sub(r"_?soils?$", "", n) or n


def group_of(cls: str, stem: str) -> str:
    return f"{cls}:{re.sub(r'[a-z]+$', '', stem.lower()) or stem.lower()}"


def load_dataset(root: Path):
    mapping = json.loads((HERE / "soil_crop_map.json").read_text())
    classes = sorted(d.name for d in root.iterdir() if d.is_dir() and not d.name.startswith("."))
    if len(classes) < 2:
        sys.exit("Dataset harus berisi minimal 2 folder kelas.")
    unmapped = [c for c in classes if norm_class(c) not in mapping]
    if unmapped:
        sys.exit(f"Kelas tanpa pemetaan tanaman di soil_crop_map.json: {unmapped}. Tambahkan dulu pemetaannya (dan minta dosen memvalidasi).")
    X, XG, y, g, seen, dup, bad = [], [], [], [], set(), 0, 0
    for c in classes:
        for p in sorted((root / c).rglob("*")):
            if p.suffix.lower() not in EXTS or not p.is_file():
                continue
            raw = p.read_bytes()
            h = hashlib.sha256(raw).hexdigest()
            if h in seen:
                dup += 1; continue
            try:
                im = load_image(raw); X.append(extract(im)); XG.append(gate_extras(im)); y.append(norm_class(c)); g.append(group_of(norm_class(c), p.stem)); seen.add(h)
            except ImageError:
                bad += 1
    X, XG, y, g = np.vstack(X), np.vstack(XG), np.array(y), np.array(g)
    counts = {c: int((y == c).sum()) for c in sorted(set(y))}
    small = {c: n for c, n in counts.items() if n < MIN_PER_CLASS}
    if small:
        sys.exit(f"Kelas dengan gambar < {MIN_PER_CLASS}: {small}")
    return X, np.hstack([X, XG]), y, g, counts, dup, bad


def feats_from_dir(root: Path):
    """Fitur gerbang untuk semua gambar di folder (rekursif); duplikat persis dibuang; yang rusak dilewati."""
    F, seen = [], set()
    for p in sorted(root.rglob("*")):
        if p.suffix.lower() not in EXTS or not p.is_file():
            continue
        raw = p.read_bytes(); h = hashlib.sha256(raw).hexdigest()
        if h in seen:
            continue
        try:
            F.append(gate_features(load_image(raw))); seen.add(h)
        except ImageError:
            pass
    return np.vstack(F) if F else np.empty((0, len(GATE_NAMES)))


def build_gate(XGsoil, tr_i, te_i, neg_dir: Path, ext_dir: Path | None):
    """Gerbang "bukan tanah": SVM biner (tanah vs bukan) pada fitur warna+tekstur+tata letak.
    Negatif = foto umum dari folder --negatives + gambar sintetis (warna rata, derau, halaman teks, tampilan aplikasi).
    Ambang ditentukan HANYA dari data latih (out-of-fold, jadi tidak melihat data uji)."""
    NG = feats_from_dir(neg_dir)
    SY = np.vstack([gate_features(im) for im in synth.make(300)])
    rng = np.random.default_rng(42)
    ng_i, sy_i = rng.permutation(len(NG)), rng.permutation(len(SY))
    ng_tr, ng_te = ng_i[: int(.8 * len(NG))], ng_i[int(.8 * len(NG)):]
    sy_tr, sy_te = sy_i[: int(.8 * len(SY))], sy_i[int(.8 * len(SY)):]
    Xg = np.vstack([XGsoil[tr_i], NG[ng_tr], SY[sy_tr]]); yg = np.r_[np.zeros(len(tr_i)), np.ones(len(ng_tr) + len(sy_tr))]
    mk = lambda: make_pipeline(StandardScaler(), SVC(C=5, gamma="scale", probability=True, random_state=42))  # noqa: E731
    oof = cross_val_predict(mk(), Xg, yg, cv=StratifiedKFold(5, shuffle=True, random_state=42), method="predict_proba")[:, 1]
    soil_oof = oof[yg == 0]
    gate = mk().fit(Xg, yg)
    score = lambda A: gate.predict_proba(A)[:, 1]  # noqa: E731
    st, sn, ss = score(XGsoil[te_i]), score(NG[ng_te]), score(SY[sy_te])
    ev = {}
    for keep in (0.90, 0.95, 0.97, 0.99):
        t = float(np.percentile(soil_oof, keep * 100))
        ev[f"{keep:.2f}"] = {"threshold": t, "soil_test_flagged": int((st > t).sum()), "soil_test": int(len(st)),
                              "general_photos_test_passed": int((sn <= t).sum()), "general_photos_test": int(len(sn)),
                              "synthetic_test_passed": int((ss <= t).sum()), "synthetic_test": int(len(ss))}
        if ext_dir is not None:
            se = score(feats_from_dir(ext_dir)); ev[f"{keep:.2f}"]["external_passed"] = int((se <= t).sum()); ev[f"{keep:.2f}"]["external"] = int(len(se))
    return gate, {"algorithm": "SVM (RBF) biner", "reject_keep": 0.95, "warn_keep": 0.90,
                  "reject_threshold": ev["0.95"]["threshold"], "warn_threshold": ev["0.90"]["threshold"],
                  "negatives": {"general_photos": int(len(NG)), "synthetic": int(len(SY)), "split": "80% latih / 20% uji, random_state=42"},
                  "evaluation_by_keep_rate": ev, "features": GATE_NAMES}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--version", required=True)
    ap.add_argument("--out", type=Path, default=HERE.parent / "soil_artifacts")
    ap.add_argument("--name", default="Soil image classifier")
    ap.add_argument("--negatives", type=Path, help="folder foto UMUM non-tanah untuk melatih gerbang bukan-tanah (disarankan >= 500 foto beragam)")
    ap.add_argument("--external", type=Path, help="(opsional) folder foto non-tanah tambahan HANYA untuk evaluasi gerbang")
    a = ap.parse_args()
    X, XG, y, g, counts, dup, bad = load_dataset(a.data)
    tr_i, te_i = next(StratifiedGroupKFold(5, shuffle=True, random_state=42).split(X, y, g))   # ~80/20, grup tidak terpecah
    Xtr, Xte, ytr, yte, gtr = X[tr_i], X[te_i], y[tr_i], y[te_i], g[tr_i]
    cands = {
        "Logistic Regression": make_pipeline(StandardScaler(), LogisticRegression(max_iter=3000, C=1.0)),
        "Random Forest": make_pipeline(StandardScaler(), RandomForestClassifier(n_estimators=400, random_state=42, n_jobs=1)),
        "SVM (RBF)": make_pipeline(StandardScaler(), SVC(C=10, gamma="scale", probability=True, random_state=42)),
    }
    cv = StratifiedGroupKFold(5, shuffle=True, random_state=42)
    cvs = {n: float(cross_val_score(m, Xtr, ytr, groups=gtr, cv=cv, scoring="f1_macro").mean()) for n, m in cands.items()}
    best = max(cvs, key=cvs.get)
    model = cands[best].fit(Xtr, ytr)
    pred = model.predict(Xte)
    classes = [str(c) for c in model.classes_]
    meta = {
        "version": a.version, "name": a.name, "algorithm": best, "trained_at": datetime.now(timezone.utc).isoformat(),
        "sklearn": sklearn.__version__, "classes": classes, "features": NAMES,
        "dataset": {"images_used": int(len(y)), "per_class": counts, "exact_duplicates_removed": dup, "unreadable_skipped": bad},
        "split": {"method": "StratifiedGroupKFold(5) fold pertama (~20% uji), dikelompokkan per foto asal", "random_state": 42, "groups": int(len(set(g))), "train": int(len(ytr)), "test": int(len(yte))},
        "cv_f1_macro_train": cvs,
        "metrics": {"accuracy": float(accuracy_score(yte, pred)), "f1_macro": float(f1_score(yte, pred, average="macro"))},
        "per_class": classification_report(yte, pred, output_dict=True, zero_division=0),
        "confusion_matrix": {"labels": classes, "matrix": confusion_matrix(yte, pred, labels=classes).tolist()},
    }
    gate = None
    if a.negatives:
        gate, meta["gate"] = build_gate(XG, tr_i, te_i, a.negatives, a.external)
    else:
        print("PERINGATAN: --negatives tidak diberikan, gerbang 'bukan tanah' TIDAK dibuat (foto non-tanah akan tetap ditebak sebagai tanah).")
    d = a.out / a.version
    if d.exists():
        sys.exit(f"Versi {a.version} sudah ada di {d}.")
    d.mkdir(parents=True)
    joblib.dump(model, d / "model.joblib")
    if gate is not None:
        joblib.dump(gate, d / "gate.joblib")
    (d / "metadata.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    (a.out / "active.json").write_text(json.dumps({"version": a.version}))
    print(json.dumps({"algorithm": best, "cv_f1_macro": cvs, "test": meta["metrics"], "classes": classes, "gate": meta.get("gate", {}).get("evaluation_by_keep_rate"), "artifact": str(d)}, indent=2))


if __name__ == "__main__":
    main()
