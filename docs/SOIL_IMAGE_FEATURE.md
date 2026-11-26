# Fitur tambahan: Rekomendasi tanaman dari FOTO tanah

Fitur ini **terpisah** dari pemeriksaan N, P, K, pH (model Naive Bayes v1.0.0 tidak diubah). Alurnya:

```
Foto tanah (browser: dikecilkan, dienkode ulang ke JPEG, EXIF dibuang)
  -> Netlify Function soil-prediction (login, rate limit, cek JPEG, batas 1,5 MB, audit)
  -> Layanan Python POST /predict-soil (ekstraksi fitur warna+tekstur -> klasifikasi jenis tanah)
  -> Pemetaan jenis tanah -> tanaman (ml/soil/soil_crop_map.json) -> 5 tanaman teratas
```

Foto **tidak disimpan**. Audit log hanya mencatat jenis tanah hasil, versi model, dan ukuran berkas.

## Dua tahap, dan batasannya (penting untuk laporan/sidang)
1. **Jenis tanah dari foto**: model Machine Learning (SVM RBF, fitur warna HSV/RGB + tekstur, scikit-learn). Ini bagian yang dievaluasi dengan data uji.
2. **Tanaman dari jenis tanah**: **pemetaan umum** berdasar literatur agronomi, BUKAN hasil Machine Learning dan TIDAK ada dalam dataset. Dataset foto hanya berisi label jenis tanah, tidak ada label tanaman, jadi tahap ini tidak mungkin dipelajari dari data. Pemetaan harus divalidasi dosen/penyuluh. Isinya dapat diubah di `ml/soil/soil_crop_map.json` tanpa melatih ulang.
3. Skor tanaman (persen) = skor kecocokan relatif: jumlah (peluang jenis tanah x bobot kecocokan). Bukan peluang panen.
4. Foto tidak bisa mengukur N, P, K, pH. Karena itu fitur ini hanya memberi saran kasar; pemeriksaan N, P, K, pH tetap lebih informatif.

## Dataset
Dipakai: **Soil Classification Dataset** (Phantom-fs, GitHub), folder `Orignal-Dataset`: 7 jenis tanah (Alluvial, Arid, Black, Laterite, Mountain, Red, Yellow), 1.189 foto asli. Lisensi **CC BY-NC 4.0** (boleh untuk riset/pendidikan, tidak untuk komersial; wajib mencantumkan sumber).
https://github.com/Phantom-fs/Soil-Classification-Dataset

Alternatif: SoilClass (Mendeley Data, 552 foto, CC BY 4.0) hanya berlabel "Type 1-5" tanpa nama jenis tanah, sehingga tidak bisa dipetakan ke tanaman tanpa penjelasan pembuatnya. Dataset Roboflow bervariasi kualitas dan kelasnya.
Catatan: jenis tanah di dataset memakai klasifikasi India (mis. Laterite, Alluvial). Bila dosen punya foto tanah Indonesia sendiri, latih ulang dengan perintah di bawah memakai folder per kelas.

## Hasil pelatihan nyata (versi s1.0.0)
- Gambar dipakai 1.140 (49 duplikat persis dibuang). Split ~80/20 (912 latih / 228 uji), stratified, random_state=42, dan **dikelompokkan per foto asal** (mis. `20.jpg`, `20a.jpg`, `20c.jpg` satu grup) agar tidak bocor antar latih/uji.
- Pemilihan algoritma: cross-validation 5-fold pada data latih. Macro-F1: Logistic Regression 0,745; Random Forest 0,732; **SVM RBF 0,747 (dipilih)**.
- Data uji (dipakai sekali): **akurasi 87,7%**, macro-F1 83,5%.
- Per kelas (F1): black 0,97; yellow 0,92; red 0,91; laterite 0,89; mountain 0,86; arid 0,85; **alluvial 0,44**.
- Kelemahan: kelas **alluvial** hanya 50 foto (10 di data uji) sehingga sering tertukar dengan laterite/arid. Angka ini bukan akurasi di lapangan: foto di luar dataset (cahaya, kamera, tanah Indonesia) bisa jauh lebih buruk. Model klasik ini tidak sekuat CNN, tetapi cukup ringan untuk hosting gratis.
- Rincian lengkap (confusion matrix, per kelas): `ml/soil_artifacts/s1.0.0/metadata.json`.

