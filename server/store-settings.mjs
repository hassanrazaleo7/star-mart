import { whatsappNumber } from '../src/whatsapp-order.mjs';
import { db } from './db.mjs';
import { fail } from './errors.mjs';
const keys = [
  'communityUrl',
  'whatsapp',
  'phone',
  'address',
  'hours',
  'accountName',
  'jazzcash',
  'easypaisa',
  'bank',
  'deliveryNote',
];
// Read lazily so .env.local values loaded after module evaluation are still honoured.
const defaults = () => ({
  communityUrl: '',
  whatsapp: '',
  phone: '',
  address: '',
  hours: '',
  accountName: 'Star Mart',
  jazzcash: process.env.VITE_JAZZCASH_ACCOUNT || process.env.JAZZCASH_ACCOUNT || '',
  easypaisa: process.env.VITE_EASYPAISA_ACCOUNT || process.env.EASYPAISA_ACCOUNT || '',
  bank: process.env.VITE_BANK_ACCOUNT || process.env.BANK_ACCOUNT || '',
  deliveryNote: 'The store confirms delivery coverage and timing before dispatch.',
});
export async function settingsInit(d) {
  await d.query(
    'CREATE TABLE IF NOT EXISTS store_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())'
  );
}
export async function storeSettings() {
  const r = await (await db()).query('SELECT key,value FROM store_settings');
  return { ...defaults(), ...Object.fromEntries(r.rows.map(x => [x.key, x.value])) };
}
export async function saveSettings(c, b) {
  if (b.communityUrl) {
    let url;
    try {
      url = new URL(b.communityUrl);
    } catch {
      throw fail('Enter a valid WhatsApp community link');
    }
    if (
      url.protocol !== 'https:' ||
      !['chat.whatsapp.com', 'www.whatsapp.com', 'whatsapp.com', 'wa.me'].includes(url.hostname)
    )
      throw fail('Use an official WhatsApp community or channel link');
  }
  if (b.whatsapp && !whatsappNumber(b.whatsapp))
    throw fail('Enter a valid WhatsApp number, e.g. 03001234567');
  for (const key of keys) {
    const value = String(b[key] ?? '').trim();
    if (value.length > 500) throw fail('Store detail is too long');
    await c.query(
      'INSERT INTO store_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()',
      [key, value]
    );
  }
  await c.query(
    "INSERT INTO activity_events(entity,entity_id,action,actor) VALUES('store_settings','store','UPDATE','Owner')"
  );
  return { ok: true };
}
