// Screenshot pemeriksaan browser, untuk dilihat orang setelahnya. Disimpan di luar proyek, di folder temporary
// sistem, dan diganti setiap kali pemeriksaan dijalankan.
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const screenshots = join(tmpdir(), 'ncwa-browser-check');
