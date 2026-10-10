import test from 'node:test';
import assert from 'node:assert/strict';
import { withTempDb, request, setupOwner, createStaff, createProduct } from './helpers.mjs';
import { localDate } from '../server/state.mjs';

test('range reports aggregate sales, margin, purchases and expenses in the database', async () => {
  await withTempDb('star-reports-', async () => {
    const owner = await setupOwner();
    const staff = await createStaff(owner);
    const product = await createProduct(owner, { opening: 0, price: '250', cost: '180' });
    await request(
      '/purchases',
      'POST',
      { productId: product.id, qty: 10, cost: '180', payment: 'Paid' },
      { cookie: owner }
    );
    await request(
      '/expenses',
      'POST',
      { category: 'Rent', description: 'Shop rent', amount: '100' },
      { cookie: owner }
    );
    const sale = await request(
      '/checkout',
      'POST',
      { lines: [{ productId: product.id, qty: 2 }], payment: 'Cash' },
      { cookie: staff }
    );
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    const today = localDate();
    assert.equal(
      (
        await request('/reports/range?from=' + today + '&to=' + today, 'GET', undefined, {
          cookie: staff,
        })
      ).status,
      403
    );
    const r = await request('/reports/range?from=' + today + '&to=' + today, 'GET', undefined, {
      cookie: owner,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.totals.bills, 1);
    assert.equal(r.body.totals.salesPaisa, 50000);
    assert.equal(r.body.totals.costPaisa, 36000);
    assert.equal(r.body.totals.grossProfitPaisa, 14000);
    assert.equal(r.body.totals.purchasesPaisa, 180000);
    assert.equal(r.body.totals.expensesPaisa, 10000);
    assert.equal(r.body.totals.netPaisa, 4000);
    assert.deepEqual(
      r.body.days.map(d => d.day),
      [today]
    );
    assert.equal(r.body.products[0].name, 'Rice');
    assert.equal(r.body.payments[0].payment, 'Cash');
    assert.equal(
      (
        await request('/reports/range?from=2026-12-01&to=2026-01-01', 'GET', undefined, {
          cookie: owner,
        })
      ).status,
      400
    );
    const state = await request('/state?from=' + today, 'GET', undefined, { cookie: owner });
    assert.equal(state.body.window.limit, 5000);
    assert.equal(state.body.sales.length, 1);
    const old = await request('/state?from=2030-01-01', 'GET', undefined, { cookie: owner });
    assert.equal(old.body.sales.length, 0);
    assert.equal(old.body.products.length, 1);
  });
});
