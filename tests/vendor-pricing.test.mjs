import test from 'node:test';
import assert from 'node:assert/strict';
import { withTempDb, request, setupOwner, createVendor } from './helpers.mjs';
test('supplier changes stay pending until owner approval, including unstocked product pricing', () =>
  withTempDb('star-pricing-', async () => {
    const owner = await setupOwner(),
      vendor = await createVendor(owner);
    const body = {
      name: 'Honey',
      category: 'Grocery Staples',
      price: 500,
      cost: 300,
      barcode: '111',
    };
    const created = await request('/products', 'POST', body, { cookie: vendor.cookie });
    assert.equal(created.status, 201);
    const pid = created.body.id;
    const edit = await request(
      '/products/' + pid,
      'PUT',
      { ...body, price: 550 },
      { cookie: vendor.cookie }
    );
    assert.equal(edit.status, 200);
    assert.equal(Number(edit.body.price_paisa), 50000);
    const pending = (await request('/product-submissions', 'GET', undefined, { cookie: owner }))
      .body.submissions[0];
    assert.equal(Number(pending.payload.price), 550);
    assert.equal(
      (
        await request(
          '/product-submissions/' + pending.id + '/review',
          'POST',
          { action: 'approve', verified: true, receivedQty: 5, paid: 1500 },
          { cookie: vendor.cookie }
        )
      ).status,
      403
    );
    assert.equal(
      (
        await request(
          '/product-submissions/' + pending.id + '/review',
          'POST',
          { action: 'approve', verified: true, receivedQty: 5, paid: 1500 },
          { cookie: owner }
        )
      ).status,
      200
    );
    const changed = await request(
      '/products/' + pid,
      'PUT',
      { ...body, name: 'Cheap honey', price: 1, cost: 0, barcode: '222', unit: 'kg', brand: 'Bee' },
      { cookie: vendor.cookie }
    );
    assert.equal(changed.status, 200);
    assert.equal(Number(changed.body.price_paisa), 55000);
    assert.equal(changed.body.name, 'Honey');
    assert.equal(changed.body.barcode, '111');
    assert.equal(changed.body.brand, '');
    const next = (
      await request('/product-submissions', 'GET', undefined, { cookie: owner })
    ).body.submissions.find(x => x.status === 'Pending');
    assert.equal(
      (
        await request(
          '/product-submissions/' + next.id + '/review',
          'POST',
          { action: 'return', note: 'Keep the correct barcode' },
          { cookie: owner }
        )
      ).status,
      200
    );
  }));
