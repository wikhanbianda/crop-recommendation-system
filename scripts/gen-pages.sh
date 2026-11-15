#!/bin/sh
# Membuat cangkang HTML halaman aplikasi (konten dirender oleh assets/js/pages/*.js). Jalankan dari akar proyek.
cd "$(dirname "$0")/.."
CDN='<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/sweetalert2@11.10.8/dist/sweetalert2.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/sweetalert2@11.10.8/dist/sweetalert2.all.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/lucide@0.344.0/dist/umd/lucide.min.js"></script>'
mk() { # dir file title js role
  d="$1"; up="../"; [ -z "$d" ] && up=""
  mkdir -p "${d:-.}"
  cat > "${d:+$d/}$2" <<HTML
<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$3 · Crop Recommendation System</title>
<meta name="robots" content="noindex">
<link rel="icon" href="${up}assets/images/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${up}assets/css/app.css">
$CDN
</head>
<body data-role="$5">
<a class="sr-only" href="#main">Lewati ke konten</a>
<div id="app"><div class="boot">Memuat…</div></div>
<noscript><p style="padding:2rem">Aplikasi ini membutuhkan JavaScript.</p></noscript>
<script type="module" src="${up}assets/js/pages/$4.js"></script>
</body>
</html>
HTML
}
mk admin dashboard.html "Dashboard Admin" admin-dashboard admin
mk admin users.html "Manajemen Pengguna" admin-users admin
mk admin datasets.html "Manajemen Dataset" admin-datasets admin
mk admin examinations.html "Pemeriksaan" admin-examinations admin
mk admin reports.html "Laporan" admin-reports admin
mk admin models.html "Model Machine Learning" admin-models admin
mk admin audit-logs.html "Audit Log" admin-audit admin
mk admin settings.html "Pengaturan" admin-settings admin
mk admin profile.html "Profil Admin" profile admin
mk user dashboard.html "Dashboard" user-dashboard user
mk user prediction.html "Pemeriksaan Baru" user-prediction user
mk user history.html "Riwayat Pemeriksaan" user-history user
mk user result.html "Hasil Rekomendasi" user-result user
mk user profile.html "Profil" profile user
mk ai-assistant assistant.html "Asisten AI" assistant any
