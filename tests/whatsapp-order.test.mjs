import test from 'node:test';
import assert from 'node:assert/strict';
import { withTempDb, request, setupOwner, createProduct } from './helpers.mjs';

test('guest WhatsApp orders become inquiries that staff confirm before stock is held', async () => {
  await withTempDb('star-whatsapp-', async () => {
    const owner = await setupOwner();
    const product = await createProduct(owner, { opening: 5 });
    const body = {
      requestKey: 'guest-request-key-0001-abcdef',
      name: 'Sara',
      phone: '03001234567',
      fulfillment: 'Pickup',
      paymentMethod: 'Cash on pickup',
      lines: [{ productId: product.id, qty: 2 }],
    };
    assert.match(
      (await request('/public/whatsapp-order', 'POST', body)).body.error,
      /not configured/
    );
    await request('/admin/settings', 'POST', { whatsapp: '03009998877' }, { cookie: owner });
    const transfer = await request('/public/whatsapp-order', 'POST', {
      ...body,
      paymentMethod: 'JazzCash transfer',
      paymentReference: 'TX1',
    });
    assert.equal(transfer.status, 400);
    const placed = await request('/public/whatsapp-order', 'POST', body);
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    assert.equal(placed.body.status, 'Inquiry');
    assert.equal(placed.body.guest, true);
    assert.match(placed.body.whatsappUrl, /^https:\/\/wa\.me\/923009998877\?text=/);
    assert.match(decodeURIComponent(placed.body.whatsappUrl.split('text=')[1]), /Rice/);
    assert.equal(Number((await request('/public/products')).body.products[0].stock_milli), 5000);
    const replay = await request('/public/whatsapp-order', 'POST', body);
    assert.equal(replay.body.id, placed.body.id);
    const orders = await request('/orders', 'GET', undefined, { cookie: owner });
    assert.equal(orders.body.orders.find(o => o.id === placed.body.id).status, 'Inquiry');
    const confirmed = await request(
      '/orders/' + placed.body.id + '/Confirm',
      'POST',
      {},
      { cookie: owner }
    );
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(Number((await request('/public/products')).body.products[0].stock_milli), 3000);
    assert.equal((await request('/public/products/' + product.id)).body.product.name, 'Rice');
  });
});
