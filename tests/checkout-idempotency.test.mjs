import test from 'node:test';
import assert from 'node:assert/strict';
import { withTempDb, request, setupOwner, createProduct } from './helpers.mjs';

test('POS checkout replays the same receipt for a repeated request key', async () => {
  await withTempDb('star-idem-', async () => {
    const owner = await setupOwner();
    const product = await createProduct(owner, { opening: 10 });
    const payload = {
      lines: [{ productId: product.id, qty: 1 }],
      payment: 'Cash',
      requestKey: 'pos-11111111-2222-3333',
    };
    const first = await request('/checkout', 'POST', payload, { cookie: owner });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const second = await request('/checkout', 'POST', payload, { cookie: owner });
    assert.equal(second.status, 201);
    assert.equal(second.body.receipt, first.body.receipt);
    assert.equal(second.body.replayed, true);
    assert.equal(second.body.total, first.body.total);
    let state = await request('/state', 'GET', undefined, { cookie: owner });
    assert.equal(state.body.receipts.length, 1);
    assert.equal(state.body.sales.length, 1);
    assert.equal(Number(state.body.products[0].stock_milli), 9000);
    const changed = await request(
      '/checkout',
      'POST',
      { ...payload, lines: [{ productId: product.id, qty: 2 }] },
      { cookie: owner }
    );
    assert.equal(changed.status, 409);
    // Concurrent duplicates: exactly one sale.
    const burst = { ...payload, requestKey: 'pos-44444444-5555-6666' };
    const results = await Promise.all([
      request('/checkout', 'POST', burst, { cookie: owner }),
      request('/checkout', 'POST', burst, { cookie: owner }),
    ]);
    assert.deepEqual(
      results.map(r => r.status),
      [201, 201]
    );
    assert.equal(results[0].body.receipt, results[1].body.receipt);
    state = await request('/state', 'GET', undefined, { cookie: owner });
    assert.equal(state.body.receipts.length, 2);
    assert.equal(Number(state.body.products[0].stock_milli), 8000);
  });
});
