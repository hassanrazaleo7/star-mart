import { route, ok } from '../router.mjs';
import { db, tx } from '../db.mjs';
import { id, passwordHashAsync, checkPassword, clearCookies } from '../auth.mjs';
import { fail } from '../errors.mjs';
import { str, required, email as emailOf } from '../validate.mjs';
import { paisa } from '../money.mjs';
import { saveSettings } from '../store-settings.mjs';
import { changePassword, resetQueue, issueReset } from '../account-security.mjs';
import { listCustomers, collectCredit, customerOverview } from '../customer-ledger.mjs';
import { firebaseIdentity } from '../customer-auth.mjs';
import { closeSessions } from '../sessions.mjs';
import { state, reportRange } from '../state.mjs';
import { cleanupSamples } from '../sample-cleanup.mjs';
import { activityFeed } from '../activity.mjs';
import { dailySales } from '../daily-sales.mjs';
import { sweepIfDue } from '../sweeper.mjs';
import { vendorLedger, returnToVendor, outstandingBalance } from '../vendor-ledger.mjs';
import { allOrders, changeOrder } from '../orders.mjs';
import { catalogAction, setStock } from '../catalog-actions.mjs';
import { importCatalogBatch } from '../bulk-import.mjs';
import { importLegacy } from '../import.mjs';
import { saveProduct, reviewProposedPrice, storeImage } from '../catalog.mjs';
import { checkout, addPurchase, addAdjustment } from '../checkout.mjs';
import { GROCERY_CATEGORIES, GROCERY_TAXONOMY } from '../../src/grocery-categories.mjs';

const HEX = '([a-f0-9]+)';

route(
  'POST',
  '/admin/settings',
  { auth: 'owner', body: 'json', tx: true },
  async ({ body: b, c }) => ok(await saveSettings(c, b))
);
route(
  'POST',
  '/account/password',
  { auth: 'session', body: 'json', limit: { scope: 'password-change', byUser: true, max: 10 } },
  async ({ req, user, body: b }) =>
    ok(await changePassword(user, b), 200, { 'set-cookie': clearCookies(req, 'store') })
);
route('GET', '/admin/password-requests', { auth: 'owner' }, async () =>
  ok({ requests: await resetQueue() })
);
route(
  'POST',
  new RegExp(`^/admin/password-requests/${HEX}/issue$`),
  { auth: 'owner' },
  async ({ params }) => ok(await issueReset(params[0]), 201)
);
route('GET', '/customers', { auth: 'worker' }, async ({ query }) =>
  ok({
    customers: await listCustomers({ search: query.get('q') || '', limit: query.get('limit') }),
  })
);
route('POST', '/customers/credit-payment', { auth: 'worker', body: 'json' }, async ({ body: b }) =>
  ok(await collectCredit(b), 201)
);
route('GET', new RegExp(`^/customers/${HEX}/overview$`), { auth: 'worker' }, async ({ params }) =>
  ok(await customerOverview(params[0]))
);
route(
  'POST',
  '/admin/link',
  { auth: 'owner', limit: { scope: 'admin-firebase', max: 10 } },
  async ({ req, user }) => {
    const identity = await firebaseIdentity(req);
    await tx(c =>
      c.query(
        'INSERT INTO admin_identities(uid,user_id) VALUES($1,$2) ON CONFLICT(uid) DO NOTHING',
        [identity.id, user.id]
      )
    );
    return ok({ linked: true, provider: identity.email || identity.phone });
  }
);
route('POST', '/logout', { auth: 'public' }, async ({ req }) => {
  await closeSessions(req, 'store');
  return ok({ ok: true }, 200, { 'set-cookie': clearCookies(req, 'store') });
});
route('GET', '/me', { auth: 'session' }, async ({ user }) => ok({ user }));
route('GET', '/state', { auth: 'session' }, async ({ user, query }) =>
  ok(await state(user, { from: query.get('from') }))
);
route('GET', '/reports/range', { auth: 'owner' }, async ({ query }) =>
  ok(await reportRange(query.get('from'), query.get('to')))
);
route(['GET', 'POST'], '/admin/sample-cleanup', { auth: 'owner' }, async ({ method }) =>
  ok(await cleanupSamples(method === 'POST'))
);
route('GET', '/admin/activity', { auth: 'owner' }, async ({ query }) =>
  ok({ events: await activityFeed(query.get('limit') || 150) })
);
route('POST', '/admin/sweep', { auth: 'owner' }, async () =>
  ok({ result: await sweepIfDue(true) })
);
route('GET', '/reports/daily-sales', { auth: 'owner' }, async ({ query }) =>
  ok(await dailySales(query.get('date') || ''))
);

