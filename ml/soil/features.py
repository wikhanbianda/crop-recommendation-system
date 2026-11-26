"""Ekstraksi fitur gambar tanah (warna + tekstur) hanya dengan Pillow dan numpy.

Dipakai SAMA PERSIS saat training dan saat inferensi, supaya tidak ada selisih pemrosesan.
Sengaja memakai fitur klasik + scikit-learn (bukan jaringan saraf) agar muat di hosting gratis (RAM/disk kecil).
"""
from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageOps

MAX_SIDE = 6000            # tolak gambar yang absurd besar
MAX_PIXELS = 24_000_000
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
SIZE = 128

H_BINS, S_BINS, V_BINS = 12, 6, 8
NAMES: list[str] = (
    [f"mean_{c}" for c in "RGBHSV"] + [f"std_{c}" for c in "RGBHSV"]
    + [f"p{p}_{c}" for c in "SV" for p in (10, 50, 90)]
    + [f"hueh_{i}" for i in range(H_BINS)] + [f"sath_{i}" for i in range(S_BINS)] + [f"valh_{i}" for i in range(V_BINS)]
    + ["grad_mean", "grad_std", "lap_var", "block_contrast", "edge_density", "dark_frac", "bright_frac",
       "rg_ratio", "gb_ratio", "redness", "yellowness"]
)


class ImageError(ValueError):
    pass


def load_image(data: bytes) -> Image.Image:
    """Buka + validasi gambar dari bytes. Melempar ImageError (pesan aman ditampilkan ke pengguna)."""
    if not data:
        raise ImageError("Gambar kosong.")
    try:
        img = Image.open(io.BytesIO(data))
        fmt = img.format
        w, h = img.size
    except Exception:
        raise ImageError("Berkas bukan gambar yang valid.") from None
    if fmt not in ALLOWED_FORMATS:
        raise ImageError("Format gambar harus JPG, PNG, atau WebP.")
    if w < 32 or h < 32:
        raise ImageError("Gambar terlalu kecil (minimal 32x32 piksel).")
    if w > MAX_SIDE or h > MAX_SIDE or w * h > MAX_PIXELS:
        raise ImageError("Dimensi gambar terlalu besar.")
    try:
        img = ImageOps.exif_transpose(img)
        img.load()
    except Exception:
        raise ImageError("Gambar rusak atau tidak dapat dibaca.") from None
    return img


def _prep(img: Image.Image) -> Image.Image:
    rgb = img.convert("RGB")
    w, h = rgb.size
    s = min(w, h)
    left, top = (w - s) // 2, (h - s) // 2
    return rgb.crop((left, top, left + s, top + s)).resize((SIZE, SIZE), Image.BILINEAR)


