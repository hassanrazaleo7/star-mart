import test from 'node:test';
import assert from 'node:assert/strict';
import { withTempDb, request, setupOwner, createStaff, createProduct } from './helpers.mjs';

test('staff discounts are capped, every discount needs a reason, tax comes from product rates', async () => {
  await withTempDb('star-policy-', async () => {
    const owner = await setupOwner();
    const staff = await createStaff(owner);
    const product = await createProduct(owner, {
      opening: 20,
      price: '250',
      cost: '180',
      taxRate: 10,
    });
    const line = { lines: [{ productId: product.id, qty: 1 }], payment: 'Cash' };
    const noReason = await request(
      '/checkout',
      'POST',
      { ...line, discount: '5' },
      { cookie: owner }
    );
    assert.equal(noReason.status, 400);
    assert.match(noReason.body.error, /reason/);
    const tooMuch = await request(
      '/checkout',
      'POST',
      { ...line, discount: '20', discountReason: 'friend' },
      { cookie: staff }
    );
    assert.equal(tooMuch.status, 403, JSON.stringify(tooMuch.body));
    const within = await request(
      '/checkout',
      'POST',
      { ...line, discount: '10', discountReason: 'damaged pack' },
      { cookie: staff }
    );
    assert.equal(within.status, 201, JSON.stringify(within.body));
    assert.equal(within.body.discount, 1000);
    // 10 % tax on (25000 - 1000) = 2400 paisa; staff cannot override it.
    const staffTax = await request('/checkout', 'POST', { ...line, tax: '99' }, { cookie: staff });
    assert.equal(staffTax.status, 201);
    assert.equal(staffTax.body.tax, 2500);
    assert.equal(staffTax.body.total, 27500);
    assert.equal(within.body.tax, 2400);
    const ownerBig = await request(
      '/checkout',
      'POST',
      {
        lines: [{ productId: product.id, qty: 2 }],
        payment: 'Cash',
        discount: '250',
        discountReason: 'owner promo',
        tax: '5',
      },
      { cookie: owner }
    );
    assert.equal(ownerBig.status, 201, JSON.stringify(ownerBig.body));
    assert.equal(ownerBig.body.tax, 500);
    assert.equal(ownerBig.body.total, 50000 - 25000 + 500);
    const feed = await request('/admin/activity', 'GET', undefined, { cookie: owner });
    assert.ok(feed.body.events.some(e => e.entity === 'receipts' && e.action === 'DISCOUNT'));
    const daily = await request(
      '/reports/daily-sales?date=' + new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10),
      'GET',
      undefined,
      { cookie: owner }
    );
    assert.equal(daily.status, 200);
    assert.ok(daily.body.receipts.some(r => r.discount_reason === 'owner promo'));
  });
});
