# Crop Recommendation System

Aplikasi web rekomendasi tanaman berdasarkan kondisi tanah dan iklim (N, P, K, suhu, kelembapan, pH, curah hujan), lanjutan dari UTS Data Science (dataset Kaggle *Crop Recommendation*, 2.200 baris, 22 tanaman).
Frontend HTML/CSS/JavaScript murni, autentikasi + database Supabase (RLS), backend Netlify Functions, model scikit-learn dilayani layanan inferensi Python.

> Peran: **Admin** (kelola pengguna, dataset, model, laporan, audit, pengaturan) dan **User** (pemeriksaan, riwayat, profil, AI Assistant).

## Arsitektur

```
Browser (HTML/CSS/JS, Chart.js, SweetAlert2, Lucide dengan fallback)
   │  JWT Supabase                         ┌───────────────────────────┐
   ├──────────── Supabase Auth ───────────▶│ Supabase (Postgres + RLS) │◀──┐ service role
   ├── PostgREST (hanya baca / RPC, RLS) ─▶│ Storage privat "datasets" │   │ (hanya di server)
   │                                       └───────────────────────────┘   │
   └── /.netlify/functions/*  (Netlify Functions: gateway terautentikasi) ─┤
            auth · register · prediction · admin-users · datasets · models · ai-chat · config
                 │                                   │
                 │ X-Service-Key                     │ API key di env server
                 ▼                                   ▼
      Layanan inferensi Python (Flask/Docker)    Gemini / Groq (paket gratis)
      model.joblib + scaler.joblib + label_encoder.joblib
```

**Mengapa layanan Python terpisah?** Netlify Functions tidak menjalankan Python/scikit-learn. Aturan proyek melarang meniru model dengan JavaScript, jadi prediksi dilakukan oleh model joblib asli di layanan Python (Docker; mis. Render, Fly.io, Cloud Run, Hugging Face Spaces). Bila layanan tidak aktif, pengguna mendapat galat jelas (503) dan **tidak ada hasil tiruan** maupun data tersimpan.

## Hasil model (nyata, dari `ml/training/train.py`)

Pipeline UTS dipertahankan: label strip+lowercase → dropna → drop duplikat → LabelEncoder → split 80/20 (`random_state=42`, `stratify=y`) → 1.760 latih / 440 uji → `StandardScaler` di-fit hanya pada data latih. Outlier IQR dianalisis, tidak dihapus.
Enam algoritma dibandingkan; model dipilih dari CV 5-fold pada **data latih** (bukan data uji): **Naive Bayes** (akurasi uji 99,55%; Random Forest juga 99,55%). Selisih antar model teratas hanya 1–2 sampel dari 440 — lihat [docs/MODEL_EVALUATION.md](docs/MODEL_EVALUATION.md).

## Struktur

```
index/login/register/forgot-password/reset-password/dashboard.html
admin/ (dashboard, users, datasets, examinations, reports, models, audit-logs, settings, profile)
user/  (dashboard, prediction, result, history, profile)      ai-assistant/assistant.html
assets/{css,js,images,icons}   services/{supabase,auth,api,prediction,ai}.js
netlify/functions/*.js (+ _lib/)   ml/{preprocessing,training,evaluation,artifacts,service,data}
database/{schema,triggers,policies,seed}.sql   tests/   docs/   netlify.toml   .env.example
```

## Mulai cepat (lokal)

```bash
pip install -r ml/requirements.txt
python ml/training/train.py --data ml/data/Crop_recommendation.csv --version v1.0.0   # opsional; artefak v1.0.0 sudah disertakan
cp .env.example .env     # isi nilai asli (jangan di-commit)
INFERENCE_SERVICE_KEY=... python ml/service/app.py            # layanan model
node scripts/dev-server.mjs                                   # statis + /.netlify/functions/* lokal
```

Pengujian: `python -m pytest tests/test_ml_service.py`, `node --test tests/functions.test.mjs`, `node tests/e2e/e2e.mjs`, `sh tests/db/setup.sh <socket> <port> <db> && python3 tests/test_db_rls.py <socket> <port> <db>`.

## Dokumentasi

| Berkas | Isi |
|---|---|
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Instalasi & deploy Supabase, layanan Python, Netlify; admin pertama; uji pascadeploy |
| [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) / [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Panduan Admin / User |
| [docs/API.md](docs/API.md) | Endpoint Netlify Functions & layanan inferensi |
| [docs/SECURITY.md](docs/SECURITY.md) | Model keamanan, daftar risiko, backup |
| [docs/MODEL_EVALUATION.md](docs/MODEL_EVALUATION.md) | Laporan evaluasi model |
| [docs/TEST_REPORT.md](docs/TEST_REPORT.md) | Laporan pengujian + batasan yang belum teruji |

## Batasan yang perlu diketahui

- Rekomendasi adalah saran berbasis data, **bukan jaminan hasil panen**; akurasi tinggi pada dataset kecil dan terpisah antar-kelas tidak otomatis berarti akurat di lapangan.
- AI Assistant memakai paket gratis penyedia (kuota berubah; tidak tak terbatas). Bila kuota habis, pengguna melihat pesan jelas — tidak ada *fallback* diam-diam ke penyedia lain.
- Pengujian memakai Supabase dan penyedia AI **palsu**; verifikasi setelah deploy wajib (lihat TEST_REPORT).
