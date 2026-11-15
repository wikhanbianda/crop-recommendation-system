// dashboard.html: pengarah ke dashboard sesuai role (role dari database via backend).
import { me, homeFor } from '../../../services/auth.js';
import { getSession } from '../../../services/supabase.js';
import { url } from '../ui.js';
if (!getSession()) location.replace(url('login.html'));
else me().then((u) => location.replace(url(homeFor(u.role)))).catch(() => location.replace(url('login.html?expired=1')));
