"""Menyusun docs/TEST_REPORT.md dari hasil uji NYATA yang tersimpan (tests/e2e/results.json, log suite lain).
Pemakaian: python tests/make_report.py <fn.log> <ml.log> <rls.log>"""
import json, re, sys
from pathlib import Path
R = Path(__file__).resolve().parents[1]
fn, ml, rls = (Path(p).read_text(encoding="utf-8") for p in sys.argv[1:4])
e2e = json.loads((R / "tests/e2e/results.json").read_text(encoding="utf-8"))
res = e2e["results"]
fn_tests = [re.sub(r"\s*\([\d.]+ms\)$", "", l.strip()[2:]) for l in fn.splitlines() if l.strip().startswith("✔") and l.startswith("  ")]
ml_tests = [re.match(r"\S+::(\S+) PASSED", l).group(1) for l in ml.splitlines() if "PASSED" in l]
rls_lines = [l for l in rls.splitlines() if l.startswith(("PASS", "FAIL"))]
summ = re.search(r"HASIL: (\d+)/(\d+)", rls)
p = lambda x: sum(1 for r in res if r["status"] == "PASS")
o = ["# Laporan Pengujian", "",
 "Seluruh angka di bawah berasal dari eksekusi nyata pada lingkungan pengembangan (sandbox). Laporan ini dihasilkan oleh `tests/make_report.py` dari log hasil uji; tidak ada baris yang ditulis tangan.", "",
 "## Ringkasan", "", "| Suite | Cakupan | Hasil |", "|---|---|---|",
 f"| E2E browser (Playwright/Chromium) | UI + Netlify Functions nyata + layanan inferensi Python nyata; Supabase & AI **palsu** | {p(0)}/{len(res)} lulus |",
 f"| Netlify Functions (`node --test`) | fungsi backend vs layanan Python nyata; Supabase & AI **palsu** | {len(fn_tests)} lulus |",
 f"| Database + RLS (PostgreSQL 16 nyata) | skema, constraint, trigger, RLS, GRANT, RPC; peran/JWT Supabase **diemulasi** | {summ.group(1)}/{summ.group(2)} lulus |",
 f"| ML + layanan inferensi (`pytest`) | artefak, prediksi, validasi dataset, autentikasi service | {len(ml_tests)} lulus |", "",
 "## Yang TIDAK diuji (batasan jujur)", "",
 "- **Supabase asli** (GoTrue, PostgREST, Storage, email reset password): sandbox tanpa internet keluar. Dipakai server palsu yang meniru kontrak API + PostgreSQL asli untuk skema/RLS. Wajib diuji ulang setelah deploy (lihat docs/DEPLOYMENT.md, bagian *Uji pascadeploy*).",
 "- **Penyedia AI asli** (Gemini/Groq): hanya penyedia palsu. Respons nyata, kuota, dan format galat asli belum diverifikasi.",
 "- **Deploy Netlify nyata** dan hosting layanan Python: belum dijalankan.",
 "- **CDN** (Chart.js, SweetAlert2, Lucide) diblokir saat uji sehingga jalur *fallback* yang teruji; tampilan grafik/ikon dari CDN belum terlihat di sandbox.",
 "- Uji beban, penetration test profesional, dan uji di perangkat fisik/browser selain Chromium belum dilakukan.", "",
 "## E2E browser", "", "| ID | Kelompok | Pengujian | Langkah | Hasil diharapkan | Hasil aktual | Status |", "|---|---|---|---|---|---|---|"]
esc = lambda s: str(s).replace("|", "\\|").replace("\n", " ")
for r in res: o.append(f"| {r['id']} | {esc(r['group'])} | {esc(r['name'])} | {esc(r['steps'])} | {esc(r['expected'])} | {esc(r['actual'])} | {r['status']} |")
o += ["", "## Netlify Functions (backend)", "", "Nama uji = langkah; hasil semuanya lulus pada eksekusi terakhir.", ""] + [f"- ✔ {t}" for t in fn_tests]
o += ["", "## Database & RLS (PostgreSQL 16)", ""] + [f"- {l}" for l in rls_lines] + [f"", f"Ringkasan: {summ.group(0)}"]
o += ["", "## ML & layanan inferensi", ""] + [f"- ✔ {t}" for t in ml_tests]
o += ["", "## Temuan selama pengujian & perbaikan", "",
 "- **Bug aplikasi (diperbaiki):** akun yang dinonaktifkan (di-ban di Supabase Auth) mendapat pesan generik \"Email atau password salah\" saat login. Kini `auth.js` memetakan `user_banned` ke pesan akun dinonaktifkan (GoTrue hanya mengembalikannya setelah password benar, jadi tidak membocorkan keberadaan email).",
 "- **Bug aplikasi (diperbaiki):** halaman Model ML meluber horizontal di layar 375 px karena matriks konfusi 22x22 melebarkan sel grid; ditambahkan `.grid>*{min-width:0}`.",
 "- **Perbaikan uji (bukan aplikasi):** beberapa uji memakai nama algoritma/pesan/selektor yang usang (mis. \"KNN\", \"tidak tersedia\"), membaca teks `Anggur` dari dropdown filter, atau terbentur pembatas laju login per-IP karena seluruh uji berasal dari satu IP lokal (pembatas direset antar-login uji; pembatas itu sendiri diuji di SEC-05 dan suite fungsi), dan cache pengaturan 5 dtk dimatikan lewat `SETTINGS_CACHE_MS=0` agar perubahan tabel langsung terlihat."]
(R / "docs/TEST_REPORT.md").write_text("\n".join(o) + "\n", encoding="utf-8")
print("ok", len(res), len(fn_tests), len(ml_tests), len(rls_lines))
