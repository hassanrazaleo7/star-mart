import { route, ok, raw } from '../router.mjs';
import { db, tx } from '../db.mjs';
import {
  id,
  hash,
  passwordHashAsync,
  verifyAsync,
  needsRehash,
  checkPassword,
  cookie,
  customerCookie,
  burnVerify,
} from '../auth.mjs';
import { fail } from '../errors.mjs';
import { str, required, email as emailOf, PHONE } from '../validate.mjs';
import { storeSettings } from '../store-settings.mjs';
import { GROCERY_CATEGORIES, GROCERY_TAXONOMY } from '../../src/grocery-categories.mjs';
import { whatsappNumber, whatsappOrderLink } from '../../src/whatsapp-order.mjs';
import { placeOrder, publicProducts, publicProduct, TRANSFER_METHODS } from '../orders.mjs';
import { requestReset, applyReset } from '../account-security.mjs';
import { sweepIfDue } from '../sweeper.mjs';
import { setActor } from '../request-context.mjs';
import { clientIp } from '../auth-limits.mjs';
import { openSession } from '../sessions.mjs';

route('GET', /^\/images\/([a-f0-9]+)$/, { auth: 'public' }, async ({ params }) => {
  const result = await (
    await db()
  ).query('SELECT data,mime FROM product_images WHERE product_id=$1', [params[0]]);
  if (!result.rows.length) throw fail('Image not found', 404);
  const row = result.rows[0];
  return raw(
    200,
    {
      'content-type': row.mime,
      'cache-control': 'public,max-age=3600',
      'x-content-type-options': 'nosniff',
    },
    Buffer.from(row.data)
  );
});

// O(1) change signal: every audited table writes to activity_events, whose identity key only grows.
route('GET', '/live/version', { auth: 'public' }, async () => {
  await sweepIfDue();
  const q = await (
    await db()
  ).query('SELECT COALESCE(MAX(id),0)::text AS version FROM activity_events');
  return ok({ version: q.rows[0].version });
});

// Housekeeping endpoint for a scheduler (Vercel cron sends Authorization: Bearer <CRON_SECRET>).
route('GET', '/sweep', { auth: 'public' }, async ({ req }) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== 'Bearer ' + secret) throw fail('Not allowed', 403);
  return ok({ ok: true, result: await sweepIfDue(true) });
});

route('GET', '/public/settings', { auth: 'public' }, async () => ok(await storeSettings()));
route('GET', ['/public/categories', '/categories'][0], { auth: 'public' }, async () =>
  ok({ categories: GROCERY_CATEGORIES, taxonomy: GROCERY_TAXONOMY })
);
route('GET', '/public/products', { auth: 'public' }, async () =>
  ok({ products: await publicProducts() })
);
route('GET', /^\/public\/products\/([a-f0-9]+)$/, { auth: 'public' }, async ({ params }) =>
  ok({ product: await publicProduct(params[0]) })
);

route(
  'POST',
  '/vendor/apply',
  {
    auth: 'public',
    body: 'json',
    limit: [
      { scope: 'vendor-application', byEmail: true },
      { scope: 'vendor-application-ip', max: 3 },
    ],
  },
  async ({ body: b }) => {
    const email = emailOf(required(b.email, 'Email')),
      password = checkPassword(b.password),
      business = required(b.business, 'Business'),
      contact = required(b.contact, 'Contact'),
      phone = required(b.phone, 'Phone', 30);
    if (!PHONE.test(phone)) throw fail('Enter a valid phone number');
    const salt = id(),
      passwordHash = await passwordHashAsync(password, salt);
    const result = await tx(async c => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [email]);
      if (
        (
          await c.query(
            "SELECT id FROM store_accounts WHERE email=$1 UNION ALL SELECT id FROM vendor_applications WHERE email=$1 AND status='Pending'",
            [email]
          )
        ).rows.length
      )
        throw fail(
          'This email already has an account or pending application. Please sign in or wait for approval.',
          409
        );
      return (
        await c.query(
          'INSERT INTO vendor_applications(id,business,contact,email,phone,address,note,password_hash,salt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,status',
          [
            id(),
            business,
            contact,
            email,
            phone,
            str(b.address, 500),
            str(b.note, 1000),
            passwordHash,
            salt,
          ]
        )
      ).rows[0];
    });
    return ok(result, 201);
  }
);

