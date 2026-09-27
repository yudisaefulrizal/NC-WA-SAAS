// Lingkup satu pesan yang dijalankan graf profil: identitas akun, data profil, sesi, dan pelanggan. Selalu berasal
// dari gateway yang sudah terautentikasi, tidak pernah dari argumen model.
export interface PendingFallback {
  id: string;
  question: string;
}
export interface ToolContext {
  // profile adalah data profil (ai_data_profiles.id) yang record, file, dan sumber datanya dibaca graf.
  readonly account: string;
  readonly profile: string;
  readonly session: string;
  readonly customer: string;
  // Nama WhatsApp pelanggan dan nama data profil, untuk variabel customer.name dan service.name.
  readonly customerName?: string;
  readonly serviceName?: string;
  // Lampiran pelanggan yang sudah disimpan sebagai file data profil, untuk node Terima media.
  readonly incomingMedia?: {
    readonly file: string;
    readonly filename: string;
    readonly type: 'image' | 'document';
    readonly mimetype: string;
    readonly caption: string;
  };
  readonly requestId: string;
  readonly behavior?: string;
  readonly fallbackEnabled?: boolean;
  readonly pendingFallbacks?: readonly PendingFallback[];
}
