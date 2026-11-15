# Dokumentasi API

Semua endpoint ada di `/.netlify/functions/<nama>`. Autentikasi: header `Authorization: Bearer <access_token Supabase>`. Setiap fungsi memverifikasi token ke Supabase Auth, memeriksa profil **aktif**, dan (untuk admin) memeriksa `role = admin` dari database — bukan dari klaim klien. Respons selalu JSON dengan `cache-control: no-store`. Format galat:

```json
{ "error": "kode_mesin", "message": "Pesan untuk pengguna", "fields": { "N": "…" } }
```
Tidak pernah memuat stack trace. Permintaan `POST/PATCH/DELETE` dengan header `Origin` asing ditolak (403 `bad_origin`). Kode umum: 400 body bukan JSON, 401 tanpa/token tidak valid, 403 bukan admin/akun nonaktif, 405 metode salah, 413 terlalu besar, 422 validasi, 429 pembatasan laju, 503 layanan hilir tak tersedia.

## Publik
| Endpoint | Keterangan |
|---|---|
| `GET config` | `{ supabaseUrl, supabaseAnonKey, registrationEnabled, appName }`. Tidak pernah memuat service role / API key. |
| `POST auth?action=login` | `{email,password}` → `{session,user}`. Dibatasi laju (IP & email; 8 gagal/15 mnt per email → 429), tercatat di audit (`auth.login`, `auth.login_failed`). Pesan gagal generik; akun nonaktif → 403 `account_inactive`. |
| `POST auth?action=logout` | Mencatat audit `auth.logout`. |
| `GET auth` | Profil pemanggil (`user`). |
| `POST register` | `{email,full_name,password}`; 403 bila `registration_enabled=false`. Role selalu `user` (input role diabaikan). |

## User (login)
| Endpoint | Keterangan |
|---|---|
| `POST prediction` | `{features:{N,P,K,temperature,humidity,ph,rainfall}}`. Validasi server: wajib, numerik hingga, rentang N 0–200, P 0–200, K 0–300, suhu 0–50 °C, kelembapan 0–100 %, pH 0–14, hujan 0–500 mm. Memanggil layanan Python, menyimpan ke `examinations` (hanya backend yang bisa INSERT), audit. 201 `{examination, model, probabilities, out_of_training_range}`; 422 `fields`; 429; 503 `inference_unavailable`/`no_active_model`/`model_mismatch` (tanpa baris tersimpan). |
| `GET ai-chat` | Status: `{enabled, configured, dailyLimit, usedLast24h}`. |
| `POST ai-chat` | `{message (≤2000), conversation_id?, exam_id?}`. `exam_id` hanya dikirim bila pengguna mencentang izin; konteks dibaca dari baris milik sendiri tanpa data pribadi. Pembatas harian per pengguna, deteksi *prompt injection* (ditolak tanpa memanggil penyedia, audit `ai.injection_blocked`). Galat penyedia dipetakan: kuota habis → 429 pesan jelas; kunci hilang → 503; tanpa *fallback* diam-diam. |

Baca/hapus riwayat (`examinations`, `ai_conversations`, `ai_messages`) dilakukan browser langsung ke PostgREST dengan token pengguna; RLS membatasi pada baris miliknya (admin: semua).

## Admin
| Endpoint | Keterangan |
|---|---|
| `GET admin-users?page&size&q&role&status` | Daftar pengguna. `?id=<uuid>` → detail + 30 aktivitas terakhir + jumlah pemeriksaan. |
| `POST admin-users` | `{email,full_name,password,role?}` membuat akun via Auth Admin API (service role di server). |
| `PATCH admin-users?id=` | `{full_name?, role?, status?, password?}`; role/status lewat RPC `SECURITY DEFINER` (diperiksa ulang di DB + audit). Tidak bisa menonaktifkan diri sendiri / menurunkan admin aktif terakhir. |
| `DELETE admin-users?id=` | Hapus akun (dengan kebijakan yang sama); jejak audit tetap ada. |
| `GET datasets[?id=]` / `POST datasets?version&name` | Unggah CSV (≤2 MB, ekstensi `.csv`, MIME teks, isi divalidasi layanan Python: kolom wajib, tipe, rentang). Disimpan ke Storage privat; **tidak** mengganti model aktif. |
| `GET models` / `GET models?job=<versi>` | Daftar versi + evaluasi; pantau job training. |
| `POST models?action=train` | Latih kandidat dari dataset (asinkron di layanan Python). |
| `POST models?action=activate` / `reject` | Persetujuan admin; aktivasi lewat RPC (tepat satu model aktif; audit). |

Pengaturan (`application_settings`) diubah lewat RPC `admin_update_setting`; statistik lewat RPC `admin_stats` / `admin_report_summary` (hanya admin).

## Layanan inferensi Python (hanya dipanggil Netlify Functions)
Header `X-Service-Key` wajib (perbandingan *constant-time*) kecuali `/health`.
`GET /health` · `GET /model` · `POST /predict` · `POST /admin/validate` · `GET /admin/dataset/builtin` · `GET /admin/versions` · `POST /admin/train` · `GET /admin/train/<versi>` · `POST /admin/activate`.
`/predict` memuat artefak sekali; hanya `scaler.transform` dan `predict_proba` — tanpa fit ulang dan tanpa training per prediksi. Nilai di luar rentang data latih dilaporkan di `out_of_training_range`.
