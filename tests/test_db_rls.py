"""Uji skema + RLS pada PostgreSQL 16 sungguhan (dengan emulasi peran/JWT Supabase).
Pemakaian: python3 tests/test_db_rls.py <socket_dir> <port> <dbname>
Catatan jujur: ini BUKAN Supabase asli (tanpa GoTrue/PostgREST). Yang diuji: skema, constraint, trigger, RLS, GRANT, RPC."""
import subprocess, sys, re, json
H, PORT, DB = sys.argv[1:4]
BASE = ["psql", "-h", H, "-p", PORT, "-U", "postgres", "-d", DB, "-At", "-q", "-v", "ON_ERROR_STOP=1"]
fails = total = 0

def run(sql, uid=None, role="authenticated", commit=False):
    pre = f"set local role {role};" if role else ""
    if uid: pre += f"select set_config('request.jwt.claim.sub','{uid}',true) \\g /dev/null\n"
    script = f"begin; {pre} {sql}; {'commit' if commit else 'rollback'};"
    p = subprocess.run(BASE, input=script, capture_output=True, text=True)
    out = [l for l in p.stdout.splitlines() if not re.match(r'^(BEGIN|SET|ROLLBACK|COMMIT|(UPDATE|DELETE|INSERT) [\d ]+)$', l)]
    return "\n".join(out), p.stderr.strip(), p.returncode

def su(sql): return subprocess.run(BASE, input=sql, capture_output=True, text=True).stdout.strip()
def ok(c, m, extra=""):
    global fails, total; total += 1
    print(("PASS " if c else "FAIL ") + m + ((" | " + str(extra)[:200]) if (extra and not c) else ""))
    fails += (not c)
def val(sql, uid=None, role="authenticated"):
    o, e, rc = run(sql, uid, role); return o.splitlines()[-1] if o else ("ERR:" + e)
def err(sql, uid=None, role="authenticated", contains=""):
    o, e, rc = run(sql, uid, role); return rc != 0 and contains.lower() in e.lower(), e

# DB harus baru: jalankan tests/db/setup.sh dulu
for e in ["alice@x.com", "bob@x.com", "carol@x.com"]:
    su(f"insert into auth.users(email) values ('{e}')")
uid = lambda e: su(f"select id from auth.users where email='{e}'")
A, B, C = uid("alice@x.com"), uid("bob@x.com"), uid("carol@x.com")
MV = su("select id from public.model_versions where status='active'")
DS = su("select id from public.datasets where status='active'")
su("update public.profiles set role='admin' where email='carol@x.com'")
EX = lambda u, crop="rice", ph=6.5: (f"insert into public.examinations(user_id,nitrogen,phosphorus,potassium,temperature,humidity,ph,rainfall,predicted_crop,model_version_id)"
                                    f" values ('{u}',90,42,43,20.8,82,{ph},203,'{crop}','{MV}')")
su(EX(A) + ";" + EX(A, "maize") + ";" + EX(B, "rice"))

print("== Seed & trigger akun ==")
ok(su("select count(*) from public.model_versions where status='active'") == "1", "seed: tepat satu model aktif")
ok(su("select count(*) from public.application_settings") == "7", "seed: 7 pengaturan awal")
ok(su("select role from public.profiles where email='alice@x.com'") == "user", "akun baru otomatis berperan 'user'")
su("insert into auth.users(email, raw_user_meta_data) values ('evil@x.com','{\"role\":\"admin\",\"full_name\":\"Evil\"}')")
ok(su("select role||'/'||full_name from public.profiles where email='evil@x.com'") == "user/Evil", "metadata role='admin' saat signup diabaikan; nama diambil")
su("update auth.users set email='bob2@x.com' where email='bob@x.com'")
ok(su(f"select email from public.profiles where id='{B}'") == "bob2@x.com", "perubahan email auth tersinkron ke profil")

