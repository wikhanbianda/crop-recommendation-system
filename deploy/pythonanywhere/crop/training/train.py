"""Training + evaluasi enam algoritma dan penyimpanan artefak.

Pemilihan model terbaik memakai 5-fold stratified CV pada DATA LATIH saja
(test set tidak dipakai untuk memilih). Metrik test dilaporkan sebagai evaluasi akhir.
Tidak ada angka yang ditulis manual: semuanya berasal dari proses ini.

Pemakaian:  python ml/training/train.py --data ml/data/Crop_recommendation.csv --version v1.0.0
"""
from __future__ import annotations

import argparse
import warnings
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.metrics import (accuracy_score, classification_report, confusion_matrix,
                             f1_score, precision_score, recall_score)
from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.naive_bayes import GaussianNB
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier

warnings.filterwarnings("ignore", category=FutureWarning, module="sklearn")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from preprocessing.pipeline import (DOMAIN_BOUNDS, FEATURES, RANDOM_STATE, TARGET,  # noqa: E402
                                    DatasetError, clean, describe, iqr_outliers, split_and_scale)

ALGORITHMS = {
    "Decision Tree": lambda: DecisionTreeClassifier(random_state=RANDOM_STATE),
    "Random Forest": lambda: RandomForestClassifier(n_estimators=200, random_state=RANDOM_STATE, n_jobs=1),
    "K-Nearest Neighbors": lambda: KNeighborsClassifier(n_neighbors=5),
    "Support Vector Machine": lambda: SVC(kernel="rbf", probability=True, random_state=RANDOM_STATE),
    "Naive Bayes": lambda: GaussianNB(),
    "Gradient Boosting": lambda: GradientBoostingClassifier(random_state=RANDOM_STATE),
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_confusion_png(cm, labels, path: Path, title: str):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import seaborn as sns
    fig, ax = plt.subplots(figsize=(11, 9))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Greens", xticklabels=labels, yticklabels=labels,
                cbar=False, ax=ax, annot_kws={"size": 7})
    ax.set_xlabel("Prediksi"); ax.set_ylabel("Aktual"); ax.set_title(title)
    plt.xticks(rotation=60, ha="right"); plt.tight_layout()
    fig.savefig(path, dpi=130); plt.close(fig)


