// Only pass system descriptions; never message bodies, keys, URLs, or auth objects.
export function log(sessionId: string | undefined, message: string) {
  console.log(`${new Date().toISOString()} [${sessionId ?? 'engine'}] ${message}`);
}

let guarded = false;
export function protectLibraryLogs() {
  if (guarded) return;
  guarded = true;
  // libsignal bypasses Baileys' logger and prints credential objects to console.
  // This engine uses only log()/console.log; keep library diagnostics content-free.
  console.info = () => {};
  console.warn = () => {};
  console.error = () => log(undefined, 'Kesalahan library WhatsApp; detail sensitif disembunyikan');
}