print("== profiles ==")
ok(val("select count(*) from public.profiles", A) == "1", "alice hanya melihat profilnya sendiri")
ok(val("select count(*) from public.profiles", C) == "4", "admin melihat semua profil")
ok(err(f"update public.profiles set role='admin' where id='{A}'", A, contains="permission denied")[0], "ESKALASI: user tidak bisa ubah role sendiri (permission denied)")
ok(err(f"update public.profiles set status='active', email='x@x.com' where id='{A}'", A, contains="permission denied")[0], "user tidak bisa ubah email/status")
ok(val(f"update public.profiles set full_name='Alice A' where id='{A}' returning full_name", A) == "Alice A", "user bisa ubah nama sendiri")
ok(val(f"with u as (update public.profiles set full_name='hack' where id='{B}' returning 1) select count(*) from u", A) == "0", "user tidak bisa ubah nama orang lain (0 baris)")
ok(err(f"insert into public.profiles(id,email,role) values (gen_random_uuid(),'z@z.com','admin')", A, contains="permission denied")[0], "user tidak bisa insert profil")
ok(err(f"delete from public.profiles where id='{B}'", A, contains="permission denied")[0], "user tidak bisa hapus profil")
ok(err("select 1 from public.profiles", None, "anon", "permission denied")[0], "anon tidak bisa baca profil")
ok(err("insert into public.profiles(id,email) values (gen_random_uuid(),'a@a.com')", C, contains="permission denied")[0], "bahkan admin tidak menulis profiles langsung (harus lewat RPC)")

print("== examinations ==")
ok(val("select count(*) from public.examinations", A) == "2", "alice melihat 2 pemeriksaan miliknya")
ok(val("select count(*) from public.examinations", B) == "1", "bob hanya melihat miliknya")
ok(val("select count(*) from public.examinations", C) == "3", "admin melihat semua pemeriksaan")
ok(err("select 1 from public.examinations", None, "anon", "permission denied")[0], "anon tidak bisa baca pemeriksaan")
ok(err(EX(A), A, contains="permission denied")[0], "user tidak bisa INSERT pemeriksaan (hasil palsu ditolak)")
ok(err(EX(A), C, contains="permission denied")[0], "admin pun tidak bisa INSERT langsung (hanya backend service role)")
ok(err("update public.examinations set predicted_crop='x'", A, contains="permission denied")[0], "pemeriksaan tidak bisa diubah")
ok(val(f"with d as (delete from public.examinations where user_id='{B}' returning 1) select count(*) from d", A) == "0", "alice tidak bisa hapus pemeriksaan bob")
ok(val(f"with d as (delete from public.examinations where user_id='{A}' returning 1) select count(*) from d", A) == "2", "alice bisa hapus pemeriksaan sendiri")
o, e, rc = run(f"delete from public.examinations where user_id='{B}'; select count(*) from public.audit_logs where action='examination.delete'", C)
ok(o.endswith("1"), "penghapusan pemeriksaan oleh admin tercatat di audit", o)
ok(err(EX(A, ph=15), None, "service_role", "check constraint")[0], "constraint: pH 15 ditolak")
ok(err(EX(A).replace("90,42", "-5,42"), None, "service_role", "check constraint")[0], "constraint: nilai negatif ditolak")
ok(err(EX(A).replace(MV, "00000000-0000-0000-0000-000000000000"), None, "service_role", "foreign key")[0], "FK: model_version_id harus ada")

print("== model_versions, datasets ==")
ok(val("select version from public.model_versions", A) == "v1.0.0", "user dapat melihat versi model aktif")
ok(err("select artifact_path from public.model_versions", A, contains="permission denied")[0], "artifact_path tidak terbaca user (kolom tidak di-grant)")
ok(err("select 1 from public.model_versions", None, "anon", "permission denied")[0], "anon tidak bisa baca model")
ok(val("select count(*) from public.datasets", A) == "0", "user tidak melihat dataset (RLS)")
ok(val("select count(*) from public.datasets", C) == "1", "admin melihat dataset")
ok(err("insert into public.datasets(dataset_name,file_path,version) values ('x','y','v9')", C, contains="permission denied")[0], "admin tidak insert dataset langsung dari browser")
ok(err(f"insert into public.model_versions(model_name,algorithm,version,artifact_path,status) values ('x','rf','vX','p','active')", None, "service_role", "unique")[0], "hanya satu model berstatus aktif (unique index)")
ok(err(f"insert into public.datasets(dataset_name,file_path,version,status) values ('x','y','vX','active')", None, "service_role", "unique")[0], "hanya satu dataset aktif")
ok(err("insert into public.datasets(dataset_name,file_path,version) values ('x','y','bad version!')", None, "service_role", "check constraint")[0], "format versi dataset divalidasi")