route('GET', '/vendor/overview', { auth: 'vendor' }, async ({ user }) => {
  const d = await db(),
    v = user.vendor_id;
  const [vendor, products, purchases, sales, movements, payments, demand] = await Promise.all([
    d.query('SELECT id,name,contact,phone,email,address,terms,tax_id FROM vendors WHERE id=$1', [
      v,
    ]),
    d.query('SELECT * FROM products WHERE vendor_id=$1 AND deleted_at IS NULL ORDER BY name', [v]),
    d.query('SELECT * FROM purchases WHERE vendor_id=$1 ORDER BY created_at DESC LIMIT 2000', [v]),
    d.query(
      'SELECT s.id,s.receipt,s.product_id,s.qty_milli,s.unit_price_paisa,s.line_total_paisa,s.cost_at_sale_paisa,s.payment,s.created_at FROM sales s JOIN products p ON p.id=s.product_id WHERE p.vendor_id=$1 ORDER BY s.created_at DESC LIMIT 2000',
      [v]
    ),
    d.query(
      'SELECT m.* FROM stock_movements m JOIN products p ON p.id=m.product_id WHERE p.vendor_id=$1 ORDER BY m.created_at DESC LIMIT 2000',
      [v]
    ),
    d.query(
      'SELECT * FROM vendor_payments WHERE vendor_id=$1 ORDER BY created_at DESC LIMIT 2000',
      [v]
    ),
    d.query(
      'SELECT o.id,o.status,o.created_at,o.fulfillment,i.product_id,i.qty_milli,i.line_total_paisa FROM customer_orders o JOIN customer_order_items i ON i.order_id=o.id JOIN products p ON p.id=i.product_id WHERE p.vendor_id=$1 ORDER BY o.created_at DESC LIMIT 500',
      [v]
    ),
  ]);
  return ok({
    vendor: vendor.rows[0],
    products: products.rows,
    purchases: purchases.rows,
    sales: sales.rows,
    movements: movements.rows,
    payments: payments.rows,
    demand: demand.rows,
    ledger: await vendorLedger(v),
  });
});
// Full supplier account for the owner's vendor workspace (history is not limited by the /state window).
route('GET', new RegExp(`^/vendors/${HEX}/account$`), { auth: 'owner' }, async ({ params }) => {
  const d = await db(),
    v = params[0];
  const vendor = (await d.query('SELECT * FROM vendors WHERE id=$1', [v])).rows[0];
  if (!vendor) throw fail('Vendor not found', 404);
  const [purchases, payments, returns, sales] = await Promise.all([
    d.query('SELECT * FROM purchases WHERE vendor_id=$1 ORDER BY created_at DESC LIMIT 2000', [v]),
    d.query(
      'SELECT * FROM vendor_payments WHERE vendor_id=$1 ORDER BY created_at DESC LIMIT 2000',
      [v]
    ),
    d.query('SELECT * FROM vendor_returns WHERE vendor_id=$1 ORDER BY created_at DESC LIMIT 2000', [
      v,
    ]),
    d.query(
      'SELECT s.id,s.receipt,s.product_id,s.qty_milli,s.unit_price_paisa,s.line_total_paisa,s.payment,s.created_at FROM sales s JOIN products p ON p.id=s.product_id WHERE p.vendor_id=$1 ORDER BY s.created_at DESC LIMIT 2000',
      [v]
    ),
  ]);
  return ok({
    vendor,
    ledger: await vendorLedger(v),
    purchases: purchases.rows,
    payments: payments.rows,
    returns: returns.rows,
    sales: sales.rows,
  });
});
route('GET', '/vendor/applications', { auth: 'owner' }, async () =>
  ok({
    applications: (
      await (
        await db()
      ).query(
        'SELECT id,business,contact,email,phone,address,note,status,created_at,(password_hash IS NOT NULL) AS password_ready FROM vendor_applications ORDER BY created_at DESC LIMIT 500'
      )
    ).rows,
  })
);
route(
  'POST',
  new RegExp(`^/vendor/applications/${HEX}/approve$`),
  { auth: 'owner', tx: true },
  async ({ params, c }) => {
    const a = (
      await c.query('SELECT * FROM vendor_applications WHERE id=$1 FOR UPDATE', [params[0]])
    ).rows[0];
    if (!a) throw fail('Application not found', 404);
    if (a.status !== 'Pending') throw fail('Application already reviewed', 409);
    if (!a.password_hash || !a.salt)
      throw fail(
        'This older application has no vendor-set password. Reject it and ask the vendor to apply again with their own password.',
        409
      );
    const v = id();
    await c.query(
      'INSERT INTO vendors(id,name,contact,phone,email,address) VALUES($1,$2,$3,$4,$5,$6)',
      [v, a.business, a.contact, a.phone, a.email, a.address]
    );
    await c.query(
      'INSERT INTO store_accounts(id,name,email,password_hash,salt,role,vendor_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id(), a.contact, a.email, a.password_hash, a.salt, 'vendor', v]
    );
    await c.query("UPDATE vendor_applications SET status='Approved' WHERE id=$1", [a.id]);
    return ok({ vendorId: v, email: a.email, status: 'Approved' }, 201);
  }
);
route(
  'POST',
  new RegExp(`^/vendor/applications/${HEX}/reject$`),
  { auth: 'owner', tx: true },
  async ({ params, c }) => {
    const r = await c.query(
      "UPDATE vendor_applications SET status='Rejected' WHERE id=$1 AND status='Pending' RETURNING id,status",
      [params[0]]
    );
    if (!r.rows.length) throw fail('Pending application not found', 404);
    return ok(r.rows[0]);
  }
);
route('POST', '/vendor/returns', { auth: 'owner', body: 'json' }, async ({ body: b }) =>
  ok(await returnToVendor(b), 201)
);
route('GET', '/vendor/returns', { auth: 'owner' }, async () =>
  ok({
    returns: (
      await (await db()).query('SELECT * FROM vendor_returns ORDER BY created_at DESC LIMIT 2000')
    ).rows,
  })
);
route('GET', '/vendor/payments', { auth: 'owner' }, async () =>
  ok({
    payments: (
      await (await db()).query('SELECT * FROM vendor_payments ORDER BY created_at DESC LIMIT 2000')
    ).rows,
  })
);
route(
  'POST',
  '/vendor/payments',
  { auth: 'owner', body: 'json', tx: true },
  async ({ body: b, c }) => {
    const vendorId = required(b.vendorId, 'Vendor'),
      amount = paisa(b.amount, 'Amount'),
      methodName = str(b.method);
    if (!amount) throw fail('Amount must be positive');
    if (!['Cash', 'Bank transfer', 'Card'].includes(methodName))
      throw fail('Choose a payment method');
    if (!(await c.query('SELECT id FROM vendors WHERE id=$1 FOR UPDATE', [vendorId])).rows.length)
      throw fail('Vendor not found');
    if (amount > (await outstandingBalance(c, vendorId)))
      throw fail('Payment exceeds outstanding vendor balance');
    const r = await c.query(
      'INSERT INTO vendor_payments(id,vendor_id,amount_paisa,method,reference,note) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [id(), vendorId, amount, methodName, str(b.reference, 120), str(b.note, 500)]
    );
    return ok(r.rows[0], 201);
  }
);

