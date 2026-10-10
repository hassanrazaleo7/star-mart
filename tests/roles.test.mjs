import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handle } from '../server/api.mjs';
import { close } from '../server/db.mjs';
async function call(path, method = 'GET', payload, cookie = '', raw = false) {
  let bytes = raw ? payload : payload ? Buffer.from(JSON.stringify(payload)) : Buffer.alloc(0),
    req = Readable.from(bytes.length ? [bytes] : []);
  req.url = '/api' + path;
  req.method = method;
  req.headers = { cookie, host: 'localhost:8787' };
  let status,
    headers,
    chunks = [];
  let res = {
    writeHead(code, h) {
      status = code;
      headers = h;
    },
    end(data) {
      if (data) chunks.push(Buffer.from(data));
    },
  };
  await handle(req, res);
  let output = Buffer.concat(chunks);
  return {
    status,
    headers,
    body: headers?.['content-type']?.includes('application/json')
      ? JSON.parse(output.toString())
      : output,
  };
}
test('vendor sees only own inventory, staff can bill, image upload persists', async () => {
  let dir = await mkdtemp(join(tmpdir(), 'star-mart-roles-'));
  process.env.STAR_MART_DATA_DIR = dir;
  try {
    assert.equal(
      (await call('/setup', 'POST', { name: 'Owner', password: 'ownerpass1' })).status,
      201
    );
    let owner = (await call('/login', 'POST', { password: 'ownerpass1' })).headers[
        'set-cookie'
      ].split(';')[0],
      ownerCall = (p, m = 'GET', v) => call(p, m, v, owner);
    let application = await call('/vendor/apply', 'POST', {
      business: 'One',
      contact: 'Vendor One',
      phone: '03001234567',
      email: 'v@example.com',
      password: 'secretpass',
    });
    let v1 = (await ownerCall('/vendor/applications/' + application.body.id + '/approve', 'POST'))
        .body.vendorId,
      v2 = (await ownerCall('/vendors', 'POST', { name: 'Two' })).body.id;
    let p1 = (
      await ownerCall('/products', 'POST', {
        name: 'Apple',
        category: 'Fruits',
        vendorId: v1,
        opening: 5,
        price: 20,
      })
    ).body.id;
    await ownerCall('/products', 'POST', {
      name: 'Rice',
      category: 'Rice & Grains',
      vendorId: v2,
      opening: 5,
      price: 30,
    });
    let picture = Buffer.from([255, 216, 255, 1, 2, 3]);
    assert.equal(
      (await call('/products/' + p1 + '/image', 'POST', picture, owner, true)).status,
      200
    );
    assert.deepEqual((await call('/images/' + p1)).body, picture);
    assert.equal(
      (
        await ownerCall('/accounts', 'POST', {
          name: 'Another Vendor',
          email: 'other@example.com',
          password: 'secretpass',
          role: 'vendor',
          vendorId: v1,
        })
      ).status,
      400
    );
    assert.equal(
      (
        await ownerCall('/accounts', 'POST', {
          name: 'Cashier',
          email: 's@example.com',
          password: 'secretpass',
          role: 'staff',
        })
      ).status,
      201
    );
    let vendor = (
      await call('/account/login', 'POST', { email: 'v@example.com', password: 'secretpass' })
    ).headers['set-cookie'].split(';')[0];
    let state = await call('/vendor/overview', 'GET', null, vendor);
    assert.equal(state.body.products.length, 1);
    assert.equal(state.body.products[0].name, 'Apple');
    assert.equal(state.body.products[0].vendor_id, v1);
    assert.equal(
      (await call('/products/' + p1 + '/image', 'POST', picture, vendor, true)).status,
      200
    );
    assert.equal((await call('/orders', 'GET', null, vendor)).status, 403);
    assert.equal(
      (await call('/checkout', 'POST', { lines: [{ productId: p1, qty: 1 }] }, vendor)).status,
      403
    );
    assert.equal((await call('/accounts', 'GET', null, vendor)).status, 403);
    let staff = (
      await call('/account/login', 'POST', { email: 's@example.com', password: 'secretpass' })
    ).headers['set-cookie'].split(';')[0];
    assert.equal((await call('/products', 'POST', { name: 'Forbidden' }, staff)).status, 403);
    assert.equal(
      (
        await call(
          '/checkout',
          'POST',
          { lines: [{ productId: p1, qty: 1 }], payment: 'Cash' },
          staff
        )
      ).status,
      201
    );
    let publicState = await call('/public/products');
    assert.equal(publicState.body.products.find(p => p.id === p1).image, '/api/images/' + p1);
    const categories = (await call('/public/categories')).body;
    assert.ok(categories.categories.includes('Grocery Staples'));
    assert.ok(categories.taxonomy.some(t => t.name === 'Grocery Staples'));
  } finally {
    await close();
    await rm(dir, { recursive: true, force: true });
  }
});
