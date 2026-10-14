import test from 'node:test';
import assert from 'node:assert/strict';
import { withTempDb, request, setupOwner, createVendor, createStaff } from './helpers.mjs';
import { db } from '../server/db.mjs';
const draft = {
  name: 'Milk Pack',
  category: 'Dairy & Eggs',
  cost: '80',
  price: '120',
  vendorAvailable: 20,
  barcode: '990001',
};
test('owner reviews supplier details and physically received stock; draft edits stay private', () =>
  withTempDb('owner-review-', async () => {
    const owner = await setupOwner(),
      vendor = await createVendor(owner);
    const submitted = await request(
      '/products',
      'POST',
      { ...draft, opening: 999 },
      { cookie: vendor.cookie }
    );
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    const pid = submitted.body.id;
    assert.equal(submitted.body.review_status, 'Pending');
    assert.equal(Number(submitted.body.stock_milli), 0);
    const publicBefore = await request('/public/products');
    assert.ok(!JSON.stringify(publicBefore.body).includes('Milk Pack'));
    assert.equal(
      (
        await request(
          '/products/bulk-action',
          'POST',
          { ids: [pid], action: 'show' },
          { cookie: owner }
        )
      ).status,
      409
    );
    const review = (await request('/product-submissions', 'GET', undefined, { cookie: owner })).body
      .submissions[0];
    const picture = Buffer.from([255, 216, 255, 1, 2, 3]);
    assert.equal(
      (
        await request('/products/' + pid + '/image', 'POST', picture, {
          cookie: vendor.cookie,
          raw: true,
        })
      ).status,
      200
    );
    assert.equal((await request('/images/' + pid)).status, 404);
    assert.equal(
      (
        await request(
          '/product-submissions/' + review.id + '/review',
          'POST',
          { action: 'approve', verified: true, receivedQty: 5, paid: 500 },
          { cookie: owner }
        )
      ).status,
      400
    );
    assert.equal(
      (await request('/product-submissions', 'GET', undefined, { cookie: owner })).body
        .submissions[0].status,
      'Pending'
    );
    const approved = await request(
      '/product-submissions/' + review.id + '/review',
      'POST',
      { action: 'approve', verified: true, receivedQty: 5, paid: 100 },
      { cookie: owner }
    );
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    const state = (await request('/state', 'GET', undefined, { cookie: owner })).body;
    assert.equal(Number(state.products[0].stock_milli), 5000);
    assert.equal(Number(state.purchases[0].paid_paisa), 10000);
    assert.equal(state.products[0].catalog_status, 'active');
    assert.deepEqual((await request('/images/' + pid)).body, picture);
    const changed = await request(
      '/products/' + pid,
      'PUT',
      { ...draft, name: 'New pending name', price: 150 },
      { cookie: vendor.cookie }
    );
    assert.equal(changed.status, 200);
    const p = (await (await db()).query('SELECT * FROM products WHERE id=$1', [pid])).rows[0];
    assert.equal(p.name, 'Milk Pack');
    assert.equal(Number(p.price_paisa), 12000);
    assert.equal(Number(p.stock_milli), 5000);
    const next = (
      await request('/product-submissions', 'GET', undefined, { cookie: owner })
    ).body.submissions.find(x => x.status === 'Pending');
    assert.equal(
      (
        await request(
          '/product-submissions/' + next.id + '/review',
          'POST',
          { action: 'return', note: 'Correct the photo and price' },
          { cookie: owner }
        )
      ).status,
      200
    );
    assert.equal(
      (await request('/products/' + pid, 'DELETE', undefined, { cookie: vendor.cookie })).status,
      403
    );
    assert.equal(
      (await request('/products/' + pid, 'DELETE', undefined, { cookie: owner })).status,
      200
    );
    assert.equal(
      (await (await db()).query('SELECT count(*) n FROM purchases WHERE product_id=$1', [pid]))
        .rows[0].n,
      1
    );
  }));
