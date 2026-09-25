// Lokasi file yang ditulis aplikasi saat berjalan. Tidak masuk git, dan ikut setiap backup.
//   storage/whatsapp/<akun>/<sesi>/  login WhatsApp (Baileys) dan metadata sesi
//   storage/files/<jenis>/<akun>/    file milik klien
import { cp, mkdir, readdir, rename, rm, rmdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const storageRoot = resolve('storage');

export function storagePaths(root = storageRoot) {
  return {
    whatsapp: join(root, 'whatsapp'),
    media: join(root, 'files', 'media'),
    productImages: join(root, 'files', 'product-images'),
    aiDocuments: join(root, 'files', 'ai-documents'),
    shareAssets: join(root, 'files', 'share-assets'),
  };
}

// Folder di auth/ lama dan tujuannya sekarang; entri lain adalah folder sesi milik sebuah akun.
const legacyFolders: Record<string, Exclude<keyof ReturnType<typeof storagePaths>, 'whatsapp'>> = {
  _media: 'media',
  '_product-images': 'productImages',
  '_ai-documents': 'aiDocuments',
  '_share-assets': 'shareAssets',
};

// Memindahkan auth/ lama ke storage/ sekali, per entri, sehingga proses yang terputus dilanjutkan saat
// start berikutnya. Tujuan yang hanya berisi folder kosong (sisa start sebelum pemindahan) diganti; tujuan
// yang berisi file tidak pernah digabung: start dihentikan, supaya tidak ada sesi atau file klien yang
// diam-diam tersembunyi. Mengembalikan jumlah entri yang dipindah.
export async function moveLegacyStorage(root = storageRoot, legacy = resolve('auth')) {
  let entries: string[];
  try {
    entries = await readdir(legacy);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  const paths = storagePaths(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(paths.whatsapp, { recursive: true, mode: 0o700 });
  await mkdir(join(root, 'files'), { recursive: true, mode: 0o700 });
  let moved = 0;
  for (const name of entries) {
    const target = legacyFolders[name] ? paths[legacyFolders[name]] : join(paths.whatsapp, name);
    if (await hasFiles(target))
      throw Error(
        `Penyimpanan lama auth/${name} tidak dipindah karena ${target} sudah berisi file. Periksa dan gabungkan manual.`,
      );
    await rm(target, { recursive: true, force: true });
    await move(join(legacy, name), target);
    moved++;
  }
  // Service yang hanya boleh menulis di dalam auth/ dan storage/ tidak bisa menghapus auth/ itu sendiri;
  // folder kosong yang tersisa tidak berbahaya.
  await rmdir(legacy).catch(() => {});
  return moved;
}

// rename bersifat atomik tapi hanya dalam satu filesystem. ReadWritePaths di systemd me-mount auth/ dan
// storage/ terpisah, jadi di sana entri disalin ke samping tujuannya lalu ditukar dengan rename.
async function move(from: string, to: string) {
  try {
    await rename(from, to);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
  }
  const staging = to + '.moving';
  await rm(staging, { recursive: true, force: true });
  await cp(from, staging, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false });
  await rename(staging, to);
  await rm(from, { recursive: true, force: true });
}

// Folder yang hanya berisi folder kosong dianggap kosong.
async function hasFiles(path: string): Promise<boolean> {
  const entries = await readdir(path, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'ENOTDIR') return true;
    throw error;
  });
  if (entries === null) return false;
  if (entries === true) return true;
  for (const entry of entries) if (!entry.isDirectory() || (await hasFiles(join(path, entry.name)))) return true;
  return false;
}
