// Menyimpan CS lengkap sebagai draft; draft audit lama hanya diganti jika masih persis fixture awal.
import { writeFile, mkdir } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../../src/libraries/db.js';
import { createGraph, listGraphs, saveGraph } from '../../src/components/ai/domain/builder/store.js';
import { csTemplate } from '../../src/components/ai/domain/builder/cs-template.js';
import { csParityProfile, auditName } from '../checks/fixtures/cs-parity-profile.js';
try {
  const definition = csTemplate();
  await mkdir('docs/examples', { recursive: true });
  await writeFile('docs/examples/cs-complete.profile.json', JSON.stringify(definition, null, 2) + '\n');
  if (process.argv.includes('--create')) {
    const graphs = await listGraphs();
    const existing = graphs.find(g => g.draft.name === definition.name);
    const priorTemplate = structuredClone(definition);
    for (const node of priorTemplate.nodes) delete node.context_format;
    const upgrade = existing && !existing.active && isDeepStrictEqual(existing.draft, priorTemplate);
    const previous = graphs.find(
      g => g.draft.name === auditName && !g.active && isDeepStrictEqual(g.draft, csParityProfile()),
    );
    const [owners] = await db.query<RowDataPacket[]>("SELECT id FROM accounts WHERE role='owner'");
    if (owners.length !== 1) throw Error('Penyimpanan draft memerlukan tepat satu owner untuk atribusi audit.');
    const owner = String(owners[0].id);
    const result =
      (upgrade ? await saveGraph(owner, existing.id, { revision: existing.revision, definition }) : existing) ??
      (previous
        ? await saveGraph(owner, previous.id, { revision: previous.revision, definition })
        : await createGraph(owner, definition));
    console.log(
      JSON.stringify({
        id: result.id,
        name: definition.name,
        published: !!result.active,
        url: '/dashboard/admin/ai-builder?profile=' + result.id,
      }),
    );
  }
} finally {
  await db.end();
}
