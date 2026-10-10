import test from 'node:test';
import assert from 'node:assert/strict';
import { withTempDb, request, setupOwner } from './helpers.mjs';

test('store settings round-trip, validate links and bump the live version', async () => {
  await withTempDb('star-settings-', async () => {
    const owner = await setupOwner();
    const before = (await request('/live/version')).body.version;
    assert.equal(
      (
        await request(
          '/admin/settings',
          'POST',
          { communityUrl: 'https://evil.example/x' },
          { cookie: owner }
        )
      ).status,
      400
    );
    assert.equal(
      (await request('/admin/settings', 'POST', { whatsapp: 'abc' }, { cookie: owner })).status,
      400
    );
    const saved = await request(
      '/admin/settings',
      'POST',
      {
        whatsapp: '03001234567',
        phone: '0421234567',
        address: 'Lahore',
        communityUrl: 'https://chat.whatsapp.com/abc',
        jazzcash: '03001234567',
      },
      { cookie: owner }
    );
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const pub = await request('/public/settings');
    assert.equal(pub.body.whatsapp, '03001234567');
    assert.equal(pub.body.communityUrl, 'https://chat.whatsapp.com/abc');
    assert.notEqual((await request('/live/version')).body.version, before);
    assert.equal((await request('/admin/settings', 'POST', { address: 'x' })).status, 401);
  });
});
