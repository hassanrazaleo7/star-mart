import test from 'node:test';
import assert from 'node:assert/strict';
import { withTempDb, request, setupOwner, createProduct, createCustomer, pngOf } from './helpers.mjs';
import { db, AUDITED_TABLES } from '../server/db.mjs';

test('the live version changes after every kind of store change and all audit triggers exist', async () => {
  await withTempDb('star-live-', async () => {
    const owner = await setupOwner();
    const versions = [(await request('/live/version')).body.version];
    const product = await createProduct(owner);
    versions.push((await request('/live/version')).body.version);
    await request('/admin/settings', 'POST', { address: 'Main road' }, { cookie: owner });
    versions.push((await request('/live/version')).body.version);
    await request('/products/' + product.id + '/image', 'POST', pngOf(2, 2), { cookie: owner, raw: true });
    versions.push((await request('/live/version')).body.version);
    const customer = await createCustomer();
    await request('/customer/orders', 'POST', { lines: [{ productId: product.id, qty: 1 }], fulfillment: 'Pickup', phone: '03001234567' }, { cookie: customer.cookie });
    versions.push((await request('/live/version')).body.version);
    assert.equal(new Set(versions).size, versions.length, JSON.stringify(versions));
    const c = await db();
    for (const table of [...AUDITED_TABLES, 'product_images']) {
      const r = await c.query("SELECT 1 FROM pg_trigger WHERE tgname='star_mart_activity' AND tgrelid=$1::regclass", [table]);
      assert.equal(r.rows.length, 1, table + ' has no audit trigger');
    }
    assert.equal((await c.query("SELECT 1 FROM pg_trigger WHERE tgname='star_mart_stock'")).rows.length, 1);
  });
});
