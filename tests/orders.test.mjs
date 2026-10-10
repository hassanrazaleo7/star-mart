import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, init, close } from '../server/db.mjs';
import { placeOrder, changeOrder, publicProducts, customerOrders } from '../server/orders.mjs';
test('customer order reserves stock, cancellation releases, fulfillment writes sale once', async () => {
  let dir = await mkdtemp(join(tmpdir(), 'star-mart-orders-'));
  process.env.STAR_MART_DATA_DIR = dir;
  try {
    await init();
    let c = await db();
    await c.query(
      "INSERT INTO products(id,name,price_paisa,cost_paisa) VALUES('p1','Rice',12500,8000)"
    );
    await c.query(
      "INSERT INTO stock_movements(id,product_id,qty_milli,kind) VALUES('m1','p1',3000,'opening')"
    );
    let customer = {
      id: 'firebase-uid-1',
      email: 'hassan@example.com',
      phone: '+923001234567',
      name: 'Hassan',
    };
    let placed = await placeOrder(customer, {
      lines: [{ productId: 'p1', qty: 2 }],
      fulfillment: 'Pickup',
    });
    assert.equal(placed.total, 25000);
    assert.equal(Number((await publicProducts())[0].stock_milli), 1000);
    await assert.rejects(
      () => placeOrder(customer, { lines: [{ productId: 'p1', qty: 2 }], fulfillment: 'Pickup' }),
      /only 1 available/
    );
    let mine = await customerOrders(customer);
    assert.equal(mine.length, 1);
    await changeOrder(placed.id, 'Cancelled');
    assert.equal(Number((await publicProducts())[0].stock_milli), 3000);
    let next = await placeOrder(customer, {
      lines: [{ productId: 'p1', qty: 2 }],
      fulfillment: 'Pickup',
    });
    await assert.rejects(() => changeOrder(next.id, 'Fulfilled', {}), /Confirm payment/);
    await changeOrder(next.id, 'Fulfilled', { paymentCollected: true });
    assert.equal(Number((await publicProducts())[0].stock_milli), 1000);
    let sales = (await c.query('SELECT * FROM sales')).rows,
      receipts = (await c.query('SELECT * FROM receipts')).rows;
    assert.equal(sales.length, 1);
    assert.equal(receipts.length, 1);
    assert.equal(Number(receipts[0].total_paisa), 25000);
    await assert.rejects(
      () => changeOrder(next.id, 'Fulfilled', { paymentCollected: true }),
      /Only pending/
    );
  } finally {
    await close();
    await rm(dir, { recursive: true, force: true });
  }
});
