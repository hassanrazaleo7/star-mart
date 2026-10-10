import { db } from './db.mjs';
import { fail } from './errors.mjs';
import { TIMEZONE } from './config.mjs';
import { localDayStart } from './state.mjs';
export async function dailySales(day) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    Number.isNaN(Date.parse(day + 'T00:00:00Z')) ||
    new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day
  )
    throw fail('Choose a valid date');
  const c = await db(),
    lo = localDayStart(day).toISOString(),
    hi = new Date(localDayStart(day).getTime() + 86_400_000).toISOString(),
    where = 'created_at>=$1 AND created_at<$2';
  const [summary, payments, receipts] = await Promise.all([
    c.query(
      `SELECT COUNT(*)::int bills,COALESCE(SUM(total_paisa),0) total_paisa,COALESCE(SUM(received_paisa),0) received_paisa FROM receipts WHERE ${where}`,
      [lo, hi]
    ),
    c.query(
      `SELECT payment,COUNT(*)::int bills,SUM(total_paisa) total_paisa FROM receipts WHERE ${where} GROUP BY payment ORDER BY payment`,
      [lo, hi]
    ),
    c.query(
      `SELECT id,created_at,customer,payment,total_paisa,received_paisa,discount_paisa,discount_reason,note FROM receipts WHERE ${where} ORDER BY created_at DESC LIMIT 500`,
      [lo, hi]
    ),
  ]);
  return {
    day,
    timeZone: TIMEZONE,
    summary: summary.rows[0],
    payments: payments.rows,
    receipts: receipts.rows,
  };
}
