import { boot, pageHead, $ } from '../ui.js';
import { recentExamTable } from './_admin-exams.js';
boot({ role: 'admin', nav: 'examinations', title: 'Pemeriksaan' }, async (main) => {
  main.innerHTML = pageHead('Manajemen pemeriksaan', 'Seluruh pemeriksaan semua pengguna. Penghapusan tercatat di audit log.') + '<div id="t"></div>';
  await recentExamTable($('#t', main), { title: 'Semua pemeriksaan', size: 15, full: true });
});
