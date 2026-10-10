import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handle } from '../server/api.mjs';
import { close } from '../server/db.mjs';
async function call(path, method = 'GET', payload, cookie = '') {
  const data = payload ? Buffer.from(JSON.stringify(payload)) : Buffer.alloc(0),
    req = Readable.from(data.length ? [data] : []);
  req.url = '/api' + path;
  req.method = method;
  req.headers = { cookie, host: 'localhost:8787' };
  let status,
    headers,
    output = '';
  await handle(req, {
    writeHead(s, h) {
      status = s;
      headers = h;
    },
    end(x) {
      output += x || '';
    },
  });
  return { status, headers, body: JSON.parse(output) };
}
test('linked POS bills, partial credit, full settlement and points redemption stay consistent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'star-loyalty-'));
  process.env.STAR_MART_DATA_DIR = dir;
  try {
    const a = await call('/customer/signup', 'POST', {
      name: 'Ayesha',
      email: 'ayesha@example.com',
      password: 'securepass123',
    });
    const b = await call('/customer/signup', 'POST', {
      name: 'Bilal',
      email: 'bilal@example.com',
      password: 'securepass123',
    });
    const customer = a.body.user.id,
      cookie = a.headers['set-cookie'].split(';')[0];
    await call('/setup', 'POST', { name: 'Owner', password: 'secret123' });
    const admin = (await call('/login', 'POST', { password: 'secret123' })).headers[
      'set-cookie'
    ].split(';')[0];
    const product = await call(
      '/products',
      'POST',
      { name: 'Rice', category: 'Rice & Grains', opening: 10, price: 250, cost: 180 },
      admin
    );
    assert.equal(product.status, 201, JSON.stringify(product.body));
    const pid = product.body.id;
    assert.equal(
      (
        await call(
          '/checkout',
          'POST',
          { lines: [{ productId: pid, qty: 1 }], payment: 'Credit' },
          admin
        )
      ).status,
      400
    );
    const cash = await call(
      '/checkout',
      'POST',
      { lines: [{ productId: pid, qty: 1 }], payment: 'Cash', customerId: customer },
      admin
    );
    assert.equal(cash.status, 201, JSON.stringify(cash.body));
    let overview = await call('/customer/overview', 'GET', null, cookie);
    assert.equal(overview.body.summary.points, 2);
    assert.equal(overview.body.summary.totalSpendPaisa, 25000);
    assert.equal(overview.body.summary.outstandingPaisa, 0);
    assert.equal(
      (await call('/customer/overview', 'GET', null, b.headers['set-cookie'].split(';')[0])).body
        .bills.length,
      0
    );
    const credit = await call(
      '/checkout',
      'POST',
      {
        lines: [{ productId: pid, qty: 2 }],
        payment: 'Credit',
        customerId: customer,
        received: 100,
      },
      admin
    );
    assert.equal(credit.status, 201, JSON.stringify(credit.body));
    overview = await call('/customer/overview', 'GET', null, cookie);
    assert.equal(overview.body.summary.outstandingPaisa, 40000);
    assert.equal(overview.body.summary.points, 2);
    assert.equal(
      (
        await call(
          '/customers/credit-payment',
          'POST',
          { customerId: customer, receiptId: credit.body.receipt, amount: 500, method: 'Cash' },
          admin
        )
      ).status,
      400
    );
    const part = await call(
      '/customers/credit-payment',
      'POST',
      { customerId: customer, receiptId: credit.body.receipt, amount: 150, method: 'Cash' },
      admin
    );
    assert.equal(part.body.remainingPaisa, 25000);
    assert.equal((await call('/customer/overview', 'GET', null, cookie)).body.summary.points, 2);
    const last = await call(
      '/customers/credit-payment',
      'POST',
      {
        customerId: customer,
        receiptId: credit.body.receipt,
        amount: 250,
        method: 'Bank transfer',
      },
      admin
    );
    assert.equal(last.body.remainingPaisa, 0);
    overview = await call('/customer/overview', 'GET', null, cookie);
    assert.equal(overview.body.summary.points, 7);
    assert.equal(overview.body.summary.outstandingPaisa, 0);
    // Earn enough points, then redeem in exact blocks. Repeated redemption fails.
    const more = await call(
      '/products',
      'POST',
      { name: 'Monthly groceries', category: 'Other', opening: 3, price: 10000, cost: 7000 },
      admin
    );
    assert.equal(
      (
        await call(
          '/checkout',
          'POST',
          { lines: [{ productId: more.body.id, qty: 1 }], payment: 'Cash', customerId: customer },
          admin
        )
      ).status,
      201
    );
    const reward = await call(
      '/checkout',
      'POST',
      {
        lines: [{ productId: more.body.id, qty: 1 }],
        payment: 'Cash',
        customerId: customer,
        redeemPoints: 100,
      },
      admin
    );
    assert.equal(reward.status, 201, JSON.stringify(reward.body));
    assert.equal(reward.body.total, 995000);
    overview = await call('/customer/overview', 'GET', null, cookie);
    assert.equal(overview.body.summary.points, 106);
    assert.equal(
      (
        await call(
          '/checkout',
          'POST',
          {
            lines: [{ productId: pid, qty: 1 }],
            payment: 'Cash',
            customerId: customer,
            redeemPoints: 100,
          },
          admin
        )
      ).status,
      400
    );
    const online = await call(
      '/customer/orders',
      'POST',
      { lines: [{ productId: pid, qty: 1 }], fulfillment: 'Pickup', phone: '03001234567' },
      cookie
    );
    assert.equal(online.status, 201, JSON.stringify(online.body));
    assert.equal((await call('/customer/overview', 'GET', null, cookie)).body.summary.points, 106);
    assert.equal(
      (
        await call(
          '/orders/' + online.body.id + '/Fulfilled',
          'POST',
          { paymentCollected: true },
          admin
        )
      ).status,
      200
    );
    overview = await call('/customer/overview', 'GET', null, cookie);
    assert.equal(overview.body.summary.points, 108);
    assert.equal(overview.body.orders[0].status, 'Fulfilled');
  } finally {
    await close();
    await rm(dir, { recursive: true, force: true });
  }
});
