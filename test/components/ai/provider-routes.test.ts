// Tes rute provider per tier model: Terstruktur dan Keputusan tersedia di setiap profil dan rute provider, dipakai
// runtime, tetap berjalan sebelum migrasi, dan disalin dari Murah oleh migrasi.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../../src/libraries/db.js';
import { AIService } from '../../../src/components/ai/domain/service.js';

const assistant = new AIService();
after(async () => {
  await db.end();
});
test('Terstruktur tier: every provider profile and route carries it, runtime uses it, and migration copies it from Murah', async () => {
  const { migrateAI } = await import('../../../src/components/ai/data-access/schema.js');
  const { encrypt } = await import('../../../src/libraries/crypto.js');
  const [settings] = await db.query<any[]>('SELECT id FROM ai_settings WHERE id=1'),
    createdSettings = !settings.length;
  if (createdSettings)
    await db.execute(
      "INSERT INTO ai_settings(id,endpoint,model,secret) VALUES (1,'https://openrouter.ai/api/v1/chat/completions','legacy',?)",
      [encrypt('legacy-key')],
    );
  try {
    const base = {
      name: 'OpenRouter uji',
      provider: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: 'key-1',
      model_cheap: 'm-cheap',
      model_medium: 'm-medium',
      model_smart: 'm-smart',
    };
    await assert.rejects(assistant.saveProviderProfile(base), { code: 'invalid_request' });
    const { id } = await assistant.saveProviderProfile({
      ...base,
      model_structured: 'm-structured',
      model_decision: 'm-decision',
    });
    assert.equal(
      (await assistant.providerProfiles()).profiles.find((p: any) => p.id === id)?.model_structured,
      'm-structured',
    );
    const routes = { cheap: { profileId: id }, medium: { profileId: id }, smart: { profileId: id } };
    await assert.rejects(assistant.setProviderRoutes(routes), { code: 'invalid_request' });
    await assert.rejects(assistant.setProviderRoutes({ ...routes, structured: { profileId: id } }), {
      code: 'invalid_request',
    });
    await assistant.setProviderRoutes({
      ...routes,
      structured: { profileId: id },
      decision: { profileId: id },
    });
    const config = await assistant.config();
    assert.equal(config.tier_profiles?.structured?.model, 'm-structured');
    assert.equal(config.tier_profiles?.decision?.model, 'm-decision');
    assert.equal(config.tier_profiles?.cheap?.model, 'm-cheap');
    // Kode baru berjalan sebelum `npm run migrate`: kolom dan rutenya belum ada. Routing harus tetap memakai profil untuk
    // setiap tier, dan Terstruktur memakai Murah alih-alih seluruh konfigurasi kembali ke cara lama.
    await db.query("DELETE FROM ai_provider_routes WHERE tier='structured'");
    await db.query('ALTER TABLE ai_provider_profiles DROP COLUMN model_structured');
    const early = await assistant.config();
    assert.deepEqual(
      [
        early.tier_profiles?.cheap?.model,
        early.tier_profiles?.medium?.model,
        early.tier_profiles?.smart?.model,
        early.tier_profiles?.structured?.model,
      ],
      ['m-cheap', 'm-medium', 'm-smart', 'm-cheap'],
    );
    assert.equal(early.tier_profiles?.structured?.id, id);
    const listed = (await assistant.providerProfiles()).profiles;
    assert.deepEqual(
      listed.map((p: any) => p.id),
      [id],
    );
    assert.equal('secret' in listed[0], false);
    await migrateAI();
    // Database dari sebelum tier ini ada: belum ada model terstruktur di profil dan belum ada rute terstruktur.
    await db.execute("UPDATE ai_provider_profiles SET model_structured='' WHERE id=?", [id]);
    await db.query("DELETE FROM ai_provider_routes WHERE tier='structured'");
    await db.query('UPDATE ai_settings SET model_structured=NULL WHERE id=1');
    await migrateAI();
    await migrateAI();
    const [route] = await db.query<any[]>("SELECT profile_id,model FROM ai_provider_routes WHERE tier='structured'");
    assert.deepEqual({ ...route[0] }, { profile_id: id, model: 'm-cheap' });
    assert.equal(
      (await assistant.providerProfiles()).profiles.find((p: any) => p.id === id)?.model_structured,
      'm-cheap',
    );
    assert.equal((await assistant.config()).tier_profiles?.structured?.model, 'm-cheap');
    // Simulasikan data sebelum tier Keputusan ada; migrasi harus menyalin model dan rute Murah.
    await db.execute("UPDATE ai_provider_profiles SET model_decision='' WHERE id=?", [id]);
    await db.query("DELETE FROM ai_provider_routes WHERE tier='decision'");
    await db.query('UPDATE ai_settings SET model_decision=NULL WHERE id=1');
    await migrateAI();
    const [decisionRoute] = await db.query<any[]>(
      "SELECT profile_id,model FROM ai_provider_routes WHERE tier='decision'",
    );
    assert.deepEqual({ ...decisionRoute[0] }, { profile_id: id, model: 'm-cheap' });
    assert.equal((await assistant.config()).tier_profiles?.decision?.model, 'm-cheap');
  } finally {
    // Routing bersifat global; tes berikutnya dibiarkan dengan konfigurasi tanpa rute yang diharapkannya.
    await db.query('DELETE FROM ai_provider_routes');
    await db.query('DELETE FROM ai_provider_profiles');
    if (createdSettings) await db.query('DELETE FROM ai_settings WHERE id=1');
    else await db.query('UPDATE ai_settings SET profile_routing_enabled=FALSE WHERE id=1');
  }
});
