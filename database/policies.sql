-- =====================================================================
-- RLS, hak akses (GRANT) dan RPC administrasi. Jalankan SETELAH triggers.sql.
-- Prinsip: tolak semua dulu, buka seperlunya. Role tidak pernah dipercaya dari browser.
-- =====================================================================

alter table public.profiles             enable row level security;
alter table public.examinations         enable row level security;
alter table public.datasets             enable row level security;
alter table public.model_versions       enable row level security;
alter table public.audit_logs           enable row level security;
alter table public.application_settings enable row level security;
alter table public.ai_conversations     enable row level security;
alter table public.ai_messages          enable row level security;

-- ---------- reset hak akses ----------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---------- grant tabel untuk pengguna login (dibatasi lagi oleh RLS) ----------
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;          -- HANYA nama; role/status/email tidak bisa diubah
grant select, delete on public.examinations to authenticated;           -- tidak ada INSERT/UPDATE: hasil prediksi hanya dibuat backend
grant select on public.datasets to authenticated;                       -- dibatasi policy: admin
grant select (id, model_name, algorithm, version, accuracy, "precision", recall, f1_score, n_train, n_test,
              total_classes, supports_proba, training_date, dataset_id, status, comparison, approved_at, created_at)
      on public.model_versions to authenticated;                        -- artifact_path tidak dibuka
grant select on public.audit_logs to authenticated;                     -- dibatasi policy: admin; tanpa INSERT/UPDATE/DELETE
grant select on public.application_settings to authenticated;
grant select, delete on public.ai_conversations to authenticated;
grant select on public.ai_messages to authenticated;

-- ---------- policies ----------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_active()) with check (id = auth.uid());

drop policy if exists exams_select on public.examinations;
create policy exams_select on public.examinations for select to authenticated
  using ((user_id = auth.uid() and public.is_active()) or public.is_admin());
drop policy if exists exams_delete on public.examinations;
create policy exams_delete on public.examinations for delete to authenticated
  using ((user_id = auth.uid() and public.is_active()) or public.is_admin());

drop policy if exists datasets_admin on public.datasets;
create policy datasets_admin on public.datasets for select to authenticated using (public.is_admin());

drop policy if exists models_select on public.model_versions;
create policy models_select on public.model_versions for select to authenticated using (public.is_active());

drop policy if exists audit_admin_select on public.audit_logs;
create policy audit_admin_select on public.audit_logs for select to authenticated using (public.is_admin());

drop policy if exists settings_select on public.application_settings;
create policy settings_select on public.application_settings for select to authenticated using (public.is_active());

-- Percakapan AI: HANYA pemilik. Admin sengaja tidak diberi akses baca (privasi pengguna).
drop policy if exists ai_conv_owner_select on public.ai_conversations;
create policy ai_conv_owner_select on public.ai_conversations for select to authenticated
  using (user_id = auth.uid() and public.is_active());
drop policy if exists ai_conv_owner_delete on public.ai_conversations;
create policy ai_conv_owner_delete on public.ai_conversations for delete to authenticated
  using (user_id = auth.uid() and public.is_active());
drop policy if exists ai_msg_owner_select on public.ai_messages;
create policy ai_msg_owner_select on public.ai_messages for select to authenticated
  using (user_id = auth.uid() and public.is_active());

-- =====================================================================
-- RPC administrasi (SECURITY DEFINER). Semua memeriksa is_admin() di dalam dan menulis audit.
-- =====================================================================
create or replace function public._require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Akses ditolak' using errcode = '42501'; end if;
end $$;

create or replace function public._me_email() returns text
language sql stable security definer set search_path = '' as $$
  select email from public.profiles where id = auth.uid() $$;

