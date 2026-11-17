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
root = Path(__file__).resolve().parents[2]
subprocess.run([sys.executable, str(root / "ml/soil/train_soil.py"), "--data", str(data), "--version", "t1", "--out", str(out / "art")], check=True, capture_output=True)
b = io.BytesIO(); Image.fromarray(np.clip(np.array((40, 38, 36)) + rng.normal(0, 14, (160, 160, 3)), 0, 255).astype("uint8")).save(b, "JPEG"); (out / "black.jpg").write_bytes(b.getvalue())
