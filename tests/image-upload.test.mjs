import test from 'node:test';
import assert from 'node:assert/strict';
import { withTempDb, request, setupOwner, createProduct, createVendor, pngOf } from './helpers.mjs';

test('image uploads enforce size, type, dimensions and ownership', async () => {
  await withTempDb('star-images-', async () => {
    const owner = await setupOwner();
    const product = await createProduct(owner);
    const upload = (id, data, cookie = owner) => request('/products/' + id + '/image', 'POST', data, { cookie, raw: true });
    const huge = Buffer.alloc(1_000_001, 0);
    Buffer.from([255, 216, 255]).copy(huge, 0);
    assert.equal((await upload(product.id, huge)).status, 413);
    assert.equal((await upload(product.id, Buffer.from('GIF89a......'))).status, 400);
    assert.equal((await upload(product.id, pngOf(9000, 100))).status, 400);
    const png = pngOf(10, 10);
    assert.equal((await upload(product.id, png)).status, 200);
    const served = await request('/images/' + product.id);
    assert.equal(served.headers['content-type'], 'image/png');
    assert.deepEqual(served.body, png);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]);
    assert.equal((await upload(product.id, webp)).status, 200);
    assert.equal((await request('/images/' + product.id)).headers['content-type'], 'image/webp');
    const vendor = await createVendor(owner);
    assert.equal((await upload(product.id, png, vendor.cookie)).status, 404);
    const own = await request('/products', 'POST', { name: 'Own', category: 'Grocery Staples', price: '10' }, { cookie: vendor.cookie });
    assert.equal((await upload(own.body.id, png, vendor.cookie)).status, 200);
  });
});
