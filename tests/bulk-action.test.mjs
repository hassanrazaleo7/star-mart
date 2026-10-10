import test from 'node:test';
import assert from 'node:assert/strict';
import { withTempDb, request, setupOwner, createProduct, createCustomer } from './helpers.mjs';

test('soft-deleted products free their barcode, cannot be shown again, and stock corrections respect holds', async () => {
  await withTempDb('star-bulk-', async () => {
    const owner = await setupOwner();
    const product = await createProduct(owner, { barcode: '5551112223334', opening: 10 });
    const customer = await createCustomer();
    const order = await request('/customer/orders', 'POST', { lines: [{ productId: product.id, qty: 2 }], fulfillment: 'Pickup', phone: '03001234567' }, { cookie: customer.cookie });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    const blocked = await request('/products/' + product.id, 'DELETE', undefined, { cookie: owner });
    assert.equal(blocked.status, 409);
    assert.deepEqual(blocked.body.pendingOrders, [order.body.id]);
    assert.equal((await request('/products/' + product.id + '/stock', 'POST', { quantity: 1, note: 'count' }, { cookie: owner })).status, 400);
    assert.equal((await request('/products/' + product.id + '/stock', 'POST', { quantity: 5 }, { cookie: owner })).status, 400);
    const counted = await request('/products/' + product.id + '/stock', 'POST', { quantity: 5, note: 'physical count' }, { cookie: owner });
    assert.equal(counted.status, 200, JSON.stringify(counted.body));
    assert.equal(Number((await request('/public/products')).body.products[0].stock_milli), 3000);
    await request('/orders/' + order.body.id + '/Cancelled', 'POST', {}, { cookie: owner });
    const hidden = await request('/products/bulk-action', 'POST', { ids: [product.id], action: 'hide' }, { cookie: owner });
    assert.equal(hidden.status, 200);
    assert.equal((await request('/public/products')).body.products.length, 0);
    assert.equal((await request('/products/' + product.id, 'DELETE', undefined, { cookie: owner })).status, 200);
    const again = await createProduct(owner, { name: 'Rice again', barcode: '5551112223334' });
    assert.equal(again.barcode, '5551112223334');
    const show = await request('/products/bulk-action', 'POST', { ids: [product.id], action: 'show' }, { cookie: owner });
    assert.equal(show.status, 409);
    const state = await request('/state', 'GET', undefined, { cookie: owner });
    assert.equal(state.body.products.filter(p => !p.deleted_at).length, 1);
  });
});
