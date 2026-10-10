import { route, ok, raw } from '../router.mjs';
import { db, tx } from '../db.mjs';
import { clearCookies } from '../auth.mjs';
import { fail } from '../errors.mjs';
import { str, PHONE } from '../validate.mjs';
import { changePassword } from '../account-security.mjs';
import { placeOrder, customerOrders } from '../orders.mjs';
import { customerOverview } from '../customer-ledger.mjs';
import { closeSessions } from '../sessions.mjs';

route(
  'POST',
  '/customer/password',
  {
    auth: 'customerLinked',
    body: 'json',
    limit: { scope: 'password-change', byUser: true, max: 10 },
  },
  async ({ req, customer, body: b }) =>
    ok(await changePassword({ ...customer, role: 'customer' }, b), 200, {
      'set-cookie': clearCookies(req, 'customer'),
    })
);
route('GET', '/customer/preferences', { auth: 'customer' }, async ({ customer }) => {
  if (!customer.linked) return ok({ preference: null });
  const preference =
    (
      await (
        await db()
      ).query(
        'SELECT fulfillment,phone,address FROM customer_shopping_preferences WHERE customer_id=$1',
        [customer.id]
      )
    ).rows[0] || null;
  return ok({ preference });
});
route(
  'POST',
  '/customer/preferences',
  { auth: 'customerLinked', body: 'json', tx: true },
  async ({ customer, body: b, c }) => {
    const fulfillment = str(b.fulfillment),
      phone = str(b.phone, 30),
      address = str(b.address, 500);
    if (!['Delivery', 'Pickup'].includes(fulfillment)) throw fail('Choose Delivery or Self Pickup');
    if ((!b.modeOnly || phone) && !PHONE.test(phone)) throw fail('Enter a valid contact number');
    if (!b.modeOnly && fulfillment === 'Delivery' && !address)
      throw fail('Enter your delivery address');
    await c.query(
      'INSERT INTO customer_shopping_preferences(customer_id,fulfillment,phone,address) VALUES($1,$2,$3,$4) ON CONFLICT(customer_id) DO UPDATE SET fulfillment=EXCLUDED.fulfillment,phone=EXCLUDED.phone,address=EXCLUDED.address,updated_at=NOW()',
      [customer.id, fulfillment, phone, address]
    );
    if (phone)
      await c.query('UPDATE customer_accounts SET phone=$1 WHERE id=$2', [phone, customer.id]);
    return ok({ preference: { fulfillment, phone, address } });
  }
);
route(
  'POST',
  '/customer/avatar',
  { auth: 'customerLinked', body: 'image', tx: true },
  async ({ customer, image, c }) => {
    await c.query(
      'INSERT INTO customer_avatars(customer_id,data,mime) VALUES($1,$2,$3) ON CONFLICT(customer_id) DO UPDATE SET data=EXCLUDED.data,mime=EXCLUDED.mime,updated_at=NOW()',
      [customer.id, image.data, image.mime]
    );
    return ok({ image: '/api/customer/avatar?v=' + Date.now() });
  }
);
route('GET', '/customer/avatar', { auth: 'customerLinked' }, async ({ customer }) => {
  const row = (
    await (
      await db()
    ).query('SELECT data,mime FROM customer_avatars WHERE customer_id=$1', [customer.id])
  ).rows[0];
  if (!row) throw fail('Profile picture not found', 404);
  return raw(
    200,
    {
      'content-type': row.mime,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
    Buffer.from(row.data)
  );
});
route('GET', '/customer/me', { auth: 'customer' }, async ({ customer }) => {
  const avatar = customer.linked
    ? (
        await (
          await db()
        ).query('SELECT updated_at FROM customer_avatars WHERE customer_id=$1', [customer.id])
      ).rows[0]
    : null;
  return ok({
    user: {
      ...customer,
      avatar: avatar ? '/api/customer/avatar?v=' + new Date(avatar.updated_at).getTime() : null,
    },
  });
});
route('POST', '/customer/logout', { auth: 'public' }, async ({ req }) => {
  await closeSessions(req, 'customer');
  return ok({ ok: true }, 200, { 'set-cookie': clearCookies(req, 'customer') });
});
route('GET', '/customer/overview', { auth: 'customerLinked' }, async ({ customer }) =>
  ok(await customerOverview(customer.id))
);
route('GET', '/customer/orders', { auth: 'customer' }, async ({ customer }) =>
  ok({ orders: await customerOrders(customer) })
);
route(
  'POST',
  '/customer/orders',
  {
    auth: 'customer',
    body: 'json',
    limit: { scope: 'order', byUser: true, max: 10, windowMinutes: 60 },
  },
  async ({ customer, body: b }) => ok(await placeOrder(customer, b), 201)
);
export { tx };
