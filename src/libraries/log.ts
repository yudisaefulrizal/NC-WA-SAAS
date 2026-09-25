// Log aplikasi, dan peredam log library WhatsApp agar tidak ada data sensitif yang tercetak.
// Hanya untuk keterangan sistem; jangan pernah isi pesan, kunci, URL, atau objek auth.
export function log(sessionId: string | undefined, message: string) {
  console.log(`${new Date().toISOString()} [${sessionId ?? 'engine'}] ${message}`);
}

let guarded = false;
export function protectLibraryLogs() {
  if (guarded) return;
  guarded = true;
  // libsignal melewati logger Baileys dan mencetak objek kredensial ke console.
  // Engine ini hanya memakai log()/console.log, jadi diagnosa library dibuat tanpa isi.
  console.info = () => {};
  console.warn = () => {};
  console.error = () => log(undefined, 'Kesalahan library WhatsApp; detail sensitif disembunyikan');
}
