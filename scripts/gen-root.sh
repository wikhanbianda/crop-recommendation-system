#!/bin/sh
cd "$(dirname "$0")/.."
CDN='<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/sweetalert2@11.10.8/dist/sweetalert2.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/sweetalert2@11.10.8/dist/sweetalert2.all.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/lucide@0.344.0/dist/umd/lucide.min.js"></script>'
mk() { cat > "$1" <<HTML
<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$2 · Crop Recommendation System</title>
<link rel="icon" href="assets/images/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="assets/css/app.css">
$CDN
</head>
<body>
<div id="app"><div class="boot">Memuat…</div></div>
<noscript><p style="padding:2rem">Aplikasi ini membutuhkan JavaScript.</p></noscript>
<script type="module" src="assets/js/pages/$3.js"></script>
</body>
</html>
HTML
}
mk login.html Masuk login
mk register.html Daftar register
mk forgot-password.html "Lupa password" forgot-password
mk reset-password.html "Reset password" reset-password
mk dashboard.html Dashboard gate