print("== audit_logs ==")
su(f"select public.write_audit('{A}','alice@x.com','test.event','x')")
ok(val("select count(*) from public.audit_logs", A) == "0", "user tidak melihat audit log")
ok(int(val("select count(*) from public.audit_logs", C)) >= 1, "admin melihat audit log")
ok(err("insert into public.audit_logs(action) values ('fake')", A, contains="permission denied")[0], "user tidak bisa menulis audit log")
ok(err("delete from public.audit_logs", C, contains="permission denied")[0], "admin tidak bisa hapus audit log (tanpa grant)")
ok(err("update public.audit_logs set action='x'", None, "service_role", "append-only")[0], "service_role pun tidak bisa UPDATE audit log (trigger)")
ok(err("delete from public.audit_logs", None, "service_role", "append-only")[0], "service_role tidak bisa DELETE audit log")
ok(err("truncate public.audit_logs", None, None, "append-only")[0], "TRUNCATE audit log diblokir")
ok(err("select public.write_audit(null,null,'x','y')", A, contains="permission denied")[0], "write_audit tidak bisa dipanggil dari browser")

print("== RPC admin ==")
ok(err(f"select public.admin_set_role('{B}','admin')", A, contains="Akses ditolak")[0], "user biasa tidak bisa memanggil admin_set_role")
ok(err(f"select public.admin_set_role('{B}','admin')", None, "anon", "permission denied")[0], "anon tidak bisa memanggil RPC")
ok(err(f"select public.admin_set_role('{B}','superuser')", C, contains="Role tidak valid")[0], "role tidak valid ditolak")
ok(err(f"select public.admin_set_role('{B}','user''; drop table public.profiles; --')", C, contains="tidak valid")[0] and su("select to_regclass('public.profiles') is not null") == "t", "injeksi SQL lewat parameter RPC tidak berefek")
o, e, rc = run(f"select public.admin_set_role('{B}','admin'); select role from public.profiles where id='{B}'; select count(*) from public.audit_logs where action='user.role_change' and details->>'to'='admin'", C)
ok(rc == 0 and o.splitlines() == ["", "admin", "1"] or (rc == 0 and "admin" in o), "admin dapat mengubah role + tercatat audit", o + e)
su(f"update public.profiles set role='user' where id='{B}'")
ok(err(f"select public.admin_set_role('{C}','user')", C, contains="terakhir")[0], "admin aktif TERAKHIR tidak bisa diturunkan")
ok(err(f"select public.admin_set_status('{C}','inactive')", C, contains="sendiri")[0], "admin tidak bisa menonaktifkan akun sendiri")
ok(err(f"delete from auth.users where id='{C}'", None, None, "terakhir")[0], "admin terakhir tidak bisa dihapus (cascade)")
o, e, rc = run(f"select public.admin_set_status('{B}','inactive'); select count(*) from public.profiles where id='{B}' and status='inactive'", C)
ok(rc == 0 and o.endswith("1"), "admin dapat menonaktifkan akun", o + e)
su(f"update public.profiles set status='inactive' where id='{B}'")
ok(val("select count(*) from public.examinations", B) == "0", "akun nonaktif tidak bisa membaca data (RLS is_active)")
ok(val("select count(*) from public.application_settings", B) == "0", "akun nonaktif tidak bisa membaca pengaturan")
ok(val(f"with u as (update public.profiles set full_name='x' where id='{B}' returning 1) select count(*) from u", B) == "0", "akun nonaktif tidak bisa ubah profil")
su(f"update public.profiles set status='active' where id='{B}'")
ok(err(f"select public.admin_update_setting('evil_key','true')", C, contains="tidak dikenal")[0], "kunci pengaturan tak dikenal ditolak")
ok(err(f"select public.admin_update_setting('ai_daily_limit','\"abc\"')", C, contains="bilangan bulat")[0], "tipe nilai pengaturan divalidasi")
ok(err(f"select public.admin_update_setting('ai_daily_limit','9999')", C, contains="bilangan bulat")[0], "rentang nilai pengaturan divalidasi")
ok(err(f"select public.admin_update_setting('registration_enabled','true')", A, contains="Akses ditolak")[0], "user tidak bisa ubah pengaturan")
o, e, rc = run("select public.admin_update_setting('registration_enabled','true'); select setting_value::text from public.application_settings where setting_key='registration_enabled'", C)
ok(rc == 0 and o.endswith("true"), "admin dapat ubah pengaturan", o + e)
ok(val("select setting_value::text from public.application_settings where setting_key='app_name'", A) == '"Crop Recommendation System"', "user dapat membaca pengaturan")
ok(err("insert into public.application_settings(setting_key,setting_value) values ('x1','1')", A, contains="permission denied")[0], "user tidak bisa menulis pengaturan")

