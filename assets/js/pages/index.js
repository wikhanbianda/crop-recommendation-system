// Landing: bila sudah login, tombol langsung mengarah ke dashboard sesuai role.
import { getSession } from '../../../services/supabase.js';
import { me, homeFor } from '../../../services/auth.js';
import { url } from '../ui.js';
if (getSession()) me().then((u) => { for (const id of ['cta-nav', 'cta-main']) { const a = document.getElementById(id); a.href = url(homeFor(u.role)); a.textContent = 'Buka dashboard'; } }).catch(() => {});
