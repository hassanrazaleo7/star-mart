import { db, tx } from './db.mjs';
import { id } from './auth.mjs';
import { paisa } from './money.mjs';
import { fail } from './errors.mjs';
import { str } from './validate.mjs';
export async function activeShift(c, staffId, required = false) {
  const s = (
    await c.query('SELECT * FROM staff_shifts WHERE staff_id=$1 AND closed_at IS NULL FOR UPDATE', [
      staffId,
    ])
  ).rows[0];
  if (!s && required) throw fail('Open your counter shift before billing a customer.', 409);
  return s;
}
async function totals(c, s) {
  const r = (
    await c.query(
      "SELECT COUNT(*)::int bills,COALESCE(SUM(total_paisa),0) sales_paisa,COALESCE(SUM(CASE WHEN payment IN ('Cash','Credit','Cash on pickup') THEN LEAST(received_paisa,total_paisa) ELSE 0 END),0) cash_paisa FROM receipts WHERE shift_id=$1",
      [s.id]
    )
  ).rows[0];
  const collections = (
    await c.query(
      "SELECT COALESCE(SUM(amount_paisa),0) cash FROM customer_credit_payments WHERE shift_id=$1 AND method='Cash'",
      [s.id]
    )
  ).rows[0];
  const expected = Number(s.opening_paisa) + Number(r.cash_paisa) + Number(collections.cash);
  return { ...s, ...r, expected_paisa: s.closed_at ? Number(s.expected_paisa) : expected };
}
export async function shiftOverview(user) {
  const c = await db();
  const rows = (
    await c.query(
      user.role === 'admin'
        ? 'SELECT * FROM staff_shifts ORDER BY opened_at DESC LIMIT 100'
        : 'SELECT * FROM staff_shifts WHERE staff_id=$1 ORDER BY opened_at DESC LIMIT 50',
      user.role === 'admin' ? [] : [user.id]
    )
  ).rows;
  const shifts = [];
  for (const s of rows) shifts.push(await totals(c, s));
  const receipts = (
    await c.query(
      user.role === 'admin'
        ? 'SELECT id,total_paisa,received_paisa,payment,customer,cashier_name,created_at FROM receipts WHERE shift_id IS NOT NULL ORDER BY created_at DESC LIMIT 100'
        : 'SELECT id,total_paisa,received_paisa,payment,customer,cashier_name,created_at FROM receipts WHERE cashier_id=$1 ORDER BY created_at DESC LIMIT 100',
      user.role === 'admin' ? [] : [user.id]
    )
  ).rows;
  return {
    receipts,
    shifts,
    current: shifts.find(s => s.staff_id === user.id && !s.closed_at) || null,
  };
}
export async function openShift(user, b) {
  return tx(async c => {
    // Serialize opening and checkout for an individual staff account.
    await c.query('SELECT id FROM store_accounts WHERE id=$1 FOR UPDATE', [user.id]);
    if (await activeShift(c, user.id)) throw fail('Your counter shift is already open.', 409);
    return (
      await c.query(
        'INSERT INTO staff_shifts(id,staff_id,staff_name,opening_paisa,note) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [id(), user.id, user.name, paisa(b.opening ?? 0, 'Opening cash'), str(b.note, 1000)]
      )
    ).rows[0];
  });
}
export async function closeShift(user, b) {
  return tx(async c => {
    const s = await activeShift(c, user.id, true),
      result = await totals(c, s);
    const counted = paisa(b.counted, 'Counted cash'),
      variance = counted - Number(result.expected_paisa),
      note = str(b.note, 1000);
    if (variance && !note) throw fail('Explain the cash difference before closing your shift.');
    return (
      await c.query(
        'UPDATE staff_shifts SET counted_paisa=$1,expected_paisa=$2,variance_paisa=$3,note=$4,closed_at=NOW() WHERE id=$5 RETURNING *',
        [counted, result.expected_paisa, variance, note, s.id]
      )
    ).rows[0];
  });
}
