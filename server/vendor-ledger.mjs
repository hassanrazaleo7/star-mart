import { db, tx } from './db.mjs';
import { id } from './auth.mjs';
import { wholeQuantity as milli, lineAmount } from './money.mjs';
import { fail } from './errors.mjs';
import { str } from './validate.mjs';
import { lockProduct, availableOf } from './inventory.mjs';

export async function vendorLedger(vendorId) {
  const c = await db();
  const [p, r, m] = await Promise.all([
    c.query('SELECT * FROM purchases WHERE vendor_id=$1 ORDER BY created_at,id', [vendorId]),
    c.query('SELECT * FROM vendor_returns WHERE vendor_id=$1 ORDER BY created_at,id', [vendorId]),
    c.query('SELECT * FROM vendor_payments WHERE vendor_id=$1 ORDER BY created_at,id', [vendorId]),
  ]);
  const total = x => lineAmount(Number(x.qty_milli), Number(x.unit_cost_paisa)),
    paidAtReceipt = x => (x.payment === 'Paid' ? total(x) : Number(x.paid_paisa));
  let rows = [];
  for (const x of p.rows)
    rows.push({
      id: x.id,
      date: x.created_at,
      type: 'Stock received',
      reference: x.invoice || x.id,
      method: x.payment_method || 'Unspecified',
      debit: total(x),
      credit: paidAtReceipt(x),
      note: x.note,
    });
  for (const x of r.rows)
    rows.push({
      id: x.id,
      date: x.created_at,
      type: 'Supplier return credit',
      reference: x.reference || x.purchase_id,
      method: 'Credit note',
      debit: 0,
      credit: Number(x.amount_paisa),
      note: x.reason,
    });
  for (const x of m.rows)
    rows.push({
      id: x.id,
      date: x.created_at,
      type: 'Payment to vendor',
      reference: x.reference || x.id,
      method: x.method,
      debit: 0,
      credit: Number(x.amount_paisa),
      note: x.note,
    });
  rows.sort((a, b) => new Date(a.date) - new Date(b.date) || a.id.localeCompare(b.id));
  let balance = 0;
  rows = rows.map(x => ({ ...x, balance: (balance += x.debit - x.credit) }));
  const summary = {
    supplied: p.rows.reduce((n, x) => n + total(x), 0),
    paidAtReceipt: p.rows.reduce((n, x) => n + paidAtReceipt(x), 0),
    paidLater: m.rows.reduce((n, x) => n + Number(x.amount_paisa), 0),
    returnCredit: r.rows.reduce((n, x) => n + Number(x.amount_paisa), 0),
    balance,
    // Negative balance means the vendor owes the store (returns against paid stock).
    vendorOwes: balance < 0 ? -balance : 0,
  };
  return { entries: rows, returns: r.rows, summary };
}

export async function outstandingBalance(c, vendorId) {
  const purchases = (
    await c.query(
      'SELECT qty_milli,unit_cost_paisa,payment,paid_paisa FROM purchases WHERE vendor_id=$1',
      [vendorId]
    )
  ).rows;
  const debt = purchases.reduce((n, x) => {
    const total = lineAmount(Number(x.qty_milli), Number(x.unit_cost_paisa));
    return n + total - (x.payment === 'Paid' ? total : Number(x.paid_paisa));
  }, 0);
  const paid = Number(
    (
      await c.query(
        'SELECT COALESCE(SUM(amount_paisa),0) total FROM vendor_payments WHERE vendor_id=$1',
        [vendorId]
      )
    ).rows[0].total
  );
  const credits = Number(
    (
      await c.query(
        'SELECT COALESCE(SUM(amount_paisa),0) total FROM vendor_returns WHERE vendor_id=$1',
        [vendorId]
      )
    ).rows[0].total
  );
  return debt - paid - credits;
}

export async function returnToVendor(b) {
  const qty = milli(b.qty, 'Return quantity'),
    reason = str(b.reason, 500);
  if (!qty || !reason) throw fail('Positive quantity and return reason are required');
  return tx(async c => {
    const p = (
      await c.query('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [str(b.purchaseId, 120)])
    ).rows[0];
    if (!p?.vendor_id) throw fail('Choose a purchase linked to a vendor');
    await c.query('SELECT id FROM vendors WHERE id=$1 FOR UPDATE', [p.vendor_id]);
    const product = await lockProduct(c, p.product_id);
    if (!product) throw fail('Product not found', 404);
    const prior = Number(
      (
        await c.query('SELECT COALESCE(SUM(qty_milli),0) n FROM vendor_returns WHERE purchase_id=$1', [
          p.id,
        ])
      ).rows[0].n
    );
    if (qty + prior > Number(p.qty_milli)) throw fail('Return exceeds the original received quantity');
    if (qty > availableOf(product)) throw fail('Not enough unreserved stock to return');
    const amount =
      lineAmount(prior + qty, Number(p.unit_cost_paisa)) - lineAmount(prior, Number(p.unit_cost_paisa));
    const key = id();
    const row = (
      await c.query(
        'INSERT INTO vendor_returns(id,vendor_id,purchase_id,product_id,qty_milli,amount_paisa,reason,reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [key, p.vendor_id, p.id, p.product_id, qty, amount, reason, str(b.reference, 120)]
      )
    ).rows[0];
    await c.query(
      "INSERT INTO stock_movements(id,product_id,qty_milli,kind,ref_id,reason,note) VALUES($1,$2,$3,'adjustment',$4,'Supplier return',$5)",
      [id(), p.product_id, -qty, key, reason]
    );
    return row;
  });
}
