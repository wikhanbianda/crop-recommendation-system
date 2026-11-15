-- =====================================================================
-- CROP RECOMMENDATION SYSTEM — skema database (Supabase PostgreSQL)
-- Urutan eksekusi: schema.sql -> triggers.sql -> policies.sql -> seed.sql
-- Aman dijalankan ulang (idempotent) pada database kosong atau yang sudah ada.
-- =====================================================================

-- ---------- profiles ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '' check (char_length(full_name) <= 120),
  email       text not null check (char_length(email) <= 254),
  role        text not null default 'user'   check (role in ('admin','user')),
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists profiles_email_lower_key on public.profiles (lower(email));
create index if not exists profiles_role_idx on public.profiles (role) where role = 'admin';

-- ---------- datasets ----------
create table if not exists public.datasets (
  id            uuid primary key default gen_random_uuid(),
  dataset_name  text not null check (char_length(dataset_name) between 1 and 160),
  file_path     text not null,                       -- lokasi di Supabase Storage (bucket privat)
  sha256        text check (sha256 ~ '^[0-9a-f]{64}$'),
  total_rows    integer check (total_rows >= 0),
  total_features integer check (total_features >= 0),
  total_classes integer check (total_classes >= 0),
  version       text not null unique check (version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
  status        text not null default 'uploaded'
                check (status in ('uploaded','validated','invalid','trained','active','archived')),
  validation_report jsonb not null default '{}'::jsonb,
  uploaded_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create unique index if not exists datasets_one_active on public.datasets ((true)) where status = 'active';
create index if not exists datasets_created_idx on public.datasets (created_at desc);

-- ---------- model_versions ----------
create table if not exists public.model_versions (
  id            uuid primary key default gen_random_uuid(),
  model_name    text not null check (char_length(model_name) between 1 and 120),
  algorithm     text not null,
  version       text not null unique check (version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
  accuracy      numeric(7,6) check (accuracy between 0 and 1),
  "precision"   numeric(7,6) check ("precision" between 0 and 1),   -- makro, data uji
  recall        numeric(7,6) check (recall between 0 and 1),        -- makro, data uji
  f1_score      numeric(7,6) check (f1_score between 0 and 1),      -- makro, data uji
  n_train       integer check (n_train >= 0),
  n_test        integer check (n_test >= 0),
  total_classes integer check (total_classes >= 0),
  supports_proba boolean not null default false,
  training_date timestamptz not null default now(),
  dataset_id    uuid references public.datasets(id) on delete restrict,
  artifact_path text not null,                      -- direktori artefak di layanan inferensi (tidak dibuka ke browser)
  status        text not null default 'candidate'
                check (status in ('candidate','active','archived','rejected')),
  comparison    jsonb not null default '[]'::jsonb, -- perbandingan algoritma dari proses training
  approved_by   uuid references public.profiles(id) on delete set null,
  approved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists model_versions_one_active on public.model_versions ((true)) where status = 'active';
create index if not exists model_versions_dataset_idx on public.model_versions (dataset_id);

-- ---------- examinations ----------
create table if not exists public.examinations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  nitrogen      numeric(8,3) not null check (nitrogen    between 0 and 200),
  phosphorus    numeric(8,3) not null check (phosphorus  between 0 and 200),
  potassium     numeric(8,3) not null check (potassium   between 0 and 300),
  temperature   numeric(8,3) not null check (temperature between 0 and 50),
  humidity      numeric(8,3) not null check (humidity    between 0 and 100),
  ph            numeric(6,3) not null check (ph          between 0 and 14),
  rainfall      numeric(8,3) not null check (rainfall    between 0 and 500),
  predicted_crop text not null check (char_length(predicted_crop) between 1 and 60),
  prediction_probabilities jsonb check (prediction_probabilities is null or jsonb_typeof(prediction_probabilities) = 'array'),
  out_of_training_range text[] not null default '{}',
  model_version_id uuid not null references public.model_versions(id) on delete restrict,
  created_at    timestamptz not null default now()
);
create index if not exists examinations_user_created_idx on public.examinations (user_id, created_at desc);
create index if not exists examinations_created_idx on public.examinations (created_at desc);
create index if not exists examinations_crop_idx on public.examinations (predicted_crop);
create index if not exists examinations_model_idx on public.examinations (model_version_id);

-- ---------- audit_logs (append-only, lihat triggers.sql) ----------
create table if not exists public.audit_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid,                      -- sengaja tanpa FK agar log tetap utuh saat akun dihapus
  actor_email text,
  action      text not null check (char_length(action) between 1 and 60),
  description text not null default '' check (char_length(description) <= 500),
  status      text not null default 'success' check (status in ('success','failure')),
  ip_address  text check (char_length(ip_address) <= 64),
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_user_idx on public.audit_logs (user_id, created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action);

-- ---------- application_settings ----------
create table if not exists public.application_settings (
  id            uuid primary key default gen_random_uuid(),
  setting_key   text not null unique check (setting_key ~ '^[a-z][a-z0-9_]{1,59}$'),
  setting_value jsonb not null,
  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now()
);

-- ---------- ai_conversations & ai_messages ----------
create table if not exists public.ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null default 'Percakapan baru' check (char_length(title) between 1 and 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ai_conversations_user_idx on public.ai_conversations (user_id, updated_at desc);

create table if not exists public.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade, -- denormalisasi untuk hitung kuota harian
  role            text not null check (role in ('user','assistant')),
  content         text not null check (char_length(content) between 1 and 12000),
  created_at      timestamptz not null default now()
);
create index if not exists ai_messages_conv_idx on public.ai_messages (conversation_id, created_at);
create index if not exists ai_messages_quota_idx on public.ai_messages (user_id, created_at) where role = 'user';
