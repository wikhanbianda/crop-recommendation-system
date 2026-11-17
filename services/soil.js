// Rekomendasi dari foto tanah. Gambar dikecilkan & dienkode ulang ke JPEG di browser (menghapus metadata EXIF/lokasi),
// lalu dikirim ke backend; inferensi dilakukan model Python, bukan di browser.
import { fn } from './api.js';
import { ApiError } from './supabase.js';

export const MAX_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_SIDE = 640;

export const status = () => fn('soil-prediction');

export function prepareImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new ApiError(0, 'invalid_image', 'Pilih gambar berformat JPG, PNG, atau WebP.'));
    if (file.size > MAX_INPUT_BYTES) return reject(new ApiError(0, 'invalid_image', 'Ukuran berkas terlalu besar (maksimal 12 MB).'));
    const fr = new FileReader();
    fr.onerror = () => reject(new ApiError(0, 'invalid_image', 'Gambar tidak dapat dibaca.'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new ApiError(0, 'invalid_image', 'Berkas bukan gambar yang valid.'));
      img.onload = () => {
        const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.max(32, Math.round(img.naturalWidth * k)); c.height = Math.max(32, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((b) => (b ? resolve({ blob: b, preview: fr.result }) : reject(new ApiError(0, 'invalid_image', 'Gambar tidak dapat diproses.'))), 'image/jpeg', 0.9);
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

export const predictSoil = (blob) => fn('soil-prediction', { method: 'POST', rawBody: blob, headers: { 'content-type': 'image/jpeg' } });