test('staff must open their own shift; cash reconciliation and receipt numbers are accurate', () =>
  withTempDb('owner-shift-', async () => {
    const owner = await setupOwner(),
      staff = await createStaff(owner);
    const product = (
      await request(
        '/products',
        'POST',
        { name: 'Rice', category: 'Rice & Grains', price: 100, cost: 70, opening: 20 },
        { cookie: owner }
      )
    ).body;
    const bill = {
      lines: [{ productId: product.id, qty: 2 }],
      payment: 'Cash',
      received: 250,
      requestKey: 'first-sale',
    };
    assert.equal((await request('/checkout', 'POST', bill, { cookie: staff })).status, 409);
    assert.equal(
      (await request('/shifts/open', 'POST', { opening: 1000 }, { cookie: staff })).status,
      201
    );
    const sale = await request('/checkout', 'POST', bill, { cookie: staff });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    assert.equal(sale.body.receipt, 'SM001');
    assert.equal(
      (await request('/checkout', 'POST', bill, { cookie: staff })).body.receipt,
      'SM001'
    );
    const second = await request(
      '/checkout',
      'POST',
      { ...bill, requestKey: 'second-sale', received: 200, payment: 'Card' },
      { cookie: staff }
    );
    assert.equal(second.body.receipt, 'SM002');
    const shifts = (await request('/shifts', 'GET', undefined, { cookie: staff })).body;
    assert.equal(Number(shifts.current.expected_paisa), 120000);
    assert.equal(shifts.current.bills, 2);
    assert.equal(
      (await request('/shifts/close', 'POST', { counted: 1190 }, { cookie: staff })).status,
      400
    );
    const closed = await request(
      '/shifts/close',
      'POST',
      { counted: 1190, note: 'Rs 10 cash shortage' },
      { cookie: staff }
    );
    assert.equal(closed.status, 200);
    assert.equal(Number(closed.body.variance_paisa), -1000);
    assert.equal(
      (await request('/checkout', 'POST', { ...bill, requestKey: 'third-sale' }, { cookie: staff }))
        .status,
      409
    );
    assert.equal(
      (await request('/products/' + product.id, 'DELETE', undefined, { cookie: staff })).status,
      403
    );
    const submitted = await request(
      '/products',
      'POST',
      { name: 'Tea', category: 'Tea, Coffee & Beverages', price: 80, cost: 50, opening: 999 },
      { cookie: staff }
    );
    assert.equal(submitted.status, 201);
    assert.equal(Number(submitted.body.stock_milli), 0);
  }));
test('concurrent sales get distinct sequential numbers and single approval cannot duplicate stock', () =>
  withTempDb('owner-concurrent-', async () => {
    const owner = await setupOwner(),
      vendor = await createVendor(owner);
    const p = (await request('/products', 'POST', { ...draft }, { cookie: vendor.cookie })).body;
    const s = (await request('/product-submissions', 'GET', undefined, { cookie: owner })).body
      .submissions[0];
    const reviews = await Promise.all(
      [1, 2].map(() =>
        request(
          '/product-submissions/' + s.id + '/review',
          'POST',
          { action: 'approve', verified: true, receivedQty: 20 },
          { cookie: owner }
        )
      )
    );
    assert.deepEqual(reviews.map(x => x.status).sort(), [200, 409]);
    const sales = await Promise.all(
      [1, 2, 3].map(n =>
        request(
          '/checkout',
          'POST',
          { lines: [{ productId: p.id, qty: 1 }], payment: 'Cash', requestKey: 'concurrent-' + n },
          { cookie: owner }
        )
      )
    );
    assert.ok(sales.every(x => x.status === 201));
    assert.deepEqual(sales.map(x => x.body.receipt).sort(), ['SM001', 'SM002', 'SM003']);
    assert.equal(
      Number(
        (await (await db()).query('SELECT stock_milli FROM products WHERE id=$1', [p.id])).rows[0]
          .stock_milli
      ),
      17000
    );
  }));
test('historical SM numbers are retained and the next number does not collide', () =>
  withTempDb('owner-number-', async () => {
    const owner = await setupOwner();
    await (
      await db()
    ).query(
      "INSERT INTO receipts(id,subtotal_paisa,discount_paisa,tax_paisa,total_paisa,received_paisa,payment,customer,note) VALUES('SM009',0,0,0,0,0,'Cash','Legacy','Imported')"
    );
    const p = (
      await request(
        '/products',
        'POST',
        { name: 'Bread', price: 50, opening: 3 },
        { cookie: owner }
      )
    ).body;
    const result = await request(
      '/checkout',
      'POST',
      { lines: [{ productId: p.id, qty: 1 }], payment: 'Cash' },
      { cookie: owner }
    );
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.receipt, 'SM010');
  }));
test('correction and resubmission retain the product photo without exposing it before approval', () =>
  withTempDb('owner-correction-', async () => {
    const owner = await setupOwner(),
      vendor = await createVendor(owner);
    const p = (await request('/products', 'POST', draft, { cookie: vendor.cookie })).body;
    const image = Buffer.from([255, 216, 255, 1, 2, 3]);
    await request('/products/' + p.id + '/image', 'POST', image, {
      cookie: vendor.cookie,
      raw: true,
    });
    let s = (await request('/product-submissions', 'GET', undefined, { cookie: owner })).body
      .submissions[0];
    assert.equal(
      (
        await request(
          '/product-submissions/' + s.id + '/review',
          'POST',
          { action: 'return', note: 'Change the price' },
          { cookie: owner }
        )
      ).status,
      200
    );
    await request('/products/' + p.id, 'PUT', { ...draft, price: 130 }, { cookie: vendor.cookie });
    s = (
      await request('/product-submissions', 'GET', undefined, { cookie: owner })
    ).body.submissions.find(x => x.status === 'Pending');
    assert.equal(s.has_image, true);
    assert.equal(
      (
        await request(
          '/product-submissions/' + s.id + '/review',
          'POST',
          { action: 'approve', verified: true, receivedQty: 5 },
          { cookie: owner }
        )
      ).status,
      200
    );
    assert.deepEqual((await request('/images/' + p.id)).body, image);
  }));