## Melatih ulang (dengan data dosen)
```
pip install -r ml/requirements.txt        # butuh scikit-learn, pillow, joblib
python ml/soil/train_soil.py --data PATH/dataset --version s1.1.0
```
`PATH/dataset` berisi satu folder per jenis tanah (`alluvial/`, `black/`, ...). Nama folder, setelah huruf kecil dan akhiran `_soil` dibuang, **harus ada** di `soil_crop_map.json`; kalau belum, skrip berhenti dan meminta pemetaannya ditambah. Versi baru otomatis menjadi aktif (`ml/soil_artifacts/active.json`). Setelah itu upload folder versi dan `active.json` ke PythonAnywhere, lalu Reload.

## Pasang di hosting
1. GitHub: tambahkan file baru/ubah sesuai daftar di `README_TAMBAHAN.txt`, commit. Netlify otomatis deploy.
2. PythonAnywhere: upload folder `soil/` dan `soil_artifacts/` ke folder yang sama dengan `service/` dan `training/`, ganti `service/app.py`, jalankan `pip install pillow` di venv, lalu **Reload**.
3. Tidak ada variabel lingkungan baru dan tidak ada perubahan database.

## Pengujian
- `tests/test_soil_service.py` (layanan Python: model belum ada -> 503, tanpa kunci -> 401, training CLI, inferensi, gambar buruk, kelas tanpa pemetaan).
- `tests/soil.functions.test.mjs` (fungsi Netlify: login, bukan JPEG, kosong, terlalu besar, JPEG rusak, layanan mati -> 503, audit tanpa data gambar).
- `tests/e2e/soil-ui.mjs` (browser: menu, pesan model belum dilatih, upload, hasil, berkas salah, 375 px, tanpa error JS).
Ketiga uji memakai model dari data **sintetis** hanya untuk membuktikan alur. Akurasi sebenarnya hanya angka pada bagian "Hasil pelatihan nyata" di atas.

## Gerbang "bukan tanah" (model s1.1.0)

Masalah: pengklasifikasi jenis tanah selalu memilih salah satu kelas, sehingga foto kucing atau layar pun "terbaca" sebagai tanah.
Solusi: sebelum menebak jenis tanah, foto dinilai oleh model biner terpisah (SVM RBF, 69 fitur: 55 fitur warna/tekstur + 14 fitur tata letak).

- Data latih gerbang: foto tanah (data latih saja) vs 800 foto umum ImageNet + 240 gambar sintetis (warna rata, gradasi, derau, halaman teks, tampilan aplikasi). 20% negatif disimpan untuk uji.
- Ambang ditentukan dari skor out-of-fold foto tanah pada data latih saja: **tolak** bila skor > 0,7759 (95% foto tanah tetap lolos), **peringatan** bila > 0,5389 (90%).
- Tolak -> HTTP 422 `not_soil`, tidak ada rekomendasi, dicatat di audit `soil.rejected`. Peringatan -> hasil tetap tampil dengan kotak "Foto ini kurang mirip tanah".

### Batas yang jujur
- Pada uji internal: 35 foto tanah uji -> 4 ditolak (sekitar 11%), 0 peringatan. 142 foto non-tanah eksternal -> 86 ditolak, 18 peringatan, 38 lolos (sekitar 61% ditolak, 73% ditolak atau diberi peringatan).
- Objek bertekstur mirip tanah (rumput, kerikil, bata, sebagian tangkapan layar) bisa lolos. Gerbang adalah mitigasi, bukan jaminan.
- Belum diuji pada foto tanah Papua. Jika foto tanah asli sering ditolak, naikkan `reject_threshold` di `metadata.json` (mis. dari 0.7759 ke 0.85), lalu Reload.

### Melatih ulang
`python ml/soil/train_soil.py --data DATASET --version s1.2.0 --negatives FOLDER_FOTO_UMUM [--external FOLDER_EVAL]`
Tanpa `--negatives` gerbang tidak dibuat (peringatan dicetak). Rollback: ubah `ml/soil_artifacts/active.json` ke `s1.0.0`.
