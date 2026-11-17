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
from sklearn.model_selection import StratifiedGroupKFold, cross_val_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

warnings.filterwarnings("ignore", category=FutureWarning)
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from soil.features import NAMES, ImageError, extract, load_image  # noqa: E402

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
    X, y, g, seen, dup, bad = [], [], [], set(), 0, 0
    for c in classes:
        for p in sorted((root / c).rglob("*")):
            if p.suffix.lower() not in EXTS or not p.is_file():
                continue
            raw = p.read_bytes()
            h = hashlib.sha256(raw).hexdigest()
            if h in seen:
                dup += 1; continue
            try:
                X.append(extract(load_image(raw))); y.append(norm_class(c)); g.append(group_of(norm_class(c), p.stem)); seen.add(h)
            except ImageError:
                bad += 1
    X, y, g = np.vstack(X), np.array(y), np.array(g)
    counts = {c: int((y == c).sum()) for c in sorted(set(y))}
    small = {c: n for c, n in counts.items() if n < MIN_PER_CLASS}
    if small:
        sys.exit(f"Kelas dengan gambar < {MIN_PER_CLASS}: {small}")
    return X, y, g, counts, dup, bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--version", required=True)
    ap.add_argument("--out", type=Path, default=HERE.parent / "soil_artifacts")
    ap.add_argument("--name", default="Soil image classifier")
    a = ap.parse_args()
    X, y, g, counts, dup, bad = load_dataset(a.data)
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
    d = a.out / a.version
    if d.exists():
        sys.exit(f"Versi {a.version} sudah ada di {d}.")
    d.mkdir(parents=True)
    joblib.dump(model, d / "model.joblib")
    (d / "metadata.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    (a.out / "active.json").write_text(json.dumps({"version": a.version}))
    print(json.dumps({"algorithm": best, "cv_f1_macro": cvs, "test": meta["metrics"], "classes": classes, "artifact": str(d)}, indent=2))


if __name__ == "__main__":
    main()