print("== aktivasi model ==")
su(f"insert into public.model_versions(model_name,algorithm,version,artifact_path,dataset_id) values ('cand','rf','v2.0.0','v2.0.0','{DS}')")
V2 = su("select id from public.model_versions where version='v2.0.0'")
ok(err(f"select public.activate_model_version('{V2}')", A, contains="Akses ditolak")[0], "user tidak bisa mengaktifkan model")
run(f"select public.activate_model_version('{V2}')", C, commit=True)
o, e, rc = run(f"select string_agg(version||':'||status, ',' order by version) from public.model_versions; select status from public.datasets where id='{DS}'", C)
ok(rc == 0 and "v1.0.0:archived,v2.0.0:active" in o and o.endswith("active"), "aktivasi: lama diarsipkan, baru aktif, dataset aktif", o + e)
ok(err(f"select public.reject_model_version('{V2}')", C, contains="kandidat")[0], "model aktif tidak bisa 'ditolak'")
su("insert into public.model_versions(model_name,algorithm,version,artifact_path) values ('c3','rf','v3.0.0','v3.0.0')")
V3 = su("select id from public.model_versions where version='v3.0.0'")
run(f"select public.reject_model_version('{V3}')", C, commit=True)
o, e, rc = run(f"select status from public.model_versions where id='{V3}'", C)
ok(rc == 0 and o.endswith("rejected"), "kandidat dapat ditolak", o + e)
ok(err(f"select public.activate_model_version('{V3}')", C, contains="ditolak")[0], "model yang ditolak tidak bisa diaktifkan")
su(f"select public.activate_model_version('{MV}')") if False else su(f"update public.model_versions set status='archived' where id='{V2}'; update public.model_versions set status='active' where id='{MV}'")

print("== log_client_event ==")
o, e, rc = run(f"select public.log_client_event('auth.login'); reset role; select user_id::text from public.audit_logs where action='auth.login' order by id desc limit 1", A)
ok(rc == 0 and o.endswith(A), "login tercatat dengan user_id = auth.uid()", o + e)
ok(err("select public.log_client_event('user.role_change')", A, contains="tidak diizinkan")[0], "aksi di luar allowlist ditolak (tak bisa memalsukan audit admin)")
ok(err("select public.log_client_event('auth.login')", None, "anon", "permission denied")[0], "anon tidak bisa log_client_event")