create or replace function public.admin_set_role(target uuid, new_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare old_role text;
begin
  perform public._require_admin();
  if new_role not in ('admin','user') then raise exception 'Role tidak valid' using errcode = '22023'; end if;
  select role into old_role from public.profiles where id = target;
  if old_role is null then raise exception 'Pengguna tidak ditemukan' using errcode = 'P0002'; end if;
  update public.profiles set role = new_role where id = target;
  perform public.write_audit(auth.uid(), public._me_email(), 'user.role_change', 'Perubahan role pengguna', 'success',
    jsonb_build_object('target', target, 'from', old_role, 'to', new_role));
end $$;

create or replace function public.admin_set_status(target uuid, new_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_admin();
  if new_status not in ('active','inactive') then raise exception 'Status tidak valid' using errcode = '22023'; end if;
  if target = auth.uid() and new_status = 'inactive' then
    raise exception 'Tidak bisa menonaktifkan akun sendiri' using errcode = '23514'; end if;
  update public.profiles set status = new_status where id = target;
  if not found then raise exception 'Pengguna tidak ditemukan' using errcode = 'P0002'; end if;
  perform public.write_audit(auth.uid(), public._me_email(), 'user.status_change', 'Perubahan status akun', 'success',
    jsonb_build_object('target', target, 'to', new_status));
end $$;

create or replace function public.admin_update_profile(target uuid, p_full_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_admin();
  update public.profiles set full_name = left(btrim(coalesce(p_full_name, '')), 120) where id = target;
  if not found then raise exception 'Pengguna tidak ditemukan' using errcode = 'P0002'; end if;
  perform public.write_audit(auth.uid(), public._me_email(), 'user.update', 'Ubah informasi pengguna', 'success',
    jsonb_build_object('target', target));
end $$;

-- Daftar kunci pengaturan yang diizinkan + validasi tipe nilainya.
create or replace function public.admin_update_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_admin();
  if p_key in ('registration_enabled','ai_enabled','maintenance_mode') then
    if jsonb_typeof(p_value) <> 'boolean' then raise exception 'Nilai harus boolean' using errcode = '22023'; end if;
  elsif p_key = 'ai_daily_limit' then
    if jsonb_typeof(p_value) <> 'number' or (p_value)::text::numeric not between 0 and 500 or (p_value)::text::numeric <> trunc((p_value)::text::numeric)
      then raise exception 'ai_daily_limit harus bilangan bulat 0..500' using errcode = '22023'; end if;
  elsif p_key = 'prediction_rate_per_minute' then
    if jsonb_typeof(p_value) <> 'number' or (p_value)::text::numeric not between 1 and 120 or (p_value)::text::numeric <> trunc((p_value)::text::numeric)
      then raise exception 'prediction_rate_per_minute harus bilangan bulat 1..120' using errcode = '22023'; end if;
  elsif p_key = 'app_name' then
    if jsonb_typeof(p_value) <> 'string' or char_length(p_value #>> '{}') not between 1 and 60
      then raise exception 'app_name 1..60 karakter' using errcode = '22023'; end if;
  else
    raise exception 'Kunci pengaturan tidak dikenal' using errcode = '22023';
  end if;
  insert into public.application_settings(setting_key, setting_value, updated_by)
  values (p_key, p_value, auth.uid())
  on conflict (setting_key) do update set setting_value = excluded.setting_value, updated_by = auth.uid();
  perform public.write_audit(auth.uid(), public._me_email(), 'settings.update', 'Perubahan pengaturan: ' || p_key, 'success',
    jsonb_build_object('key', p_key, 'value', p_value));
end $$;

-- Persetujuan admin: model kandidat -> aktif; dataset-nya ikut aktif; yang lama diarsipkan.
create or replace function public.activate_model_version(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.model_versions;
begin
  perform public._require_admin();
  select * into m from public.model_versions where id = p_id for update;
  if not found then raise exception 'Versi model tidak ditemukan' using errcode = 'P0002'; end if;
  if m.status = 'rejected' then raise exception 'Versi yang ditolak tidak bisa diaktifkan' using errcode = '23514'; end if;
  update public.model_versions set status = 'archived' where status = 'active' and id <> p_id;
  update public.model_versions set status = 'active', approved_by = auth.uid(), approved_at = now() where id = p_id;
  if m.dataset_id is not null then
    update public.datasets set status = 'archived' where status = 'active' and id <> m.dataset_id;
    update public.datasets set status = 'active' where id = m.dataset_id;
  end if;
  perform public.write_audit(auth.uid(), public._me_email(), 'model.activate', 'Aktivasi model ' || m.version, 'success',
    jsonb_build_object('model_version_id', p_id, 'version', m.version, 'dataset_id', m.dataset_id));
end $$;

create or replace function public.reject_model_version(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_admin();
  update public.model_versions set status = 'rejected' where id = p_id and status = 'candidate';
  if not found then raise exception 'Hanya kandidat yang bisa ditolak' using errcode = '23514'; end if;
  perform public.write_audit(auth.uid(), public._me_email(), 'model.reject', 'Penolakan model kandidat', 'success',
    jsonb_build_object('model_version_id', p_id));
end $$;

-- Log dari browser (login/logout): aksi dibatasi allowlist, user_id selalu auth.uid().
create or replace function public.log_client_event(p_action text, p_details jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Perlu login' using errcode = '42501'; end if;
  if p_action not in ('auth.login','auth.logout','auth.password_change') then
    raise exception 'Aksi tidak diizinkan' using errcode = '22023'; end if;
  perform public.write_audit(auth.uid(), public._me_email(), p_action, '', 'success',
    case when jsonb_typeof(p_details) = 'object' and length(p_details::text) < 400 then p_details else '{}'::jsonb end);
end $$;

-- ---------- statistik dashboard admin (agregasi di database) ----------
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare tz text; today date; r jsonb;
begin
  perform public._require_admin();
  select coalesce(setting_value #>> '{}', 'Asia/Jayapura') into tz from public.application_settings where setting_key = 'timezone';
  tz := coalesce(tz, 'Asia/Jayapura');
  today := (now() at time zone tz)::date;
  select jsonb_build_object(
    'total_users',   (select count(*) from public.profiles),
    'total_exams',   (select count(*) from public.examinations),
    'exams_today',   (select count(*) from public.examinations where (created_at at time zone tz)::date = today),
    'crops_in_model',(select total_classes from public.model_versions where status = 'active'),
    'crops_recommended', (select count(distinct predicted_crop) from public.examinations),
    'total_datasets',(select count(*) from public.datasets),
    'active_model',  (select jsonb_build_object('version', version, 'algorithm', algorithm, 'accuracy', accuracy)
                      from public.model_versions where status = 'active'),
    'active_users_7d',(select count(distinct user_id) from public.examinations where created_at > now() - interval '7 days'),
    'ai_messages_30d',(select count(*) from public.ai_messages where role = 'user' and created_at > now() - interval '30 days'),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('date', d, 'count', n) order by d), '[]'::jsonb) from (
                select gs::date as d, (select count(*) from public.examinations e where (e.created_at at time zone tz)::date = gs::date) as n
                from generate_series(today - 29, today, interval '1 day') gs) q),
    'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'count', n) order by m), '[]'::jsonb) from (
                select gs as m, (select count(*) from public.examinations e
                                 where date_trunc('month', e.created_at at time zone tz) = gs) as n
                from generate_series(date_trunc('month', today::timestamp) - interval '11 months', date_trunc('month', today::timestamp), interval '1 month') gs) q),
    'by_crop', (select coalesce(jsonb_agg(jsonb_build_object('crop', predicted_crop, 'count', n) order by n desc, predicted_crop), '[]'::jsonb)
                from (select predicted_crop, count(*) n from public.examinations group by 1) q),
    'top_users', (select coalesce(jsonb_agg(jsonb_build_object('user', coalesce(nullif(full_name, ''), email), 'email', email, 'count', n) order by n desc), '[]'::jsonb)
                  from (select p.full_name, p.email, count(*) n from public.examinations e join public.profiles p on p.id = e.user_id
                        group by p.id order by n desc limit 8) q)
  ) into r;
  return r;
end $$;

create or replace function public.admin_report_summary(p_from date default null, p_to date default null,
                                                       p_user uuid default null, p_crop text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public._require_admin();
  with f as (
    select e.* from public.examinations e
    where (p_from is null or e.created_at >= p_from) and (p_to is null or e.created_at < p_to + 1)
      and (p_user is null or e.user_id = p_user) and (p_crop is null or e.predicted_crop = p_crop))
  select jsonb_build_object(
    'total', (select count(*) from f),
    'users', (select count(distinct user_id) from f),
    'avg', (select jsonb_build_object('N', round(avg(nitrogen),2), 'P', round(avg(phosphorus),2), 'K', round(avg(potassium),2),
              'temperature', round(avg(temperature),2), 'humidity', round(avg(humidity),2), 'ph', round(avg(ph),2),
              'rainfall', round(avg(rainfall),2)) from f),
    'by_crop', (select coalesce(jsonb_agg(jsonb_build_object('crop', c, 'count', n) order by n desc, c), '[]'::jsonb)
                from (select predicted_crop c, count(*) n from f group by 1) q),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('date', d, 'count', n) order by d), '[]'::jsonb)
               from (select created_at::date d, count(*) n from f group by 1) q),
    'by_user', (select coalesce(jsonb_agg(jsonb_build_object('email', email, 'name', full_name, 'count', n, 'last', last) order by n desc), '[]'::jsonb)
                from (select p.email, p.full_name, count(*) n, max(f.created_at) last
                      from f join public.profiles p on p.id = f.user_id group by p.id order by n desc limit 100) q)
  ) into r;
  return r;
end $$;

-- ---------- hak eksekusi fungsi (HARUS di akhir: berlaku untuk semua fungsi di atas) ----------
-- Fungsi baru di schema public secara bawaan dapat dieksekusi PUBLIC/anon; cabut dulu, lalu buka seperlunya.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
grant execute on function public.is_admin(), public.is_active() to authenticated;
grant execute on function public.admin_set_role(uuid, text), public.admin_set_status(uuid, text),
  public.admin_update_profile(uuid, text), public.admin_update_setting(text, jsonb),
  public.activate_model_version(uuid), public.reject_model_version(uuid),
  public.log_client_event(text, jsonb), public.admin_stats(),
  public.admin_report_summary(date, date, uuid, text) to authenticated;
