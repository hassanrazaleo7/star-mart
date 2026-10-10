import test from 'node:test';
import assert from 'node:assert/strict';
import { withTempDb, request, setupOwner, createProduct, createCustomer, createStaff } from './helpers.mjs';
import { db } from '../server/db.mjs';

async function assertInvariant() {
  const c = await db();
  const rows = (
    await c.query(
      "SELECT p.id,p.stock_milli,p.reserved_milli,COALESCE((SELECT SUM(qty_milli) FROM stock_movements m WHERE m.product_id=p.id),0) ledger,COALESCE((SELECT SUM(i.qty_milli) FROM customer_order_items i JOIN customer_orders o ON o.id=i.order_id WHERE o.status='Pending' AND i.product_id=p.id),0) held FROM products p"
    )
  ).rows;
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.equal(Number(r.stock_milli), Number(r.ledger), 'stock drift on ' + r.id);
    assert.equal(Number(r.reserved_milli), Number(r.held), 'reservation drift on ' + r.id);
  }
}

test('materialized stock always equals the movement ledger and pending reservations', async () => {
  await withTempDb('star-invariant-', async () => {
    const owner = await setupOwner();
    const staff = await createStaff(owner);
    const customer = await createCustomer();
    const a = await createProduct(owner, { name: 'A', opening: 10 });
    const b = await createProduct(owner, { name: 'B', opening: 3, sku: 'B-1' });
    await request('/purchases', 'POST', { productId: a.id, qty: 5, cost: '100' }, { cookie: owner });
    await assertInvariant();
    const order = await request('/customer/orders', 'POST', { lines: [{ productId: a.id, qty: 2 }, { productId: b.id, qty: 1 }], fulfillment: 'Pickup', phone: '03001234567' }, { cookie: customer.cookie });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    await assertInvariant();
    assert.equal((await request('/checkout', 'POST', { lines: [{ productId: b.id, qty: 3 }], payment: 'Cash' }, { cookie: staff })).status, 400);
    assert.equal((await request('/checkout', 'POST', { lines: [{ productId: b.id, qty: 2 }], payment: 'Cash' }, { cookie: staff })).status, 201);
    await assertInvariant();
    await request('/adjustments', 'POST', { productId: a.id, change: -1, reason: 'Damaged', note: 'Dropped' }, { cookie: owner });
    await assertInvariant();
    const second = await request('/customer/orders', 'POST', { lines: [{ productId: a.id, qty: 1 }], fulfillment: 'Pickup', phone: '03001234567' }, { cookie: customer.cookie });
    await request('/orders/' + second.body.id + '/Cancelled', 'POST', {}, { cookie: owner });
    await assertInvariant();
    const done = await request('/orders/' + order.body.id + '/ClosePickup', 'POST', { paymentMethod: 'Cash on pickup', received: '800', paymentCollected: true }, { cookie: staff });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.receipt.received, 80000);
    await assertInvariant();
    const c = await db();
    const receipt = (await c.query('SELECT * FROM receipts WHERE order_id=$1', [order.body.id])).rows[0];
    assert.equal(Number(receipt.received_paisa), 80000);
    const overview = await request('/customer/overview', 'GET', undefined, { cookie: customer.cookie });
    assert.equal(overview.body.orders.find(o => o.id === order.body.id).receipt_id, receipt.id);
    assert.equal(overview.body.bills[0].orderId, order.body.id);
    const stateA = (await request('/state', 'GET', undefined, { cookie: owner })).body.products.find(p => p.id === a.id);
    assert.equal(Number(stateA.stock_milli), 12000);
    assert.equal(Number(stateA.reserved_milli), 0);
  });
});