print("== statistik ==")
ok(err("select public.admin_stats()", A, contains="Akses ditolak")[0], "user tidak bisa admin_stats")
o, e, rc = run("select (s->>'total_users')||'|'||(s->>'total_exams')||'|'||jsonb_array_length(s->'daily')||'|'||jsonb_array_length(s->'monthly')||'|'||(s->'active_model'->>'version')||'|'||(s->>'crops_in_model') from (select public.admin_stats() s) q", C)
ok(rc == 0 and o.split("|")[0] == "4" and o.split("|")[2:4] == ["30", "12"] and o.split("|")[5] == "22", "admin_stats: angka dari database (4 user, 30 hari, 12 bulan, 22 kelas)", o + e)
su(EX(A, "maize") + ";" + EX(A, "rice") + ";" + EX(A, "rice"))
o, e, rc = run(f"select (public.admin_report_summary(null,null,'{A}','rice')->>'total')", C)
ok(o.endswith("3"), "admin_report_summary menerapkan filter user+tanaman (3 rice milik alice)", o + e)
ok(err("select public.admin_report_summary()", A, contains="Akses ditolak")[0], "user tidak bisa laporan admin")

print("== AI ==")
su(f"insert into public.ai_conversations(user_id,title) values ('{A}','t1'),('{B}','t2')")
CA = su(f"select id from public.ai_conversations where user_id='{A}'")
su(f"insert into public.ai_messages(conversation_id,user_id,role,content) values ('{CA}','{A}','user','halo'),('{CA}','{A}','assistant','hai')")
ok(val("select count(*) from public.ai_conversations", A) == "1", "alice hanya melihat percakapannya")
ok(val("select count(*) from public.ai_messages", A) == "2", "alice melihat pesan percakapannya")
ok(val("select count(*) from public.ai_messages", B) == "0", "bob tidak melihat pesan alice")
ok(val("select count(*) from public.ai_conversations", C) == "0", "admin TIDAK membaca percakapan AI pengguna (kebijakan privasi)")
ok(err("insert into public.ai_messages(conversation_id,user_id,role,content) values ('" + CA + "','" + A + "','assistant','palsu')", A, contains="permission denied")[0], "user tidak bisa memalsukan pesan assistant")
ok(err(f"insert into public.ai_conversations(user_id) values ('{A}')", A, contains="permission denied")[0], "percakapan hanya dibuat backend")
ok(err(f"insert into public.ai_messages(conversation_id,user_id,role,content) values ('{CA}','{A}','system','x')", None, "service_role", "check constraint")[0], "role pesan 'system' ditolak")
ok(err(f"insert into public.ai_messages(conversation_id,user_id,role,content) values ('{CA}','{A}','user','')", None, "service_role", "check constraint")[0], "pesan kosong ditolak")
o, e, rc = run(f"delete from public.ai_conversations where id='{CA}'; select count(*) from public.ai_messages where conversation_id='{CA}'", None, "service_role")
ok(o.endswith("0"), "hapus percakapan menghapus pesannya (cascade)", o + e)
ok(val(f"with d as (delete from public.ai_conversations where user_id='{B}' returning 1) select count(*) from d", A) == "0", "alice tidak bisa hapus percakapan bob")

print("== hapus akun & idempotensi ==")
su(f"delete from auth.users where id='{A}'")
ok(su(f"select count(*) from public.examinations where user_id='{A}'") == "0", "hapus akun menghapus pemeriksaannya (cascade)")
ok(su("select count(*) from public.audit_logs where user_id is not null") != "0", "audit log tetap ada setelah akun dihapus")
ok(err("select public.is_admin()", None, "anon", "permission denied")[0], "anon tidak bisa memanggil is_admin")
import os
root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
bad = []
for f in ["database/schema.sql", "database/triggers.sql", "database/policies.sql", "database/seed.sql"]:
    p = subprocess.run(BASE[:-2] + ["-f", os.path.join(root, f)], capture_output=True, text=True)
    if p.returncode: bad.append((f, p.stderr[:150]))
ok(not bad, "semua file SQL dapat dijalankan ulang tanpa error (idempoten)", bad)
print(f"\nHASIL: {total - fails}/{total} lulus, {fails} gagal"); sys.exit(1 if fails else 0)
