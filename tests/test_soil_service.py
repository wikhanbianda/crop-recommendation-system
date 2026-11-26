"""Uji PIPELINE fitur foto tanah (bukan uji akurasi pada tanah sungguhan).

Dataset di sini SINTETIS (tekstur noise berwarna per kelas) dan hanya dibuat di folder sementara untuk memastikan
alur upload -> ekstraksi -> training -> inferensi -> pemetaan tanaman bekerja dan menolak input buruk.
Akurasi nyata baru ada setelah model dilatih dengan dataset foto tanah sungguhan.
"""
import io, json, os, subprocess, sys, tempfile
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
KEY = "k" * 32
BASE = {"alluvial": (150, 130, 100), "black": (40, 38, 36), "red": (160, 70, 50), "laterite": (150, 90, 60)}


def make_img(rgb, rng, size=160):
    a = np.clip(np.array(rgb) + rng.normal(0, 14, (size, size, 3)), 0, 255).astype("uint8")
    b = io.BytesIO(); Image.fromarray(a).save(b, "JPEG", quality=85); return b.getvalue()


def test_all():
    tmp = Path(tempfile.mkdtemp()); data = tmp / "ds"; art = tmp / "art"; rng = np.random.default_rng(0)
    for c, rgb in BASE.items():
        (data / c).mkdir(parents=True)
        for i in range(40):
            (data / c / f"{i}.jpg").write_bytes(make_img(tuple(v * rng.uniform(.8, 1.2) for v in rgb), rng))
    os.environ.update(INFERENCE_SERVICE_KEY=KEY, SOIL_ARTIFACTS_DIR=str(art), ARTIFACTS_DIR=str(ROOT / "ml" / "artifacts"))
    sys.path.insert(0, str(ROOT / "ml" / "service")); sys.path.insert(0, str(ROOT / "ml"))
    from app import app
    c = app.test_client(); H = {"X-Service-Key": KEY}
    # 1. belum ada model -> 503 jelas, bukan hasil palsu
    assert c.get("/soil-model", headers=H).status_code == 503
    assert c.post("/predict-soil", data=make_img((90, 90, 90), rng), headers=H).json["error"] == "no_soil_model"
    # 2. tanpa kunci -> 401
    assert c.post("/predict-soil", data=b"x").status_code == 401
    # 3. training CLI
    r = subprocess.run([sys.executable, str(ROOT / "ml/soil/train_soil.py"), "--data", str(data), "--version", "t1", "--out", str(art)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    # 4. status + inferensi
    assert c.get("/soil-model", headers=H).json["classes"] == sorted(BASE)
    out = c.post("/predict-soil", data=make_img((40, 38, 36), rng), headers=H).json
    assert out["predicted_soil"] == "black" and out["crops"][0]["crop"] in ("cotton", "chickpea"), out
    out = c.post("/predict-soil", data=make_img((160, 70, 50), rng), headers=H).json
    assert out["predicted_soil"] == "red" and out["crops"][0]["crop"] in ("pigeonpeas", "mothbeans"), out
    assert out["unmapped_soils"] == [] and len(out["soil_probabilities"]) == 3
    # 5. input buruk
    for bad in (b"", b"bukan gambar", b"GIF89a" + b"\0" * 50):
        rr = c.post("/predict-soil", data=bad, headers=H); assert rr.status_code in (422,) and rr.json["error"] == "invalid_image", (bad, rr.status_code)
    tiny = io.BytesIO(); Image.new("RGB", (10, 10)).save(tiny, "PNG")
    assert c.post("/predict-soil", data=tiny.getvalue(), headers=H).status_code == 422
    # 6. kelas tanpa pemetaan ditolak saat training
    (data / "tanah_aneh").mkdir()
    r = subprocess.run([sys.executable, str(ROOT / "ml/soil/train_soil.py"), "--data", str(data), "--version", "t2", "--out", str(art)], capture_output=True, text=True)
    assert r.returncode != 0 and "pemetaan" in (r.stdout + r.stderr)
    # 7. gerbang "bukan tanah": dilatih dengan negatif buatan (warna rata, gradasi, garis)
    import shutil; shutil.rmtree(data / "tanah_aneh")
    neg = tmp / "neg"; neg.mkdir()
    for i in range(60):
        h = i % 3
        if h == 0: arr = np.full((160, 160, 3), rng.integers(0, 255, 3), "uint8")
        elif h == 1: arr = np.tile(np.linspace(0, 255, 160)[None, :, None], (160, 1, 3)).astype("uint8")
        else: arr = np.zeros((160, 160, 3), "uint8"); arr[::8] = rng.integers(0, 255, 3)
        b = io.BytesIO(); Image.fromarray(arr).save(b, "JPEG", quality=90); (neg / f"{i}.jpg").write_bytes(b.getvalue())
    r = subprocess.run([sys.executable, str(ROOT / "ml/soil/train_soil.py"), "--data", str(data), "--version", "t3", "--out", str(art), "--negatives", str(neg)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert c.get("/soil-model", headers=H).json["not_soil_gate"] is True
    flat = io.BytesIO(); Image.new("RGB", (160, 160), (30, 90, 200)).save(flat, "JPEG")
    rr = c.post("/predict-soil", data=flat.getvalue(), headers=H)
    assert rr.status_code == 422 and rr.json["error"] == "not_soil", (rr.status_code, rr.json)
    ok = c.post("/predict-soil", data=make_img((160, 70, 50), rng), headers=H)
    assert ok.status_code == 200 and ok.json["soil_check"]["enabled"] is True, ok.json
    print("soil pipeline OK:", json.loads(r.stdout or "{}") if False else "semua cek lulus")


if __name__ == "__main__":
    test_all()