def extract(img: Image.Image) -> np.ndarray:
    rgb = _prep(img)
    a = np.asarray(rgb, dtype=np.float64)                       # 0..255
    hsv = np.asarray(rgb.convert("HSV"), dtype=np.float64)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    chans = [R, G, B, H, S, V]
    f: list[float] = [float(c.mean()) for c in chans] + [float(c.std()) for c in chans]
    for c in (S, V):
        f += [float(x) for x in np.percentile(c, [10, 50, 90])]
    f += list(np.histogram(H, bins=H_BINS, range=(0, 256))[0] / H.size)
    f += list(np.histogram(S, bins=S_BINS, range=(0, 256))[0] / S.size)
    f += list(np.histogram(V, bins=V_BINS, range=(0, 256))[0] / V.size)
    gray = 0.299 * R + 0.587 * G + 0.114 * B
    gx, gy = np.diff(gray, axis=1)[:-1, :], np.diff(gray, axis=0)[:, :-1]
    mag = np.hypot(gx, gy)
    lap = gray[1:-1, 1:-1] * 4 - gray[:-2, 1:-1] - gray[2:, 1:-1] - gray[1:-1, :-2] - gray[1:-1, 2:]
    blocks = gray.reshape(16, SIZE // 16, 16, SIZE // 16).mean(axis=(1, 3))
    f += [float(mag.mean()), float(mag.std()), float(lap.var()), float(blocks.std()),
          float((mag > 20).mean()), float((V < 60).mean()), float((V > 200).mean())]
    mr, mg, mb = float(R.mean()) + 1e-6, float(G.mean()) + 1e-6, float(B.mean()) + 1e-6
    f += [mr / mg, mg / mb, (mr - mb) / (mr + mb), (mr + mg - 2 * mb) / (mr + mg + 2 * mb)]
    out = np.asarray(f, dtype=np.float64)
    assert out.size == len(NAMES), (out.size, len(NAMES))
    return out


# ---------------------------------------------------------------------------------------------
# Fitur tambahan untuk "gerbang bukan-tanah" (membedakan foto tanah dari foto lain).
# Dipakai HANYA oleh gerbang; pengklasifikasi jenis tanah tetap memakai extract() di atas.
# ---------------------------------------------------------------------------------------------
GATE_EXTRA_NAMES = ["top_color_frac", "n_colors_90", "color_entropy", "earth_hue_frac", "green_frac", "blue_frac",
                    "gray_frac", "very_bright_frac", "orient_entropy", "orient_max", "block_color_std",
                    "block_lum_std", "block_tex_cv", "block_lum_range"]
GATE_NAMES = NAMES + GATE_EXTRA_NAMES


def gate_extras(img: Image.Image) -> np.ndarray:
    rgb = _prep(img)
    a = np.asarray(rgb)
    q = (a >> 4).astype(np.int32)
    key = (q[..., 0] << 8) | (q[..., 1] << 4) | q[..., 2]
    p = np.bincount(key.ravel(), minlength=4096).astype(np.float64)
    p /= p.sum()
    ps = np.sort(p)[::-1]
    top, n90 = float(ps[0]), int(np.searchsorted(np.cumsum(ps), 0.9)) + 1
    ent = float(-(p[p > 0] * np.log2(p[p > 0])).sum()) / 12
    hsv = np.asarray(rgb.convert("HSV"), dtype=np.float64)
    H, S, V = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
    earth = ((H < 50) | (H > 345)) & (S > .12) & (S < .9) & (V > .08) & (V < .92)
    green = (H > 70) & (H < 170) & (S > .2)
    blue = (H > 190) & (H < 260) & (S > .2)
    g = np.asarray(rgb.convert("L"), dtype=np.float64)
    gx, gy = np.diff(g, axis=1)[:-1, :], np.diff(g, axis=0)[:, :-1]
    mag = np.hypot(gx, gy) + 1e-9
    hh, _ = np.histogram(np.arctan2(gy, gx) % np.pi, bins=8, range=(0, np.pi), weights=mag)
    hh = hh / hh.sum()
    o_ent, o_max = float(-(hh[hh > 0] * np.log2(hh[hh > 0])).sum()) / 3, float(hh.max())
    B = a.astype(np.float64).reshape(4, 32, 4, 32, 3).mean(axis=(1, 3)).reshape(16, 3)
    bl = g.reshape(4, 32, 4, 32).mean(axis=(1, 3)).ravel()
    bm = mag[:124, :124].reshape(4, 31, 4, 31).mean(axis=(1, 3)).ravel()
    out = np.array([top, n90 / 200, ent, earth.mean(), green.mean(), blue.mean(), (S < .1).mean(), (V > .95).mean(),
                    o_ent, o_max, float(B.std(axis=0).mean()) / 64, float(bl.std()) / 64,
                    float(bm.std() / (bm.mean() + 1e-6)), float((bl.max() - bl.min()) / 255)])
    assert out.size == len(GATE_EXTRA_NAMES)
    return out


def gate_features(img: Image.Image) -> np.ndarray:
    return np.concatenate([extract(img), gate_extras(img)])

