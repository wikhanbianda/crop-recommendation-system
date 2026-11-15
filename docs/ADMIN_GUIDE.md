# Panduan Admin

Masuk di `login.html` dengan akun ber-role admin; Anda diarahkan ke `admin/dashboard.html`. Semua tindakan penting meminta konfirmasi dan tercatat di Audit Log.

- **Dashboard** — kartu: total pengguna, total pemeriksaan, prediksi hari ini, jumlah jenis tanaman, jumlah dataset, status model; grafik pemeriksaan per hari/bulan, distribusi rekomendasi, aktivitas pengguna; tabel pemeriksaan terbaru (cari, filter, urut, halaman, detail). Angka dari database.
- **Pengguna** — tambah pengguna (password tidak pernah ditampilkan), ubah nama, aktif/nonaktifkan, ubah role, lihat tanggal daftar, status, riwayat aktivitas, hapus. Sistem menolak menonaktifkan diri sendiri atau menurunkan admin aktif terakhir.
- **Dataset** — lihat info (baris, fitur, kelas, kolom, sampel), unggah CSV baru (≤2 MB; divalidasi), riwayat versi, aktifkan. Dataset baru **tidak** mengganti model aktif.
- **Model ML** — model aktif, metrik, matriks konfusi, perbandingan 6 algoritma, riwayat versi. Alur dataset baru: unggah → validasi → latih kandidat → tinjau evaluasi → **setujui** (aktif) atau tolak.
- **Pemeriksaan** — seluruh pemeriksaan semua pengguna; cari/filter/urut/detail.
- **Laporan** — filter tanggal/pengguna/tanaman; ringkasan, grafik; ekspor **CSV** dan **PDF** (cetak ke PDF dari browser).
- **Audit Log** — login, gagal login, tambah pengguna, ubah role, dataset, aktivasi model, pemeriksaan, pengaturan. Tidak dapat diubah/dihapus dari aplikasi.
- **Pengaturan** — pendaftaran mandiri, AI Assistant (aktif/batas harian), batas laju prediksi, mode pemeliharaan. Nilai tak valid ditolak.
- **AI Assistant** — dapat dimatikan dan dibatasi dari Pengaturan; percakapan pengguna hanya dapat dibaca pemiliknya dan admin (kebijakan RLS).
