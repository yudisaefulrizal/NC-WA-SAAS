// Asisten AI, tab Riwayat pemakaian kredit AI.
async function loadAIUsage(page = aiUsagePage) {
  if (aiUsageLoading) return;
  aiUsageLoading = true;
  $('ai-usage-prev').disabled = $('ai-usage-next').disabled = true;
  try {
    const result = await api('/api/ai/usage?page=' + page);
    aiUsagePage = result.page;
    const rows = result.items;
    table(
      'ai-usage',
      ['Waktu', 'Sesi', 'Pelanggan', 'Status', 'Kata input', 'Kata output', 'Kredit dipotong'],
      rows,
      r => [
        new Date(r.created_at).toLocaleString('id-ID'),
        r.session_id,
        r.customer,
        {
          fallback_sent: 'Pesan bantuan terkirim',
          fallback_generated: 'Menyiapkan pesan bantuan',
          fallback_send_failed: 'Pesan bantuan gagal terkirim',
          fallback_send_unknown: 'Pengiriman bantuan belum pasti',
          sent: 'Terkirim',
          generating: 'Memproses',
          generated: 'Menunggu pengiriman',
          cancelled: 'Dibatalkan',
          provider_failed: 'AI gagal / hasil tidak valid',
          interrupted: 'Terhenti saat restart',
          send_failed: 'WhatsApp gagal',
          send_unknown: 'Pengiriman belum pasti',
        }[r.status] || r.status,
        r.input_words,
        r.output_words,
        r.charged,
      ],
    );
    $('ai-usage-page').textContent =
      'Halaman ' + result.page + ' dari ' + result.pages + ' · ' + result.total + ' riwayat';
    $('ai-usage-prev').disabled = result.page <= 1;
    $('ai-usage-next').disabled = result.page >= result.pages;
  } catch (error) {
    $('ai-usage-prev').disabled = aiUsagePage <= 1;
    $('ai-usage-next').disabled = false;
    throw error;
  } finally {
    aiUsageLoading = false;
  }
}
$('ai-usage-prev').onclick = () => run(() => loadAIUsage(aiUsagePage - 1));
$('ai-usage-next').onclick = () => run(() => loadAIUsage(aiUsagePage + 1));