route('GET', '/accounts', { auth: 'owner' }, async () =>
  ok({
    accounts: (
      await (
        await db()
      ).query(
        'SELECT id,name,email,role,vendor_id,active,created_at FROM store_accounts ORDER BY created_at DESC'
      )
    ).rows,
  })
);
route('POST', '/accounts', { auth: 'owner', body: 'json' }, async ({ body: b }) => {
  const role = str(b.role);
  if (role !== 'staff') throw fail('Vendor accounts must be approved through Become a Vendor');
  const name = required(b.name, 'Name'),
    email = emailOf(required(b.email, 'Email')),
    password = checkPassword(b.password),
    salt = id(),
    passwordHash = await passwordHashAsync(password, salt);
  const r = await tx(c =>
    c.query(
      'INSERT INTO store_accounts(id,name,email,password_hash,salt,role,vendor_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,email,role,vendor_id,active',
      [id(), name, email, passwordHash, salt, role, null]
    )
  );
  return ok(r.rows[0], 201);
});
route(
  'PATCH',
  new RegExp(`^/accounts/${HEX}$`),
  { auth: 'owner', body: 'json', tx: true },
  async ({ params, body: b, c }) => {
    if (typeof b.active !== 'boolean') throw fail('Active must be true or false');
    const r = await c.query(
      'UPDATE store_accounts SET active=$1 WHERE id=$2 RETURNING id,name,email,role,vendor_id,active',
      [b.active, params[0]]
    );
    if (!r.rows.length) throw fail('Account not found', 404);
    if (!b.active) await c.query('DELETE FROM account_sessions WHERE account_id=$1', [params[0]]);
    return ok(r.rows[0]);
  }
);

