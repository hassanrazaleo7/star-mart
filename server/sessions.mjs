import { db, tx } from './db.mjs';
import { id, hash, tokensFrom } from './auth.mjs';
import { SESSION_DAYS } from './config.mjs';
import { fail } from './errors.mjs';
import { setActor } from './request-context.mjs';
import { firebaseIdentity } from './customer-auth.mjs';

// Owner, staff and vendor sessions share the store cookie. Returns {user, token} or null.
export async function storeSession(req) {
  const tokens = tokensFrom(req, 'store');
  if (!tokens.length) return null;
  const d = await db();
  for (const token of tokens) {
    const key = hash(token);
    let q = await d.query(
      'SELECT u.id,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()',
      [key]
    );
    if (q.rows[0]) return { user: { ...q.rows[0], role: 'admin' }, token };
    q = await d.query(
      'SELECT a.id,a.name,a.role,a.vendor_id FROM account_sessions s JOIN store_accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND a.active=TRUE',
      [key]
    );
    if (q.rows[0]) return { user: q.rows[0], token };
  }
  return null;
}

// Customer identity: cookie session (linked:true) or a Firebase bearer token (linked only when mapped).
export async function customerSession(req) {
  const tokens = tokensFrom(req, 'customer');
  if (tokens.length) {
    const d = await db();
    for (const token of tokens) {
      const r = await d.query(
        'SELECT a.id,a.name,a.email,a.phone FROM customer_sessions s JOIN customer_accounts a ON a.id=s.customer_id WHERE s.token_hash=$1 AND s.expires_at>NOW()',
        [hash(token)]
      );
      if (r.rows[0]) {
        setActor('customer: ' + r.rows[0].name + ' (' + r.rows[0].id + ')');
        return { customer: { ...r.rows[0], linked: true }, token };
      }
    }
  }
  if (req.headers.authorization?.startsWith('Bearer ')) {
    const identity = await firebaseIdentity(req);
    const linked = (
      await (
        await db()
      ).query(
        'SELECT a.id,a.name,a.email,a.phone FROM customer_identities i JOIN customer_accounts a ON a.id=i.customer_id WHERE i.uid=$1',
        [identity.id]
      )
    ).rows[0];
    if (linked) {
      setActor('customer: ' + linked.name + ' (' + linked.id + ')');
      return { customer: { ...linked, linked: true }, token: null };
    }
    setActor('customer (unlinked): ' + identity.id);
    return {
      customer: {
        id: identity.id,
        name: identity.name,
        email: identity.email,
        phone: identity.phone,
        linked: false,
      },
      token: null,
    };
  }
  throw fail('Please sign in', 401);
}

const ROLE_ERRORS = {
  owner: ['admin', 'Admin access required'],
  worker: ['admin', 'staff', 'Staff access required'],
  catalog: ['admin', 'vendor', 'Catalog access required'],
  vendor: ['vendor', 'Vendor access required'],
  session: ['admin', 'staff', 'vendor', 'Please sign in'],
};

// Resolves the identity a route requires and attaches it to ctx. Throws 401/403 otherwise.
export async function guard(auth, ctx) {
  const { req } = ctx;
  if (auth === 'public') return;
  if (auth === 'customer' || auth === 'customerLinked') {
    const { customer, token } = await customerSession(req);
    if (auth === 'customerLinked' && !customer.linked)
      throw fail('Create a Star Mart profile with email and password to use this feature', 409);
    ctx.customer = customer;
    ctx.customerToken = token;
    return;
  }
  if (auth === 'customerOptional') {
    try {
      const { customer, token } = await customerSession(req);
      ctx.customer = customer;
      ctx.customerToken = token;
    } catch (e) {
      if (e.status !== 401) throw e;
    }
    return;
  }
  if (auth === 'firebase') {
    ctx.identity = await firebaseIdentity(req);
    return;
  }
  const roles = ROLE_ERRORS[auth];
  if (!roles) throw fail('Route misconfigured: unknown guard ' + auth, 500);
  const session = await storeSession(req);
  if (!session) throw fail('Please sign in', 401);
  const { user, token } = session;
  setActor(user.role + ': ' + user.name + ' (' + user.id + ')');
  if (!roles.slice(0, -1).includes(user.role)) throw fail(roles[roles.length - 1], 403);
  if (auth === 'vendor' && !user.vendor_id) throw fail('Vendor access required', 403);
  ctx.user = user;
  ctx.token = token;
}

const SESSION_TABLES = {
  admin: ['sessions', 'user_id'],
  account: ['account_sessions', 'account_id'],
  customer: ['customer_sessions', 'customer_id'],
};
// Creates a session row and returns the raw token. Pass an open transaction client to join it.
export async function openSession(kind, ownerId, c) {
  const [table, column] = SESSION_TABLES[kind];
  const token = id() + id();
  const run = client =>
    client.query(
      `INSERT INTO ${table}(token_hash,${column},expires_at) VALUES($1,$2,NOW()+($3::text||' days')::interval)`,
      [hash(token), ownerId, String(SESSION_DAYS)]
    );
  if (c) await run(c);
  else await tx(run);
  return token;
}
export async function closeSessions(req, kind) {
  const tokens = tokensFrom(req, kind === 'customer' ? 'customer' : 'store');
  if (!tokens.length) return;
  const hashes = tokens.map(hash);
  await tx(async c => {
    if (kind === 'customer')
      await c.query('DELETE FROM customer_sessions WHERE token_hash=ANY($1::text[])', [hashes]);
    else {
      await c.query('DELETE FROM sessions WHERE token_hash=ANY($1::text[])', [hashes]);
      await c.query('DELETE FROM account_sessions WHERE token_hash=ANY($1::text[])', [hashes]);
    }
  });
}
