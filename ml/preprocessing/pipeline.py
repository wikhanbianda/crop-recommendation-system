"""Preprocessing yang dikunci dari notebook UTS.

Urutan: muat -> cek struktur -> cek missing -> dropna -> drop duplikat ->
normalisasi label (strip + lowercase) -> pisah X/y -> LabelEncoder ->
split 80/20 (random_state=42, stratify=y) -> StandardScaler (fit hanya di train).
Outlier dianalisis dengan IQR tetapi TIDAK dihapus.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler

FEATURES = ["N", "P", "K", "temperature", "humidity", "ph", "rainfall"]  # urutan fitur dikunci
TARGET = "label"
TEST_SIZE = 0.2
RANDOM_STATE = 42

# Batas nilai yang masuk akal (domain) untuk validasi input. Bukan batas dataset.
DOMAIN_BOUNDS = {
    "N": (0, 200, "mg/kg"), "P": (0, 200, "mg/kg"), "K": (0, 300, "mg/kg"),
    "temperature": (0, 50, "°C"), "humidity": (0, 100, "%"),
    "ph": (0, 14, ""), "rainfall": (0, 500, "mm"),
}


class DatasetError(ValueError):
    """Dataset tidak memenuhi format yang dibutuhkan."""


def validate_frame(df: pd.DataFrame) -> pd.DataFrame:
    missing = [c for c in FEATURES + [TARGET] if c not in df.columns]
    if missing:
        raise DatasetError(f"Kolom wajib tidak ada: {', '.join(missing)}")
    df = df[FEATURES + [TARGET]].copy()
    for c in FEATURES:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def clean(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Langkah 3-6 notebook. Mengembalikan data bersih dan laporan pembersihan."""
    df = validate_frame(df)
    report = {"rows_raw": int(len(df)), "missing_per_column": {c: int(v) for c, v in df.isna().sum().items()}}
    df = df.dropna()
    report["rows_after_dropna"] = int(len(df))
    df[TARGET] = df[TARGET].astype(str).str.strip().str.lower()
    df = df[df[TARGET] != ""]
    before = len(df)
    df = df.drop_duplicates().reset_index(drop=True)
    report["duplicates_removed"] = int(before - len(df))
    report["rows_clean"] = int(len(df))
    return df, report


def iqr_outliers(df: pd.DataFrame) -> dict:
    """Analisis outlier IQR per fitur. Hanya dilaporkan, tidak dihapus."""
    out = {}
    for c in FEATURES:
        q1, q3 = df[c].quantile(0.25), df[c].quantile(0.75)
        iqr = q3 - q1
        lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        out[c] = {"q1": float(q1), "q3": float(q3), "lower": float(lo), "upper": float(hi),
                  "count": int(((df[c] < lo) | (df[c] > hi)).sum())}
    return out


def split_and_scale(df: pd.DataFrame):
    X, y_raw = df[FEATURES], df[TARGET]
    le = LabelEncoder()
    y = le.fit_transform(y_raw)
    X_tr, X_te, y_tr, y_te = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y)
    scaler = StandardScaler().fit(X_tr)  # fit hanya pada data latih
    return {
        "X_train_raw": X_tr, "X_test_raw": X_te, "y_train": y_tr, "y_test": y_te,
        "X_train": scaler.transform(X_tr), "X_test": scaler.transform(X_te),
        "scaler": scaler, "label_encoder": le,
    }


def describe(df: pd.DataFrame) -> dict:
    d = df[FEATURES].describe().T
    return {c: {k: float(d.loc[c, k]) for k in ["mean", "std", "min", "25%", "50%", "75%", "max"]} for c in FEATURES}