route(
  'POST',
  '/public/whatsapp-order',
  {
    auth: 'customerOptional',
    body: 'json',
    limit: [
      { scope: 'whatsapp-order' },
      { scope: 'whatsapp-order-hour', max: 10, windowMinutes: 60 },
    ],
  },
  async ({ req, body: b, customer: signedIn }) => {
    const settings = await storeSettings(),
      number = whatsappNumber(settings.whatsapp || settings.phone);
    if (!number) throw fail('WhatsApp ordering is not configured. Please contact the store.');
    if (!/^[a-zA-Z0-9-]{20,80}$/.test(String(b.requestKey || '')))
      throw fail('Invalid order request key');
    if (!str(b.name) || !PHONE.test(str(b.phone, 30)))
      throw fail('Enter your name and a valid contact number');
    const transfer = TRANSFER_METHODS.includes(b.paymentMethod);
    if (
      transfer &&
      !settings[
        b.paymentMethod === 'JazzCash transfer'
          ? 'jazzcash'
          : b.paymentMethod === 'Easypaisa transfer'
            ? 'easypaisa'
            : 'bank'
      ]
    )
      throw fail('This advance payment account is not configured.');
    let customer = signedIn?.linked ? signedIn : null;
    if (!customer) {
      customer = {
        id: 'guest-' + hash(b.requestKey),
        name: str(b.name),
        phone: str(b.phone, 30),
        email: '',
      };
      setActor('WhatsApp guest ' + customer.id.slice(6, 18));
    }
    const payload = { ...b, note: 'WhatsApp order' + (b.note ? ' · ' + str(b.note, 950) : '') };
    const order = await placeOrder(customer, payload, { clientKey: hash('ip|' + clientIp(req)) });
    const whatsappUrl = whatsappOrderLink(number, {
      ...order,
      name: str(b.name),
      phone: str(b.phone, 30),
      fulfillment: b.fulfillment,
      address: str(b.address, 500),
      paymentMethod: b.paymentMethod,
      paymentReference: str(b.paymentReference, 120),
      note: str(b.note, 950),
    });
    return ok({ ...order, whatsappUrl, guest: !signedIn?.linked }, 201);
  }
);

route(
  'POST',
  '/password/request',
  {
    auth: 'public',
    body: 'json',
    limit: [
      { scope: 'reset', byEmail: true },
      { scope: 'reset-ip', max: 10 },
    ],
  },
  async ({ body: b }) => ok(await requestReset(b))
);
route(
  'POST',
  '/password/reset',
  { auth: 'public', body: 'json', limit: { scope: 'reset-apply', max: 10 } },
  async ({ body: b }) => ok(await applyReset(b))
);

route(
  'POST',
  '/customer/signup',
  { auth: 'public', body: 'json', limit: { scope: 'signup-ip', max: 10 } },
  async ({ req, body: b }) => {
    const name = required(b.name, 'Name'),
      email = emailOf(required(b.email, 'Email')),
      phone = str(b.phone, 30),
      password = checkPassword(b.password);
    if (phone && !PHONE.test(phone)) throw fail('Enter a valid contact number');
    const salt = id(),
      customerId = id(),
      passwordHash = await passwordHashAsync(password, salt);
    const token = await tx(async c => {
      if ((await c.query('SELECT id FROM customer_accounts WHERE email=$1', [email])).rows.length)
        throw fail('This email already has an account. Please sign in.', 409);
      await c.query(
        'INSERT INTO customer_accounts(id,name,email,phone,password_hash,salt) VALUES($1,$2,$3,$4,$5,$6)',
        [customerId, name, email, phone, passwordHash, salt]
      );
      return openSession('customer', customerId, c);
    });
    return ok({ user: { id: customerId, name, email, phone } }, 201, {
      'set-cookie': customerCookie(token, false, req),
    });
  }
);

route(
  'POST',
  '/customer/social',
  { auth: 'firebase', body: 'json', limit: { scope: 'social-ip' } },
  async ({ req, body: b, identity }) => {
    const provider = b.provider;
    if (!['google.com', 'facebook.com'].includes(provider))
      throw fail('Choose Google or Facebook sign in');
    if (identity.provider !== provider)
      throw fail('Social provider does not match your sign in', 403);
    if (!identity.email)
      throw fail('This social account does not share an email. Use email and password instead');
    const randomHash = await passwordHashAsync(id() + id(), id());
    const { customer, token } = await tx(async c => {
      let account = (
        await c.query(
          'SELECT a.id,a.name,a.email,a.phone FROM customer_identities i JOIN customer_accounts a ON a.id=i.customer_id WHERE i.uid=$1',
          [identity.id]
        )
      ).rows[0];
      if (!account) {
        const email = identity.email.toLowerCase();
        if ((await c.query('SELECT id FROM customer_accounts WHERE email=$1', [email])).rows.length)
          throw fail('This email already has a Star Mart account. Sign in with its password.', 409);
        const customerId = id();
        account = (
          await c.query(
            'INSERT INTO customer_accounts(id,name,email,phone,password_hash,salt) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,email,phone',
            [customerId, identity.name, email, identity.phone, randomHash, id()]
          )
        ).rows[0];
        await c.query(
          'INSERT INTO customer_identities(uid,customer_id,provider) VALUES($1,$2,$3)',
          [identity.id, customerId, provider]
        );
      }
      return { customer: account, token: await openSession('customer', account.id, c) };
    });
    return ok({ user: customer }, 200, { 'set-cookie': customerCookie(token, false, req) });
  }
);

