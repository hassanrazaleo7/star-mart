import { tx } from './db.mjs';
import { ACTIVITY_RETENTION_DAYS, SWEEP_INTERVAL_MS } from './config.mjs';

// Housekeeping that must not depend on a cron: expires stale orders, prunes sessions, limiter rows and old audit events.
export async function sweep(c) {
  const lock = await c.query("SELECT pg_try_advisory_xact_lock(hashtext('star-mart-sweep')) AS ok");
  if (!lock.rows[0].ok) return { skipped: true };
  const expired = await c.query(
    "UPDATE customer_orders SET status='Cancelled',payment_status='Expired · not collected',updated_at=NOW() WHERE status IN ('Pending','Inquiry') AND expires_at IS NOT NULL AND expires_at<NOW() RETURNING id"
  );
  for (const table of [
    'sessions',
    'account_sessions',
    'customer_sessions',
    'password_reset_tokens',
  ])
    await c.query(`DELETE FROM ${table} WHERE expires_at<NOW()`);
  await c.query("DELETE FROM auth_limits WHERE started_at<NOW()-INTERVAL '1 day'");
  await c.query(
    "DELETE FROM activity_events WHERE created_at<NOW()-($1::text||' days')::interval",
    [String(ACTIVITY_RETENTION_DAYS)]
  );
  return { expiredOrders: expired.rows.map(x => x.id) };
}

let last = 0;
// Runs at most once per SWEEP_INTERVAL_MS per process; concurrent processes are serialized by the advisory lock.
export async function sweepIfDue(force = false) {
  if (!force && Date.now() - last < SWEEP_INTERVAL_MS) return null;
  last = Date.now();
  try {
    return await tx(sweep, 'Store sweeper');
  } catch (e) {
    console.error('sweep failed', e);
    return null;
  }
}
