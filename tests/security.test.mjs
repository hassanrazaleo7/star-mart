import test from 'node:test';
import assert from 'node:assert/strict';
import { withTempDb, request, setupOwner, createProduct } from './helpers.mjs';

test('public write endpoints are rate limited per IP and per account', async () => {
  await withTempDb('star-security-', async () => {
    let last;
    for (let i = 0; i < 11; i++)
      last = await request('/customer/signup', 'POST', { name: 'N' + i, email: `n${i}@example.com`, password: 'customerpass' });
    assert.equal(last.status, 429, JSON.stringify(last.body));
    for (let i = 0; i < 4; i++)
      last = await request('/vendor/apply', 'POST', { business: 'B', contact: 'C', phone: '03001234567', email: `v${i}@example.com`, password: 'vendorpass1' });
    assert.equal(last.status, 429);
    // A forged X-Forwarded-For does not open a new bucket when the proxy is not trusted.
    last = await request('/customer/signup', 'POST', { name: 'X', email: 'x@example.com', password: 'customerpass' }, { headers: { 'x-forwarded-for': '203.0.113.9' } });
    assert.equal(last.status, 429);
    // Owner login is capped per account even when every attempt comes from a different IP.
    await request('/setup', 'POST', { name: 'Owner', password: 'ownerpass1' }, { ip: '10.0.0.1' });
    for (let i = 0; i < 11; i++)
      last = await request('/login', 'POST', { password: 'wrong-password' }, { ip: '10.0.1.' + i });
    assert.equal(last.status, 429);
  });
});

test('current-password changes are throttled, setup enforces the password policy', async () => {
  await withTempDb('star-security2-', async () => {
    assert.equal((await request('/setup', 'POST', { name: 'Owner', password: 'short7!' })).status, 400);
    const owner = await setupOwner();
    let last;
    for (let i = 0; i < 11; i++)
      last = await request('/account/password', 'POST', { currentPassword: 'nope-nope', password: 'brand-new-pass' }, { cookie: owner });
    assert.equal(last.status, 429);
  });
});

test('origin checks fail closed and cookies gain Secure/__Host- behind TLS', async () => {
  await withTempDb('star-security3-', async () => {
    assert.equal((await request('/login', 'POST', { password: 'x' }, { headers: { origin: 'null' } })).status, 403);
    assert.equal((await request('/login', 'POST', { password: 'x' }, { headers: { origin: '::garbage' } })).status, 403);
    const owner = await setupOwner();
    const csrf = await request('/expenses', 'POST', { category: 'Rent', description: 'x', amount: '1' }, { cookie: owner, headers: { origin: 'https://evil.example' } });
    assert.equal(csrf.status, 403);
    const tls = await request('/login', 'POST', { password: 'ownerpass1' }, { headers: { 'x-forwarded-proto': 'https' } });
    assert.match(tls.headers['set-cookie'], /^__Host-sm_session=/);
    assert.match(tls.headers['set-cookie'], /Secure/);
    assert.equal(tls.headers['x-content-type-options'], 'nosniff');
    // The prefixed cookie is accepted on the next request.
    const me = await request('/me', 'GET', undefined, { cookie: tls.cookie });
    assert.equal(me.status, 200);
  });
});

test('malformed bodies and unknown routes produce 4xx, not 500', async () => {
  await withTempDb('star-security4-', async () => {
    const owner = await setupOwner();
    await createProduct(owner);
    assert.equal((await request('/checkout', 'POST', Buffer.from('null'), { cookie: owner, raw: true })).status, 400);
    assert.equal((await request('/checkout', 'POST', Buffer.from('[1,2]'), { cookie: owner, raw: true })).status, 400);
    assert.equal((await request('/checkout', 'POST', Buffer.from('{bad'), { cookie: owner, raw: true })).status, 400);
    assert.equal((await request('/nope')).status, 404);
    assert.equal((await request('/public/products', 'DELETE')).status, 405);
    const tooLarge = await request('/expenses', 'POST', Buffer.alloc(2_000_001, 32), { cookie: owner, raw: true });
    assert.equal(tooLarge.status, 413);
  });
});
