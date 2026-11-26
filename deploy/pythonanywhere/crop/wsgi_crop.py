# Dipakai file WSGI PythonAnywhere. Ganti KUNCI di bawah dengan INFERENCE_SERVICE_KEY milik Anda (di server, bukan di GitHub).
import os, sys
HOME = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("INFERENCE_SERVICE_KEY", "GANTI-DENGAN-KUNCI-ANDA")
os.environ.setdefault("ARTIFACTS_DIR", os.path.join(HOME, "artifacts"))
sys.path.insert(0, HOME)
sys.path.insert(0, os.path.join(HOME, "service"))
sys.path.insert(0, os.path.join(HOME, "training"))
from app import app as application  # noqa: E402
