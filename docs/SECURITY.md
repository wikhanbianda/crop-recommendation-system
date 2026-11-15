# Dokumentasi Keamanan

## Kontrol yang diterapkan
| Area | Kontrol | Bukti uji |
|---|---|---|
| Autentikasi | Supabase Auth; login lewat fungsi (audit + pembatasan laju); sesi `sessionStorage`/`localStorage` (remember me) dengan refresh token; halaman terproteksi mengarah ke login | E2E AUTH-01…15 |
| Otorisasi | Role di tabel `profiles`; **diperiksa ulang** di setiap fungsi (token → profil aktif → role) dan di database (RLS + `is_admin()`); UI hanya kemudahan | E2E AUTH-04, SEC-*, RLS 90 uji |
| Privilege escalation | `authenticated` hanya boleh `UPDATE (full_name)`; role/status via RPC `SECURITY DEFINER` + audit; trigger penjaga admin terakhir; registrasi mengabaikan input role | RLS test, fungsi |
| RLS | Aktif di semua tabel; user hanya baris sendiri; audit hanya dibaca admin dan *append-only*; percakapan AI milik sendiri (+admin) | RLS test |
| Integritas prediksi | Tidak ada hak INSERT/UPDATE pada `examinations` untuk user: hanya backend (service role) yang membuat hasil | RLS test |
| Input | Validasi frontend + ulang di server (rentang, tipe, panjang); parameterisasi PostgREST; pencarian dinetralkan dari karakter filter/wildcard | EXAM-02/05, SEC-02 |
| XSS | Seluruh keluaran di-*escape*; markdown AI dirender dengan penyaring; CSP ketat di `netlify.toml` | SEC-01, AI-12 |
| Upload dataset | ≤2 MB, ekstensi + MIME + validasi isi di layanan Python, bucket privat, tidak otomatis aktif | uji fungsi |
| Rahasia | Service role, `AI_API_KEY`, `INFERENCE_SERVICE_KEY` hanya di env server; `/config` hanya URL + anon key; build allow-list tidak mempublikasikan `ml/`, `database/`, `tests/`, `netlify/` | AI-02 |
| Rate limiting | Login (IP & email), prediksi per pengguna (setting), AI per pengguna/hari; berbasis memori per instans + hitung di database | SEC-05, AI-09 |
| AI | Lewat fungsi server; deteksi *prompt injection*; prompt sistem memisahkan hasil ML dan saran; konteks hanya atas izin; tanpa data pribadi | AI-10/11 |
| Galat | Tanpa stack trace; pesan login generik | fungsi |
| Header | CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer/Permissions-Policy | `netlify.toml` |
| CSRF | Token di header `Authorization` (bukan cookie) + pemeriksaan `Origin` pada metode mutasi | fungsi |
| Audit | Login/gagal login/logout, pengguna, role, dataset, model, pemeriksaan, pengaturan; IP bila tersedia | E2E ADM-* |

## Daftar risiko (sisa)
| # | Risiko | Tingkat | Mitigasi / tindakan |
|---|---|---|---|
| 1 | Pembatas laju in-memory per instans Netlify (tidak terbagi) | Sedang | Pembatas login memakai hitungan audit di DB; pertimbangkan Redis/Upstash untuk produksi |
| 2 | Token sesi di Web Storage dapat dicuri bila ada XSS | Sedang | CSP ketat + escape; sesi singkat; pertimbangkan cookie httpOnly bila arsitektur diubah |
| 3 | Kebocoran `SUPABASE_SERVICE_ROLE_KEY`/`INFERENCE_SERVICE_KEY` | Tinggi | Hanya di env Netlify (secret); rotasi berkala; jangan commit `.env` |
| 4 | Layanan Python publik di internet | Sedang | Kunci `X-Service-Key`; batasi ukuran body; letakkan di balik allowlist IP bila platform mendukung |
| 5 | Data dikirim ke penyedia AI pihak ketiga | Sedang | Pemberitahuan di UI, tanpa data pribadi, konteks hanya atas izin; tinjau kebijakan penyedia paket gratis (data dapat dipakai untuk peningkatan produk) |
| 6 | Ketersediaan: kuota AI gratis & layanan model | Sedang | Pesan jelas, tanpa hasil palsu; monitor |
| 7 | Dataset kecil → klaim akurasi berlebihan | Rendah | Disclaimer di hasil & laporan evaluasi |
| 8 | Perilaku Supabase/Netlify asli belum teruji di sandbox | Sedang | Daftar uji pascadeploy di DEPLOYMENT.md |
| 9 | Tidak ada pemindaian dependensi/pentest independen | Sedang | Jalankan `npm audit`/`pip-audit`, pentest sebelum produksi |

## Backup & perlindungan berkas
Backup database harian (Supabase PITR/`pg_dump`) dan uji pemulihan; bucket `datasets` privat (akses hanya service role); artefak model tidak dipublikasikan (tidak ikut `dist/`) dan hanya dimuat layanan Python; rotasi kunci saat staf berganti.
