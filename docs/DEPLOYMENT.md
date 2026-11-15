# Panduan Instalasi & Deployment

Urutan: **Supabase → layanan inferensi Python → Netlify → uji pascadeploy.** Jangan pernah memasukkan service role key / API key asli ke repository.

## 1. Supabase
1. Buat project di supabase.com. Catat **Project URL**, **anon key**, dan **service_role key** (Settings → API).
2. SQL Editor → jalankan berurutan isi: `database/schema.sql`, `database/triggers.sql`, `database/policies.sql`, `database/seed.sql` (idempoten; aman diulang). RLS aktif pada seluruh tabel lewat skema ini; `policies.sql` mencabut hak anon/authenticated lalu memberi hak minimum.
3. Storage → buat bucket **privat** bernama `datasets` (tanpa akses publik). Unggah dataset hanya lewat halaman Admin → Dataset.
4. Authentication → Providers → Email: aktif. **Matikan "Allow new users to sign up"** (pendaftaran publik) agar registrasi hanya lewat fungsi `register` yang memeriksa pengaturan admin. Atur *Site URL* ke domain Netlify dan tambahkan `https://DOMAIN/reset-password.html` pada *Redirect URLs*.
5. **Admin pertama (prosedur aman):** Authentication → Users → *Add user* (email + password kuat, centang auto-confirm). Lalu di SQL Editor:
   ```sql
   update public.profiles set role = 'admin' where email = 'admin@contoh.id';
   ```
   (SQL Editor berjalan sebagai superuser; pengguna biasa tidak bisa mengubah role karena kolom `role` tidak diberi hak UPDATE dan ada trigger penjaga admin terakhir.) Admin berikutnya dibuat dari halaman Admin → Pengguna.
6. Backup: aktifkan backup harian (paket Pro) atau jadwalkan `pg_dump` ke penyimpanan terenkripsi; uji pemulihan secara berkala.

## 2. Layanan inferensi Python
```bash
docker build -f ml/service/Dockerfile -t crop-inference .
docker run -p 8000:8000 -e INFERENCE_SERVICE_KEY=<string-acak-panjang> crop-inference
```
Deploy image ke Render/Fly.io/Cloud Run/HF Spaces. Set `INFERENCE_SERVICE_KEY` di environment platform (bukan di image). Cek `GET /health`. Artefak `ml/artifacts/v1.0.0` dan `active.json` ikut image; versi hasil latih ulang dari halaman Admin disimpan di disk layanan — pada platform dengan disk sementara, gunakan *persistent disk* atau bangun ulang image dengan artefak yang disetujui.

## 3. Netlify
1. Hubungkan repository (build command & publish sudah di `netlify.toml`: `node scripts/build.mjs` → `dist/`; hanya berkas publik yang dipublikasikan).
2. Site settings → Environment variables (lihat `.env.example`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `INFERENCE_SERVICE_URL`, `INFERENCE_SERVICE_KEY`, `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, opsional `AI_API_BASE_URL`, `ALLOWED_ORIGINS`. Tandai kunci sebagai *secret*.
3. Deploy. Domain kustom: Domain management → Add domain; HTTPS otomatis. Perbarui *Site URL* Supabase.

## 4. AI Assistant (paket gratis)
Provider utama Gemini (`AI_PROVIDER=gemini`, `AI_MODEL=gemini-2.5-flash`); alternatif Groq (`AI_PROVIDER=groq`, model sesuai daftar paket gratis di konsol Groq). Pada saat penulisan, halaman harga Gemini API mencantumkan Gemini 2.5 Flash / Flash-Lite dan beberapa model lain sebagai gratis — **kuota dan model berubah**; cek konsol penyedia sebelum produksi. Batas per pengguna dapat diatur Admin (`ai_daily_limit`). Penyedia tidak pernah di-*fallback* diam-diam; bila kuota habis pengguna melihat pesan jelas.

## 5. Uji pascadeploy (wajib — belum teruji di Supabase/Netlify asli)
- [ ] Login admin, `GET /.netlify/functions/config` hanya memuat URL + anon key.
- [ ] Pemeriksaan sebagai user: hasil muncul, baris tersimpan, versi model tampil; matikan layanan Python → pesan galat, tidak ada baris baru.
- [ ] User biasa membuka `/admin/*` → ditolak; ubah role lewat REST dengan token user → gagal.
- [ ] Lupa password: email terkirim, tautan membuka halaman reset.
- [ ] Unggah CSV dataset valid & tidak valid; latih kandidat; setujui → model aktif berganti.
- [ ] AI Assistant: balasan normal; kuota habis menampilkan pesan jelas.
- [ ] Uji kebijakan RLS memakai token user kedua terhadap `examinations`/`ai_conversations` milik pengguna lain.
