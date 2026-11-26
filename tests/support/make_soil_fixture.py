"""KHUSUS TES: buat dataset foto tanah SINTETIS lalu latih ke folder artefak sementara. Tidak pernah dipakai di produksi."""
import io, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image
out = Path(sys.argv[1]); data = out / "ds"; rng = np.random.default_rng(1)
BASE = {"alluvial": (150, 130, 100), "black": (40, 38, 36), "red": (160, 70, 50), "laterite": (150, 90, 60)}
for c, rgb in BASE.items():
    (data / c).mkdir(parents=True)
    for i in range(40):
        a = np.clip(np.array(rgb) * rng.uniform(.8, 1.2) + rng.normal(0, 14, (160, 160, 3)), 0, 255).astype("uint8")
        Image.fromarray(a).save(data / c / f"{i}.jpg", "JPEG", quality=85)
neg = out / "neg"; neg.mkdir()
for i in range(60):
    h = i % 3
    if h == 0: arr = np.full((160, 160, 3), rng.integers(0, 255, 3), "uint8")
    elif h == 1: arr = np.tile(np.linspace(0, 255, 160)[None, :, None], (160, 1, 3)).astype("uint8")
    else: arr = np.zeros((160, 160, 3), "uint8"); arr[::8] = rng.integers(0, 255, 3)
    Image.fromarray(arr).save(neg / f"{i}.jpg", "JPEG", quality=90)
Image.new("RGB", (160, 160), (30, 90, 200)).save(out / "flat.jpg", "JPEG")
root = Path(__file__).resolve().parents[2]
subprocess.run([sys.executable, str(root / "ml/soil/train_soil.py"), "--data", str(data), "--version", "t1", "--out", str(out / "art"), "--negatives", str(neg)], check=True, capture_output=True)
b = io.BytesIO(); Image.fromarray(np.clip(np.array((40, 38, 36)) + rng.normal(0, 14, (160, 160, 3)), 0, 255).astype("uint8")).save(b, "JPEG"); (out / "black.jpg").write_bytes(b.getvalue())
