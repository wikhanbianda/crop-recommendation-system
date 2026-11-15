-- =====================================================================
-- Trigger dan fungsi pendukung. Jalankan SETELAH schema.sql.
-- =====================================================================

-- ---------- updated_at ----------
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();
drop trigger if exists trg_ai_conv_updated on public.ai_conversations;
create trigger trg_ai_conv_updated before update on public.ai_conversations
  for each row execute function public.set_updated_at();
drop trigger if exists trg_settings_updated on public.application_settings;
create trigger trg_settings_updated before update on public.application_settings
  for each row execute function public.set_updated_at();

-- ---------- helper hak akses ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'admin' and p.status = 'active');
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active');
$$;

-- ---------- audit: penulis internal (tidak diberikan ke browser) ----------
create or replace function public.write_audit(p_user uuid, p_email text, p_action text, p_desc text,
                                              p_status text default 'success', p_details jsonb default '{}'::jsonb,
                                              p_ip text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(user_id, actor_email, action, description, status, details, ip_address)
  values (p_user, p_email, left(p_action, 60), left(coalesce(p_desc, ''), 500), p_status,
          coalesce(p_details, '{}'::jsonb), left(p_ip, 64));
end $$;

-- audit_logs hanya boleh ditambah: UPDATE/DELETE ditolak untuk semua peran, termasuk service_role.
create or replace function public.audit_logs_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'audit_logs bersifat append-only' using errcode = '42501'; end $$;
drop trigger if exists trg_audit_immutable on public.audit_logs;
create trigger trg_audit_immutable before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();
drop trigger if exists trg_audit_no_truncate on public.audit_logs;
create trigger trg_audit_no_truncate before truncate on public.audit_logs
  for each statement execute function public.audit_logs_immutable();

-- ---------- akun baru -> profil (role SELALU 'user') ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (new.id, coalesce(new.email, ''),
          left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120), 'user', 'active')
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.sync_profile_email();

-- ---------- penjaga admin terakhir ----------
create or replace function public.guard_last_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
declare others integer;
begin
  if old.role = 'admin' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'admin' or new.status <> 'active') then
    select count(*) into others from public.profiles
      where role = 'admin' and status = 'active' and id <> old.id;
    if others = 0 then
      raise exception 'Tidak bisa menghapus/menurunkan/menonaktifkan admin aktif terakhir' using errcode = '23514';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_guard_last_admin on public.profiles;
create trigger trg_guard_last_admin before update or delete on public.profiles
  for each row execute function public.guard_last_admin();

-- ---------- pemeriksaan yang dihapus ikut tercatat ----------
create or replace function public.audit_exam_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.write_audit(auth.uid(), (select email from public.profiles where id = auth.uid()),
    'examination.delete', 'Pemeriksaan dihapus', 'success',
    jsonb_build_object('examination_id', old.id, 'owner', old.user_id));
  return old;
end $$;
drop trigger if exists trg_exam_delete_audit on public.examinations;
create trigger trg_exam_delete_audit after delete on public.examinations
  for each row execute function public.audit_exam_delete();