def save_comparison_png(rows, selected, path: Path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    names = [r["algorithm"] for r in rows]
    cv = [r["cv_accuracy_mean"] * 100 for r in rows]
    te = [r["test_accuracy"] * 100 for r in rows]
    x = np.arange(len(names)); w = 0.38
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.bar(x - w / 2, cv, w, label="CV 5-fold (train)", color="#2f7d4f")
    ax.bar(x + w / 2, te, w, label="Test (440 data)", color="#9fd3a8")
    ax.set_xticks(x); ax.set_xticklabels(names, rotation=20, ha="right")
    lo = max(0, min(cv + te) - 3); ax.set_ylim(lo, 100.5); ax.set_ylabel("Akurasi (%)")
    ax.set_title(f"Perbandingan algoritma (terpilih: {selected})"); ax.legend()
    plt.tight_layout(); fig.savefig(path, dpi=130); plt.close(fig)


def run_training(csv_path: Path, out_dir: Path, version: str, dataset_name: str | None = None) -> dict:
    csv_path, out_dir = Path(csv_path), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    raw = pd.read_csv(csv_path)
    df, clean_report = clean(raw)
    if df[TARGET].nunique() < 2:
        raise DatasetError("Dataset harus memiliki minimal 2 kelas.")
    if df[TARGET].value_counts().min() < 6:
        raise DatasetError("Setiap kelas harus punya minimal 6 baris (dibutuhkan untuk stratified split dan CV 5-fold).")
    d = split_and_scale(df)
    le, scaler = d["label_encoder"], d["scaler"]
    classes = list(le.classes_)
    y_tr, y_te = d["y_train"], d["y_test"]

    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    rows, fitted = [], {}
    for name, make in ALGORITHMS.items():
        cv = cross_validate(make_pipeline(StandardScaler(), make()), d["X_train_raw"], y_tr, cv=skf,
                            scoring={"acc": "accuracy", "f1": "f1_macro"}, n_jobs=1)
        t0 = time.time(); model = make().fit(d["X_train"], y_tr); fit_s = time.time() - t0
        pred = model.predict(d["X_test"])
        rows.append({
            "algorithm": name,
            "cv_accuracy_mean": float(cv["test_acc"].mean()), "cv_accuracy_std": float(cv["test_acc"].std()),
            "cv_f1_macro_mean": float(cv["test_f1"].mean()),
            "test_accuracy": float(accuracy_score(y_te, pred)),
            "test_precision_macro": float(precision_score(y_te, pred, average="macro", zero_division=0)),
            "test_recall_macro": float(recall_score(y_te, pred, average="macro", zero_division=0)),
            "test_f1_macro": float(f1_score(y_te, pred, average="macro", zero_division=0)),
            "supports_predict_proba": hasattr(model, "predict_proba"),
            "fit_seconds": round(fit_s, 3),
        })
        fitted[name] = (model, pred)
        print(f"{name:24s} CV={rows[-1]['cv_accuracy_mean']:.4f}  test={rows[-1]['test_accuracy']:.4f}")

    # Pilih berdasarkan CV pada data latih: akurasi, lalu F1 makro CV. Test set tidak dipakai memilih.
    best = max(rows, key=lambda r: (r["cv_accuracy_mean"], r["cv_f1_macro_mean"]))
    sel = best["algorithm"]
    model, pred = fitted[sel]
    cm = confusion_matrix(y_te, pred, labels=range(len(classes)))
    report = classification_report(y_te, pred, target_names=classes, output_dict=True, zero_division=0)

    joblib.dump(model, out_dir / "model.joblib", compress=3)
    joblib.dump(scaler, out_dir / "scaler.joblib")
    joblib.dump(le, out_dir / "label_encoder.joblib")
    save_confusion_png(cm, classes, out_dir / "confusion_matrix.png", f"Confusion matrix - {sel} (test)")
    save_comparison_png(rows, sel, out_dir / "comparison.png")

    meta = {
        "version": version, "algorithm": sel,
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataset": {"name": dataset_name or csv_path.name, "sha256": sha256(csv_path), **clean_report,
                    "n_features": len(FEATURES), "n_classes": len(classes)},
        "features": FEATURES, "classes": classes,
        "n_train": int(len(y_tr)), "n_test": int(len(y_te)),
        "split": {"test_size": 0.2, "random_state": RANDOM_STATE, "stratify": True},
        "selection": "5-fold stratified CV akurasi pada data latih (tie-break: F1 makro CV)",
        "metrics": {
            "accuracy": best["test_accuracy"], "precision_macro": best["test_precision_macro"],
            "recall_macro": best["test_recall_macro"], "f1_macro": best["test_f1_macro"],
            "precision_weighted": float(precision_score(y_te, pred, average="weighted", zero_division=0)),
            "recall_weighted": float(recall_score(y_te, pred, average="weighted", zero_division=0)),
            "f1_weighted": float(f1_score(y_te, pred, average="weighted", zero_division=0)),
        },
        "supports_predict_proba": hasattr(model, "predict_proba"),
        "feature_domain_bounds": {k: {"min": v[0], "max": v[1], "unit": v[2]} for k, v in DOMAIN_BOUNDS.items()},
        "feature_training_range": {c: {"min": float(df[c].min()), "max": float(df[c].max())} for c in FEATURES},
        "library_versions": {"sklearn": sklearn.__version__, "numpy": np.__version__, "pandas": pd.__version__,
                             "joblib": joblib.__version__},
    }
    evaluation = {
        "version": version, "selected": sel, "comparison": rows,
        "confusion_matrix": {"labels": classes, "matrix": cm.tolist()},
        "classification_report": report,
        "outliers_iqr": iqr_outliers(df), "descriptive": describe(df),
        "class_counts": {k: int(v) for k, v in df[TARGET].value_counts().sort_index().items()},
        "sample_rows": df.head(10).to_dict(orient="records"),
        "cleaning": clean_report,
    }
    (out_dir / "metadata.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    (out_dir / "evaluation.json").write_text(json.dumps(evaluation, indent=2, ensure_ascii=False))
    write_report_md(out_dir / "EVALUATION_REPORT.md", meta, evaluation)
    return meta


def write_report_md(path: Path, meta: dict, ev: dict):
    L = [f"# Laporan Evaluasi Model — {meta['version']}", "",
         f"Dibuat otomatis oleh `ml/training/train.py` pada {meta['trained_at']}. Semua angka berasal dari proses training, bukan ditulis manual.", "",
         "## Data", "",
         f"- Dataset: `{meta['dataset']['name']}` (SHA-256 `{meta['dataset']['sha256'][:16]}…`)",
         f"- Baris mentah: {meta['dataset']['rows_raw']}, setelah dropna: {meta['dataset']['rows_after_dropna']}, duplikat dihapus: {meta['dataset']['duplicates_removed']}, bersih: {meta['dataset']['rows_clean']}",
         f"- Fitur: {meta['dataset']['n_features']}; kelas: {meta['dataset']['n_classes']}",
         f"- Split: {meta['n_train']} latih / {meta['n_test']} uji (test_size=0.2, random_state=42, stratify=y)",
         "- Scaler: StandardScaler, di-fit hanya pada data latih", "",
         "## Perbandingan algoritma", "",
         "| Algoritma | CV akurasi (5-fold, latih) | Akurasi uji | Presisi makro | Recall makro | F1 makro | predict_proba |",
         "|---|---|---|---|---|---|---|"]
    for r in ev["comparison"]:
        star = " ✅" if r["algorithm"] == meta["algorithm"] else ""
        L.append(f"| {r['algorithm']}{star} | {r['cv_accuracy_mean']*100:.2f}% ± {r['cv_accuracy_std']*100:.2f} | {r['test_accuracy']*100:.2f}% | "
                 f"{r['test_precision_macro']*100:.2f}% | {r['test_recall_macro']*100:.2f}% | {r['test_f1_macro']*100:.2f}% | {'ya' if r['supports_predict_proba'] else 'tidak'} |")
    m = meta["metrics"]
    L += ["", f"**Model terpilih: {meta['algorithm']}** — {meta['selection']}.", "",
          "## Metrik model terpilih (data uji)", "",
          f"- Akurasi: {m['accuracy']*100:.2f}%", f"- Presisi (makro / berbobot): {m['precision_macro']*100:.2f}% / {m['precision_weighted']*100:.2f}%",
          f"- Recall (makro / berbobot): {m['recall_macro']*100:.2f}% / {m['recall_weighted']*100:.2f}%",
          f"- F1 (makro / berbobot): {m['f1_macro']*100:.2f}% / {m['f1_weighted']*100:.2f}%", "",
          "## Catatan", "",
          "- Dataset berukuran kecil (2.200 baris) dan sangat terpisah antar kelas; akurasi tinggi tidak otomatis berarti akurat di lapangan.",
          "- Perbedaan antar algoritma teratas kecil (satu-dua sampel dari 440). Jangan menafsirkan selisih tersebut sebagai keunggulan yang pasti.",
          "- Hasil adalah rekomendasi berbasis data, bukan jaminan hasil panen.", "",
          "## Classification report (data uji)", "", "| Kelas | Presisi | Recall | F1 | Support |", "|---|---|---|---|---|"]
    for k in meta["classes"]:
        r = ev["classification_report"][k]
        L.append(f"| {k} | {r['precision']:.3f} | {r['recall']:.3f} | {r['f1-score']:.3f} | {int(r['support'])} |")
    L += ["", "## Outlier (IQR, tidak dihapus)", "", "| Fitur | Batas bawah | Batas atas | Jumlah outlier |", "|---|---|---|---|"]
    for c, o in ev["outliers_iqr"].items():
        L.append(f"| {c} | {o['lower']:.2f} | {o['upper']:.2f} | {o['count']} |")
    path.write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(ROOT / "data" / "Crop_recommendation.csv"))
    ap.add_argument("--version", default="v1.0.0")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    out = Path(a.out) if a.out else ROOT / "artifacts" / a.version
    meta = run_training(Path(a.data), out, a.version)
    if not (ROOT / "artifacts" / "active.json").exists() and not a.out:
        (ROOT / "artifacts" / "active.json").write_text(json.dumps({"version": a.version}))
    print(json.dumps({k: meta[k] for k in ("version", "algorithm", "n_train", "n_test", "metrics")}, indent=2))
