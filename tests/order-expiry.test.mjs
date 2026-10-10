import test from 'node:test';
import assert from 'node:assert/strict';
import { withTempDb } from './helpers.mjs';
import { db, init, tx } from '../server/db.mjs';
import { placeOrder, changeOrder, publicProducts } from '../server/orders.mjs';
import { sweep } from '../server/sweeper.mjs';

const stock = async () => Number((await publicProducts())[0].stock_milli);

test('guest inquiries never reserve stock; confirmed and expired orders release correctly', async () => {
  await withTempDb('star-expiry-', async () => {
    await init();
    const c = await db();
    await c.query(
      "INSERT INTO products(id,name,price_paisa,cost_paisa) VALUES('p1','Rice',12500,8000)"
    );
    await c.query(
      "INSERT INTO stock_movements(id,product_id,qty_milli,kind) VALUES('m1','p1',3000,'opening')"
    );
    const guest = { id: 'guest-abc', name: 'Walk In', phone: '03001234567', email: '' };
    const inquiry = await placeOrder(guest, {
      lines: [{ productId: 'p1', qty: 2 }],
      fulfillment: 'Pickup',
    });
    assert.equal(inquiry.status, 'Inquiry');
    assert.ok(inquiry.expiresAt);
    assert.equal(await stock(), 3000);
    await assert.rejects(
      () => placeOrder(guest, { lines: [{ productId: 'p1', qty: 11 }], fulfillment: 'Pickup' }),
      /up to 10 units/
    );
    await assert.rejects(
      () => changeOrder(inquiry.id, 'Fulfilled', { paymentCollected: true }),
      /Confirm/
    );
    const confirmed = await changeOrder(inquiry.id, 'Confirm');
    assert.equal(confirmed.status, 'Pending');
    assert.equal(await stock(), 1000);
    const extended = await changeOrder(inquiry.id, 'Extend');
    assert.ok(new Date(extended.expiresAt) > new Date(confirmed.expiresAt));
    await c.query("UPDATE customer_orders SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1", [
      inquiry.id,
    ]);
    const result = await tx(sweep);
    assert.deepEqual(result.expiredOrders, [inquiry.id]);
    assert.equal(
      (await c.query('SELECT status FROM customer_orders WHERE id=$1', [inquiry.id])).rows[0]
        .status,
      'Cancelled'
    );
    assert.equal(await stock(), 3000);
  });
});

test('a customer cannot hold more than the allowed number of open orders', async () => {
  await withTempDb('star-expiry2-', async () => {
    await init();
    const c = await db();
    await c.query(
      "INSERT INTO products(id,name,price_paisa,cost_paisa) VALUES('p1','Rice',12500,8000)"
    );
    await c.query(
      "INSERT INTO stock_movements(id,product_id,qty_milli,kind) VALUES('m1','p1',9000,'opening')"
    );
    const customer = { id: 'cust-1', name: 'Ayesha', phone: '03001234567', email: 'a@example.com' };
    for (let i = 0; i < 3; i++)
      await placeOrder(customer, { lines: [{ productId: 'p1', qty: 1 }], fulfillment: 'Pickup' });
    await assert.rejects(
      () => placeOrder(customer, { lines: [{ productId: 'p1', qty: 1 }], fulfillment: 'Pickup' }),
      /open orders/
    );
    assert.equal(await stock(), 6000);
  });
});
