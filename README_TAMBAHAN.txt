TAMBAHAN FITUR: REKOMENDASI DARI FOTO TANAH
Struktur folder di ZIP ini sama dengan proyek. Salin ke proyek (timpa bila sudah ada).

BARU:
  ml/soil/__init__.py, features.py, routes.py, train_soil.py, soil_crop_map.json
  ml/soil_artifacts/active.json, ml/soil_artifacts/s1.0.0/{model.joblib,metadata.json}
  netlify/functions/soil-prediction.js
  services/soil.js
  assets/js/pages/user-soil.js
  user/soil.html
  docs/SOIL_IMAGE_FEATURE.md
  tests/test_soil_service.py, tests/soil.functions.test.mjs, tests/e2e/soil-ui.mjs, tests/support/make_soil_fixture.py
DIUBAH (tambahan kecil):
  ml/service/app.py        (+2 baris: mendaftarkan rute foto tanah)
  assets/js/ui.js          (+1 menu "Rekomendasi dari foto" untuk user)
  assets/css/app.css       (+1 baris: [hidden]{display:none!important}, memperbaiki kotak error merah kosong)
  ml/requirements.txt      (+pillow)

GITHUB: unggah semua berkas di atas (ml/soil_artifacts ikut, ukuran model hanya ~300 KB). JANGAN unggah wsgi_crop.py berisi kunci asli.
PYTHONANYWHERE: upload folder soil/ dan soil_artifacts/ ke folder yang sama dengan service/ dan training/ ; ganti service/app.py ;
  di Bash console: source ~/venv/bin/activate && pip install pillow==12.3.0 ; lalu tab Web -> Reload.
