import test from 'node:test';
import assert from 'node:assert/strict';
import { withTempDb, request, setupOwner, createVendor, createProduct } from './helpers.mjs';

test('supplier returns are bounded by receipts and stock, and surface a negative balance', async () => {
  await withTempDb('star-returns-', async () => {
    const owner = await setupOwner();
    const vendor = await createVendor(owner);
    const product = await createProduct(owner, { vendorId: vendor.vendorId, opening: 0 });
    const purchase = await request('/purchases', 'POST', { productId: product.id, vendorId: vendor.vendorId, qty: 10, cost: '80', payment: 'Paid' }, { cookie: owner });
    assert.equal(purchase.status, 201, JSON.stringify(purchase.body));
    assert.equal((await request('/vendor/returns', 'POST', { purchaseId: purchase.body.id, qty: 11, reason: 'Damaged' }, { cookie: owner })).status, 400);
    assert.equal((await request('/vendor/returns', 'POST', { purchaseId: purchase.body.id, qty: 2 }, { cookie: owner })).status, 400);
    const returned = await request('/vendor/returns', 'POST', { purchaseId: purchase.body.id, qty: 2, reason: 'Damaged' }, { cookie: owner });
    assert.equal(returned.status, 201, JSON.stringify(returned.body));
    assert.equal(Number(returned.body.amount_paisa), 16000);
    assert.equal((await request('/vendor/returns', 'GET', undefined, { cookie: owner })).body.returns.length, 1);
    assert.equal(Number((await request('/public/products')).body.products[0].stock_milli), 8000);
    const overpay = await request('/vendor/payments', 'POST', { vendorId: vendor.vendorId, amount: '1', method: 'Cash' }, { cookie: owner });
    assert.equal(overpay.status, 400);
    const overview = await request('/vendor/overview', 'GET', undefined, { cookie: vendor.cookie });
    assert.equal(overview.body.ledger.summary.balance, -16000);
    assert.equal(overview.body.ledger.summary.vendorOwes, 16000);
  });
});
