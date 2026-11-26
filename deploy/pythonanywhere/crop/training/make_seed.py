"""Membuat database/seed.sql dari artefak model NYATA (metadata.json). Tidak ada angka yang diketik manual.
Pemakaian: python ml/training/make_seed.py [versi]"""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
ver = sys.argv[1] if len(sys.argv) > 1 else json.loads((ROOT / "ml/artifacts/active.json").read_text())["version"]
d = ROOT / "ml/artifacts" / ver
m = json.loads((d / "metadata.json").read_text()); ev = json.loads((d / "evaluation.json").read_text())
q = lambda s: "'" + str(s).replace("'", "''") + "'"
ds = m["dataset"]
sql = f"""-- Dibuat oleh ml/training/make_seed.py dari artefak {ver}. Jangan edit angka secara manual.
-- Aman dijalankan ulang. Tidak membuat akun apa pun (admin pertama: lihat docs/DEPLOYMENT.md).

insert into public.application_settings (setting_key, setting_value) values
  ('app_name', '"Crop Recommendation System"'),
  ('registration_enabled', 'false'),
  ('ai_enabled', 'true'),
  ('ai_daily_limit', '30'),
  ('prediction_rate_per_minute', '20'),
  ('maintenance_mode', 'false'),
  ('timezone', '"Asia/Jayapura"')
on conflict (setting_key) do nothing;

insert into public.datasets (dataset_name, file_path, sha256, total_rows, total_features, total_classes, version, status, validation_report)
values ({q(ds['name'])}, {q('datasets/' + ver + '/' + ds['name'])}, {q(ds['sha256'])}, {ds['rows_clean']}, {ds['n_features']}, {ds['n_classes']},
        {q(ver)}, 'active', {q(json.dumps(ev['cleaning']))}::jsonb)
on conflict (version) do nothing;

insert into public.model_versions (model_name, algorithm, version, accuracy, "precision", recall, f1_score, n_train, n_test,
                                   total_classes, supports_proba, training_date, dataset_id, artifact_path, status, comparison, approved_at)
values ({q(m['algorithm'] + ' ' + ver)}, {q(m['algorithm'])}, {q(ver)}, {m['metrics']['accuracy']:.6f}, {m['metrics']['precision_macro']:.6f},
        {m['metrics']['recall_macro']:.6f}, {m['metrics']['f1_macro']:.6f}, {m['n_train']}, {m['n_test']}, {ds['n_classes']},
        {str(m['supports_predict_proba']).lower()}, {q(m['trained_at'])}, (select id from public.datasets where version = {q(ver)}),
        {q(ver)}, 'active', {q(json.dumps(ev['comparison']))}::jsonb, now())
on conflict (version) do nothing;
"""
(ROOT / "database/seed.sql").write_text(sql)
print("seed.sql ditulis untuk", ver)
