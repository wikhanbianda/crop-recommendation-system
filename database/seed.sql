-- Dibuat oleh ml/training/make_seed.py dari artefak v1.0.0. Jangan edit angka secara manual.
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
values ('Crop_recommendation.csv', 'datasets/v1.0.0/Crop_recommendation.csv', '54a5a6e5408668e668667efc50de2fc867c1b875e0431b4f54dd331b0a109a4e', 2200, 7, 22,
        'v1.0.0', 'active', '{"rows_raw": 2200, "missing_per_column": {"N": 0, "P": 0, "K": 0, "temperature": 0, "humidity": 0, "ph": 0, "rainfall": 0, "label": 0}, "rows_after_dropna": 2200, "duplicates_removed": 0, "rows_clean": 2200}'::jsonb)
on conflict (version) do nothing;

insert into public.model_versions (model_name, algorithm, version, accuracy, "precision", recall, f1_score, n_train, n_test,
                                   total_classes, supports_proba, training_date, dataset_id, artifact_path, status, comparison, approved_at)
values ('Naive Bayes v1.0.0', 'Naive Bayes', 'v1.0.0', 0.995455, 0.995868,
        0.995455, 0.995443, 1760, 440, 22,
        true, '2026-11-11T02:17:52+00:00', (select id from public.datasets where version = 'v1.0.0'),
        'v1.0.0', 'active', '[{"algorithm": "Decision Tree", "cv_accuracy_mean": 0.9852272727272728, "cv_accuracy_std": 0.006818181818181797, "cv_f1_macro_mean": 0.9852225899230891, "test_accuracy": 0.9795454545454545, "test_precision_macro": 0.9805981896890987, "test_recall_macro": 0.9795454545454546, "test_f1_macro": 0.9794231513743707, "supports_predict_proba": true, "fit_seconds": 0.007}, {"algorithm": "Random Forest", "cv_accuracy_mean": 0.99375, "cv_accuracy_std": 0.004545454545454544, "cv_f1_macro_mean": 0.9937248623329861, "test_accuracy": 0.9954545454545455, "test_precision_macro": 0.9956709956709957, "test_recall_macro": 0.9954545454545454, "test_f1_macro": 0.9954517027687758, "supports_predict_proba": true, "fit_seconds": 0.348}, {"algorithm": "K-Nearest Neighbors", "cv_accuracy_mean": 0.965340909090909, "cv_accuracy_std": 0.012106406677649138, "cv_f1_macro_mean": 0.9650112202843848, "test_accuracy": 0.9795454545454545, "test_precision_macro": 0.9803555030827759, "test_recall_macro": 0.9795454545454544, "test_f1_macro": 0.9792832328133997, "supports_predict_proba": true, "fit_seconds": 0.001}, {"algorithm": "Support Vector Machine", "cv_accuracy_mean": 0.9789772727272726, "cv_accuracy_std": 0.010258789821174896, "cv_f1_macro_mean": 0.9788025126741349, "test_accuracy": 0.9840909090909091, "test_precision_macro": 0.9856099105110961, "test_recall_macro": 0.9840909090909092, "test_f1_macro": 0.9840381050638686, "supports_predict_proba": true, "fit_seconds": 0.13}, {"algorithm": "Naive Bayes", "cv_accuracy_mean": 0.9948863636363636, "cv_accuracy_std": 0.004175266607016787, "cv_f1_macro_mean": 0.9948713284300658, "test_accuracy": 0.9954545454545455, "test_precision_macro": 0.9958677685950413, "test_recall_macro": 0.9954545454545454, "test_f1_macro": 0.9954431533378901, "supports_predict_proba": true, "fit_seconds": 0.001}, {"algorithm": "Gradient Boosting", "cv_accuracy_mean": 0.9869318181818182, "cv_accuracy_std": 0.0034090909090909245, "cv_f1_macro_mean": 0.9868609061859882, "test_accuracy": 0.9886363636363636, "test_precision_macro": 0.989742141916055, "test_recall_macro": 0.9886363636363634, "test_f1_macro": 0.9887226097483732, "supports_predict_proba": true, "fit_seconds": 5.39}]'::jsonb, now())
on conflict (version) do nothing;
