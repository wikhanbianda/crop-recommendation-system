// Konfigurasi publik untuk browser. HANYA URL Supabase dan anon key (kunci anon memang publik; keamanan ada di RLS).
// service_role, AI_API_KEY, dan INFERENCE_SERVICE_KEY tidak pernah muncul di sini.
import { env, json, route } from './_lib/core.js';
import { sbJson } from './_lib/supabase.js';

export default route(['GET'], async () => {
  const url = env('SUPABASE_URL'); const anonKey = env('SUPABASE_ANON_KEY');
  if (!url || !anonKey) return json(503, { error: 'not_configured', message: 'Server belum dikonfigurasi (SUPABASE_URL / SUPABASE_ANON_KEY).' });
  let registrationEnabled = false; let appName = 'Crop Recommendation System'; let maintenance = false;
  try {
    const rows = await sbJson('/rest/v1/application_settings?setting_key=in.(registration_enabled,app_name,maintenance_mode)&select=setting_key,setting_value');
    for (const r of rows || []) {
      if (r.setting_key === 'registration_enabled') registrationEnabled = r.setting_value === true;
      if (r.setting_key === 'app_name' && typeof r.setting_value === 'string') appName = r.setting_value;
      if (r.setting_key === 'maintenance_mode') maintenance = r.setting_value === true;
    }
  } catch { /* pengaturan tak terbaca: pakai default aman (registrasi nonaktif) */ }
  return json(200, { supabaseUrl: url, supabaseAnonKey: anonKey, registrationEnabled, appName, maintenance }, { 'cache-control': 'no-store' });
});
