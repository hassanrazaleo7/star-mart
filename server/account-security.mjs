import { db, tx } from './db.mjs';
import { id, hash, passwordHashAsync, verifyAsync, checkPassword } from './auth.mjs';
import { fail } from './errors.mjs';
import { str, EMAIL } from './validate.mjs';

const kinds = {
  customer: { table: 'customer_accounts', session: 'customer_sessions', key: 'customer_id' },
  staff: { table: 'store_accounts', session: 'account_sessions', key: 'account_id' },
  vendor: { table: 'store_accounts', session: 'account_sessions', key: 'account_id' },
  admin: { table: 'users', session: 'sessions', key: 'user_id' },
};
function kind(value) {
  if (!kinds[value]) throw fail('Choose an account type');
  return kinds[value];
}
export async function securityInit(d) {
  await d.query(
    "CREATE TABLE IF NOT EXISTS password_requests(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,kind TEXT NOT NULL,email TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Pending',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
  );
  await d.query(
    'CREATE TABLE IF NOT EXISTS password_reset_tokens(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL,kind TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ)'
  );
  await d.query(
    'CREATE INDEX IF NOT EXISTS idx_reset_tokens_exp ON password_reset_tokens(expires_at)'
  );
}
export async function requestReset(b) {
  const k = String(b.kind || 'customer'),
    cfg = kind(k);
  if (k === 'admin')
    throw fail('Use your linked owner sign-in or the database owner recovery procedure');
  const email = str(b.email, 250).toLowerCase();
  if (!EMAIL.test(email)) throw fail('Enter a valid email');
  await tx(async c => {
    const a = (
      await c.query(
        `SELECT id FROM ${cfg.table} WHERE email=$1${k === 'customer' ? '' : ' AND role=$2 AND active=TRUE'} FOR UPDATE`,
        k === 'customer' ? [email] : [email, k]
      )
    ).rows[0];
    if (a) {
      const recent = (
        await c.query(
          "SELECT id FROM password_requests WHERE account_id=$1 AND kind=$2 AND status='Pending' AND created_at>NOW()-INTERVAL '24 hours'",
          [a.id, k]
        )
      ).rows[0];
      if (!recent)
        await c.query(
          'INSERT INTO password_requests(id,account_id,kind,email) VALUES($1,$2,$3,$4)',
          [id(), a.id, k, email]
        );
    }
  });
  return {
    message:
      'If this account exists, your request is with Star Mart. Contact the store to verify your identity and receive a reset link.',
  };
}
export async function resetQueue() {
  return (
    await (
      await db()
    ).query(
      "SELECT id,kind,email,status,created_at FROM password_requests WHERE status='Pending' ORDER BY created_at DESC LIMIT 100"
    )
  ).rows;
}
export async function issueReset(requestId) {
  return tx(async c => {
    const r = (
      await c.query("SELECT * FROM password_requests WHERE id=$1 AND status='Pending' FOR UPDATE", [
        requestId,
      ])
    ).rows[0];
    if (!r) throw fail('Pending request not found', 404);
    const cfg = kind(r.kind);
    const a = (
      await c.query(
        `SELECT id FROM ${cfg.table} WHERE id=$1${r.kind === 'customer' ? '' : ' AND active=TRUE'}`,
        [r.account_id]
      )
    ).rows[0];
    if (!a) throw fail('Account is unavailable');
    await c.query('DELETE FROM password_reset_tokens WHERE account_id=$1 AND kind=$2', [
      r.account_id,
      r.kind,
    ]);
    const token = id() + id();
    await c.query(
      "INSERT INTO password_reset_tokens(token_hash,account_id,kind,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '30 minutes')",
      [hash(token), r.account_id, r.kind]
    );
    await c.query("UPDATE password_requests SET status='Issued' WHERE id=$1", [r.id]);
    await c.query(
      "INSERT INTO activity_events(entity,entity_id,action,actor) VALUES('password_requests',$1,'RESET_LINK_ISSUED','Owner')",
      [r.id]
    );
    // The token travels in the URL fragment so it never reaches server logs or Referer headers.
    return { path: '/reset-password#token=' + token, email: r.email, expiresMinutes: 30 };
  });
}
export async function applyReset(b) {
  const newPassword = checkPassword(b.password);
  if (typeof b.token !== 'string' || !/^[a-f0-9]{64}$/.test(b.token))
    throw fail('Reset link is invalid or expired');
  const salt = id(),
    passwordHash = await passwordHashAsync(newPassword, salt);
  return tx(async c => {
    const r = (
      await c.query(
        'SELECT * FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() FOR UPDATE',
        [hash(b.token)]
      )
    ).rows[0];
    if (!r) throw fail('Reset link is invalid or expired');
    const cfg = kind(r.kind);
    const q = await c.query(
      `UPDATE ${cfg.table} SET password_hash=$1,salt=$2 WHERE id=$3${['vendor', 'staff'].includes(r.kind) ? ' AND active=TRUE' : ''} RETURNING id`,
      [passwordHash, salt, r.account_id]
    );
    if (!q.rows.length) throw fail('Account unavailable');
    await c.query(`DELETE FROM ${cfg.session} WHERE ${cfg.key}=$1`, [r.account_id]);
    await c.query('UPDATE password_reset_tokens SET used_at=NOW() WHERE token_hash=$1', [
      hash(b.token),
    ]);
    await c.query(
      "UPDATE password_requests SET status='Completed' WHERE account_id=$1 AND kind=$2 AND status IN ('Issued','Pending')",
      [r.account_id, r.kind]
    );
    await c.query(
      "INSERT INTO activity_events(entity,entity_id,action,actor) VALUES('password_requests',$1,'PASSWORD_RESET',$2)",
      [r.account_id, r.kind]
    );
    return { ok: true, kind: r.kind };
  });
}
export async function changePassword(user, b) {
  const cfg = kind(user.role),
    newPassword = checkPassword(b.password);
  const current = (await (await db()).query(`SELECT * FROM ${cfg.table} WHERE id=$1`, [user.id]))
    .rows[0];
  if (
    !current ||
    !(await verifyAsync(String(b.currentPassword || ''), current.salt, current.password_hash))
  )
    throw fail('Current password is incorrect', 401);
  const salt = id(),
    passwordHash = await passwordHashAsync(newPassword, salt);
  return tx(async c => {
    await c.query(`SELECT id FROM ${cfg.table} WHERE id=$1 FOR UPDATE`, [user.id]);
    await c.query(`UPDATE ${cfg.table} SET password_hash=$1,salt=$2 WHERE id=$3`, [
      passwordHash,
      salt,
      user.id,
    ]);
    await c.query(`DELETE FROM ${cfg.session} WHERE ${cfg.key}=$1`, [user.id]);
    await c.query('DELETE FROM password_reset_tokens WHERE account_id=$1 AND kind=$2', [
      user.id,
      user.role,
    ]);
    await c.query(
      "INSERT INTO activity_events(entity,entity_id,action,actor) VALUES('password_requests',$1,'PASSWORD_CHANGED',$2)",
      [user.id, user.role]
    );
    return { ok: true };
  });
}