route(
  'POST',
  new RegExp(`^/products/${HEX}/image$`),
  { auth: 'catalog', body: 'image', tx: true },
  async ({ user, params, image, c }) => {
    const owned = await c.query(
      user.role === 'vendor'
        ? 'SELECT id FROM products WHERE id=$1 AND vendor_id=$2 AND deleted_at IS NULL FOR UPDATE'
        : 'SELECT id FROM products WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
      user.role === 'vendor' ? [params[0], user.vendor_id] : [params[0]]
    );
    if (!owned.rows.length) throw fail('Product not found', 404);
    return ok({ image: await storeImage(c, params[0], image.data, image.mime) });
  }
);
route(
  'POST',
  new RegExp(`^/products/${HEX}/price-review$`),
  { auth: 'owner', body: 'json' },
  async ({ params, body: b }) => ok(await reviewProposedPrice(params[0], b.accept === true))
);
route('GET', '/categories', { auth: 'session' }, async () =>
  ok({ categories: GROCERY_CATEGORIES, taxonomy: GROCERY_TAXONOMY })
);
route('GET', '/orders', { auth: 'worker' }, async ({ query }) =>
  ok({ orders: await allOrders({ limit: query.get('limit') }) })
);
route(
  'POST',
  /^\/orders\/([A-Za-z0-9-]+)\/([A-Za-z]+)$/,
  { auth: 'worker', body: 'json' },
  async ({ params, body: b, user }) => ok(await changeOrder(params[0], params[1], b, user.role))
);
route(
  'POST',
  new RegExp(`^/products/${HEX}/stock$`),
  { auth: 'owner', body: 'json' },
  async ({ params, body: b }) => ok(await setStock(params[0], b))
);
route('POST', '/products/bulk-action', { auth: 'owner', body: 'json' }, async ({ body: b }) =>
  ok(await catalogAction(b))
);
route('POST', '/bulk/import', { auth: 'owner', body: 'json' }, async ({ body: b }) =>
  ok(await importCatalogBatch(b))
);
route('POST', '/import-legacy', { auth: 'owner', body: 'json' }, async ({ body: b }) =>
  ok(await importLegacy(b), 201)
);
route('POST', '/products', { auth: 'catalog', body: 'json' }, async ({ body: b, user }) =>
  ok(await saveProduct(b, null, user), 201)
);
route(
  'PUT',
  new RegExp(`^/products/${HEX}$`),
  { auth: 'catalog', body: 'json' },
  async ({ params, body: b, user }) => ok(await saveProduct(b, params[0], user))
);
route('DELETE', new RegExp(`^/products/${HEX}$`), { auth: 'owner' }, async ({ params }) =>
  ok(await catalogAction({ ids: [params[0]], action: 'delete' }))
);
const vendorFields = b => [
  required(b.name, 'Vendor name'),
  str(b.contact),
  str(b.phone, 30),
  str(b.email, 250),
  str(b.address, 1000),
  str(b.terms),
  str(b.taxId),
];
route('POST', '/vendors', { auth: 'owner', body: 'json', tx: true }, async ({ body: b, c }) =>
  ok(
    (
      await c.query(
        'INSERT INTO vendors(id,name,contact,phone,email,address,terms,tax_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [id(), ...vendorFields(b)]
      )
    ).rows[0],
    201
  )
);
route(
  'PUT',
  new RegExp(`^/vendors/${HEX}$`),
  { auth: 'owner', body: 'json', tx: true },
  async ({ params, body: b, c }) => {
    const r = await c.query(
      'UPDATE vendors SET name=$1,contact=$2,phone=$3,email=$4,address=$5,terms=$6,tax_id=$7 WHERE id=$8 RETURNING *',
      [...vendorFields(b), params[0]]
    );
    if (!r.rows.length) throw fail('Vendor not found', 404);
    return ok(r.rows[0]);
  }
);
route('POST', '/purchases', { auth: 'owner', body: 'json' }, async ({ body: b }) =>
  ok(await addPurchase(b), 201)
);
route('POST', '/adjustments', { auth: 'owner', body: 'json' }, async ({ body: b }) =>
  ok(await addAdjustment(b), 201)
);
route('POST', '/checkout', { auth: 'worker', body: 'json' }, async ({ body: b, user }) =>
  ok(await checkout(b, user), 201)
);
route('POST', '/expenses', { auth: 'owner', body: 'json', tx: true }, async ({ body: b, c }) => {
  const amount = paisa(b.amount, 'Amount');
  if (!amount) throw fail('Amount must be greater than zero');
  const r = await c.query(
    'INSERT INTO expenses(id,category,description,amount_paisa,payment,reference) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [
      id(),
      required(b.category, 'Category'),
      required(b.description, 'Description'),
      amount,
      str(b.payment) || 'Cash',
      str(b.reference),
    ]
  );
  return ok(r.rows[0], 201);
});
