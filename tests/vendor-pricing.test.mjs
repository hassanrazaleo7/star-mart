import test from 'node:test';
import assert from 'node:assert/strict';
import { withTempDb, request, setupOwner, createVendor } from './helpers.mjs';

test('vendors cannot reprice stocked products; the owner reviews proposed prices', async () => {
  await withTempDb('star-pricing-', async () => {
    const owner = await setupOwner();
    const vendor = await createVendor(owner);
    const created = await request('/products', 'POST', { name: 'Honey', category: 'Grocery Staples', price: '500', cost: '300', barcode: '111' }, { cookie: vendor.cookie });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const pid = created.body.id;
    // Not stocked yet: the vendor may still change the price.
    let edited = await request('/products/' + pid, 'PUT', { name: 'Honey', category: 'Grocery Staples', price: '550', cost: '300', barcode: '111' }, { cookie: vendor.cookie });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(Number(edited.body.price_paisa), 55000);
    await request('/purchases', 'POST', { productId: pid, vendorId: vendor.vendorId, qty: 5, cost: '300', payment: 'Paid' }, { cookie: owner });
    edited = await request('/products/' + pid, 'PUT', { name: 'Cheap honey', category: 'Grocery Staples', price: '1', cost: '0', barcode: '222', unit: 'kg', brand: 'Bee' }, { cookie: vendor.cookie });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(Number(edited.body.price_paisa), 55000);
    assert.equal(Number(edited.body.cost_paisa), 30000);
    assert.equal(edited.body.name, 'Honey');
    assert.equal(edited.body.barcode, '111');
    assert.equal(edited.body.unit, 'piece');
    assert.equal(edited.body.brand, 'Bee');
    assert.equal(Number(edited.body.vendor_proposed_price_paisa), 100);
    assert.equal((await request('/products/' + pid + '/price-review', 'POST', { accept: true }, { cookie: vendor.cookie })).status, 403);
    const reviewed = await request('/products/' + pid + '/price-review', 'POST', { accept: true }, { cookie: owner });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    assert.equal(Number(reviewed.body.price_paisa), 100);
    assert.equal(reviewed.body.vendor_proposed_price_paisa, null);
  });
});