async function rehash(table, row, password) {
  if (!needsRehash(row.password_hash)) return;
  const salt = id(),
    passwordHash = await passwordHashAsync(password, salt);
  await tx(c =>
    c.query(`UPDATE ${table} SET password_hash=$1,salt=$2 WHERE id=$3 AND password_hash=$4`, [
      passwordHash,
      salt,
      row.id,
      row.password_hash,
    ])
  );
}

route(
  'POST',
  '/customer/login',
  {
    auth: 'public',
    body: 'json',
    limit: [
      { scope: 'customer-login', byEmail: true },
      { scope: 'login-account', byEmail: true, perAccount: true, max: 10 },
    ],
  },
  async ({ req, body: b }) => {
    const email = str(b.email).toLowerCase(),
      password = String(b.password || '');
    const account = (
      await (await db()).query('SELECT * FROM customer_accounts WHERE email=$1', [email])
    ).rows[0];
    if (!account) {
      await burnVerify(password);
      throw fail('Incorrect email or password', 401);
    }
    if (!(await verifyAsync(password, account.salt, account.password_hash)))
      throw fail('Incorrect email or password', 401);
    await rehash('customer_accounts', account, password);
    const token = await openSession('customer', account.id);
    return ok(
      { user: { id: account.id, name: account.name, email: account.email, phone: account.phone } },
      200,
      { 'set-cookie': customerCookie(token, false, req) }
    );
  }
);

route('GET', '/setup/status', { auth: 'public' }, async () =>
  ok({ setup: !!(await (await db()).query('SELECT id FROM users LIMIT 1')).rows.length })
);
route(
  'POST',
  '/setup',
  { auth: 'public', body: 'json', limit: { scope: 'setup', max: 5 } },
  async ({ body: b }) => {
    if (process.env.SETUP_SECRET && b.setupSecret !== process.env.SETUP_SECRET)
      throw fail('Setup secret is required on this deployment', 403);
    const name = required(b.name, 'Name'),
      password = checkPassword(b.password),
      salt = id(),
      passwordHash = await passwordHashAsync(password, salt);
    const u = await tx(async c => {
      if ((await c.query('SELECT id FROM users LIMIT 1')).rows.length)
        throw fail('Setup already completed', 409);
      await c.query('INSERT INTO users(id,name,password_hash,salt) VALUES($1,$2,$3,$4)', [
        'owner',
        name,
        passwordHash,
        salt,
      ]);
      return { id: 'owner', name };
    });
    return ok(u, 201);
  }
);
route(
  'POST',
  '/login',
  {
    auth: 'public',
    body: 'json',
    limit: [{ scope: 'owner-login' }, { scope: 'login-account', perAccount: true, max: 10 }],
  },
  async ({ req, body: b }) => {
    const password = String(b.password || '');
    const u = (await (await db()).query('SELECT * FROM users WHERE id=$1', ['owner'])).rows[0];
    if (!u) {
      await burnVerify(password);
      throw fail('Incorrect password', 401);
    }
    if (!(await verifyAsync(password, u.salt, u.password_hash)))
      throw fail('Incorrect password', 401);
    await rehash('users', u, password);
    const token = await openSession('admin', u.id);
    return ok({ name: u.name }, 200, { 'set-cookie': cookie(token, false, req) });
  }
);
route(
  'POST',
  '/account/login',
  {
    auth: 'public',
    body: 'json',
    limit: [
      { scope: 'team-login', byEmail: true },
      { scope: 'login-account', byEmail: true, perAccount: true, max: 10 },
    ],
  },
  async ({ req, body: b }) => {
    const email = str(b.email, 250).toLowerCase(),
      password = String(b.password || '');
    const account = (
      await (
        await db()
      ).query('SELECT * FROM store_accounts WHERE email=$1 AND active=TRUE', [email])
    ).rows[0];
    if (!account) {
      await burnVerify(password);
      throw fail('Incorrect email or password', 401);
    }
    if (!(await verifyAsync(password, account.salt, account.password_hash)))
      throw fail('Incorrect email or password', 401);
    await rehash('store_accounts', account, password);
    const token = await openSession('account', account.id);
    return ok({ name: account.name, role: account.role }, 200, {
      'set-cookie': cookie(token, false, req),
    });
  }
);
route(
  'POST',
  '/admin/firebase-login',
  { auth: 'firebase', limit: { scope: 'admin-firebase', max: 10 } },
  async ({ req, identity }) => {
    const r = await (
      await db()
    ).query(
      'SELECT u.id,u.name FROM admin_identities i JOIN users u ON u.id=i.user_id WHERE i.uid=$1',
      [identity.id]
    );
    if (!r.rows.length)
      throw fail('This Google/mobile account is not linked to the store owner.', 403);
    const token = await openSession('admin', r.rows[0].id);
    return ok({ name: r.rows[0].name }, 200, { 'set-cookie': cookie(token, false, req) });
  }
);
