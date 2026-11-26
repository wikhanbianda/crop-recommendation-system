"""Gambar non-tanah SINTETIS (warna rata, gradasi, derau, blok, halaman teks, tampilan aplikasi, garis) untuk melatih
gerbang "bukan tanah". Deterministik (seed tetap). Hanya dipakai saat training."""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def make(n: int = 300, seed: int = 7) -> list[Image.Image]:
    rng = np.random.default_rng(seed)
    font = ImageFont.load_default()
    col = lambda lo=0, hi=256: tuple(int(v) for v in rng.integers(lo, hi, 3))  # noqa: E731
    out = []
    for i in range(n):
        t, W, H = i % 7, int(rng.integers(200, 500)), int(rng.integers(200, 500))
        im = Image.new("RGB", (W, H), col()); d = ImageDraw.Draw(im)
        if t == 1:
            a, b = rng.integers(0, 256, 3), rng.integers(0, 256, 3); g = np.linspace(0, 1, W)[None, :, None]
            im = Image.fromarray(((a * (1 - g) + b * g) * np.ones((H, W, 1))).astype("uint8"))
        elif t == 2:
            im = Image.fromarray(rng.integers(0, 256, (H, W, 3), dtype="uint8"))
        elif t == 3:
            for _ in range(int(rng.integers(3, 12))):
                x, y = int(rng.integers(0, W - 20)), int(rng.integers(0, H - 20))
                d.rectangle([x, y, x + int(rng.integers(20, W // 2)), y + int(rng.integers(10, H // 2))], fill=col())
        elif t == 4:
            im = Image.new("RGB", (W, H), (255, 255, 255)); d = ImageDraw.Draw(im)
            for y in range(10, H - 10, 14):
                d.text((10, y), "lorem ipsum dolor sit amet " * int(rng.integers(2, 8)), fill=(20, 20, 20), font=font)
        elif t == 5:
            im = Image.new("RGB", (W, H), col(200, 256)); d = ImageDraw.Draw(im); d.rectangle([0, 0, W, 40], fill=col(0, 120))
            for _ in range(int(rng.integers(2, 6))):
                x, y = int(rng.integers(10, W // 2)), int(rng.integers(50, H - 60))
                d.rounded_rectangle([x, y, x + int(rng.integers(80, W // 2)), y + int(rng.integers(30, 60))], 8, fill=(255, 255, 255), outline=(60, 60, 60))
                d.text((x + 8, y + 8), "Pemeriksaan Dashboard", fill=(10, 10, 10), font=font)
        elif t == 6:
            for x in range(0, W, int(rng.integers(6, 40))):
                d.rectangle([x, 0, x + int(rng.integers(2, 20)), H], fill=col())
        out.append(im)
    return out
