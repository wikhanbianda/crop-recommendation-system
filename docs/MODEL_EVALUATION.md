# Laporan Evaluasi Model — v1.0.0

Dibuat otomatis oleh `ml/training/train.py` pada 2026-11-11T19:30:15+00:00. Semua angka berasal dari proses training, bukan ditulis manual.

## Data

- Dataset: `Crop_recommendation.csv` (SHA-256 `54a5a6e5408668e6…`)
- Baris mentah: 2200, setelah dropna: 2200, duplikat dihapus: 0, bersih: 2200
- Fitur: 7; kelas: 22
- Split: 1760 latih / 440 uji (test_size=0.2, random_state=42, stratify=y)
- Scaler: StandardScaler, di-fit hanya pada data latih

## Perbandingan algoritma

| Algoritma | CV akurasi (5-fold, latih) | Akurasi uji | Presisi makro | Recall makro | F1 makro | predict_proba |
|---|---|---|---|---|---|---|
| Decision Tree | 98.52% ± 0.68 | 97.95% | 98.06% | 97.95% | 97.94% | ya |
| Random Forest | 99.38% ± 0.45 | 99.55% | 99.57% | 99.55% | 99.55% | ya |
| K-Nearest Neighbors | 96.53% ± 1.21 | 97.95% | 98.04% | 97.95% | 97.93% | ya |
| Support Vector Machine | 97.90% ± 1.03 | 98.41% | 98.56% | 98.41% | 98.40% | ya |
| Naive Bayes ✅ | 99.49% ± 0.42 | 99.55% | 99.59% | 99.55% | 99.54% | ya |
| Gradient Boosting | 98.69% ± 0.34 | 98.86% | 98.97% | 98.86% | 98.87% | ya |

**Model terpilih: Naive Bayes** — 5-fold stratified CV akurasi pada data latih (tie-break: F1 makro CV).

## Metrik model terpilih (data uji)

- Akurasi: 99.55%
- Presisi (makro / berbobot): 99.59% / 99.59%
- Recall (makro / berbobot): 99.55% / 99.55%
- F1 (makro / berbobot): 99.54% / 99.54%

## Catatan

- Dataset berukuran kecil (2.200 baris) dan sangat terpisah antar kelas; akurasi tinggi tidak otomatis berarti akurat di lapangan.
- Perbedaan antar algoritma teratas kecil (satu-dua sampel dari 440). Jangan menafsirkan selisih tersebut sebagai keunggulan yang pasti.
- Hasil adalah rekomendasi berbasis data, bukan jaminan hasil panen.

## Classification report (data uji)

| Kelas | Presisi | Recall | F1 | Support |
|---|---|---|---|---|
| apple | 1.000 | 1.000 | 1.000 | 20 |
| banana | 1.000 | 1.000 | 1.000 | 20 |
| blackgram | 1.000 | 1.000 | 1.000 | 20 |
| chickpea | 1.000 | 1.000 | 1.000 | 20 |
| coconut | 1.000 | 1.000 | 1.000 | 20 |
| coffee | 1.000 | 1.000 | 1.000 | 20 |
| cotton | 1.000 | 1.000 | 1.000 | 20 |
| grapes | 1.000 | 1.000 | 1.000 | 20 |
| jute | 0.909 | 1.000 | 0.952 | 20 |
| kidneybeans | 1.000 | 1.000 | 1.000 | 20 |
| lentil | 1.000 | 1.000 | 1.000 | 20 |
| maize | 1.000 | 1.000 | 1.000 | 20 |
| mango | 1.000 | 1.000 | 1.000 | 20 |
| mothbeans | 1.000 | 1.000 | 1.000 | 20 |
| mungbean | 1.000 | 1.000 | 1.000 | 20 |
| muskmelon | 1.000 | 1.000 | 1.000 | 20 |
| orange | 1.000 | 1.000 | 1.000 | 20 |
| papaya | 1.000 | 1.000 | 1.000 | 20 |
| pigeonpeas | 1.000 | 1.000 | 1.000 | 20 |
| pomegranate | 1.000 | 1.000 | 1.000 | 20 |
| rice | 1.000 | 0.900 | 0.947 | 20 |
| watermelon | 1.000 | 1.000 | 1.000 | 20 |

## Outlier (IQR, tidak dihapus)

| Fitur | Batas bawah | Batas atas | Jumlah outlier |
|---|---|---|---|
| N | -73.88 | 179.12 | 0 |
| P | -32.00 | 128.00 | 138 |
| K | -23.50 | 92.50 | 200 |
| temperature | 14.08 | 37.25 | 86 |
| humidity | 15.73 | 134.48 | 30 |
| ph | 4.54 | 8.35 | 57 |
| rainfall | -25.02 | 213.84 | 100 |
