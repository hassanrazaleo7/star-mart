import { tx } from './db.mjs';
import { id, hash } from './auth.mjs';
import { paisa, wholeQuantity as milli, lineAmount, allocate } from './money.mjs';
import { rewardAllowed } from './loyalty-policy.mjs';
import { pointsBalance, awardPoints } from './customer-ledger.mjs';
import { fail } from './errors.mjs';
import { str, required, int, validDate } from './validate.mjs';
import { lockProduct, availableOf, stockOf, reservedOf } from './inventory.mjs';
import { currentActor } from './request-context.mjs';
import {
  STAFF_MAX_DISCOUNT_BPS,
  STAFF_MAX_DISCOUNT_PAISA,
  ALERT_DISCOUNT_PAISA,
} from './config.mjs';

export const POS_PAYMENTS = ['Cash', 'Card', 'Bank transfer', 'Credit'];
const receiptId = () =>
  'SM-' + Date.now().toString(36).toUpperCase() + '-' + id().slice(0, 8).toUpperCase();

async function replayReceipt(c, old) {
  const lines = (
    await c.query(
      'SELECT s.qty_milli,s.unit_price_paisa,s.line_total_paisa,p.name FROM sales s JOIN products p ON p.id=s.product_id WHERE s.receipt=$1 ORDER BY s.id',
      [old.id]
    )
  ).rows;
  const redeemed = (
    await c.query(
      "SELECT COALESCE(SUM(-points),0) n FROM loyalty_entries WHERE receipt_id=$1 AND kind='redeemed'",
      [old.id]
    )
  ).rows[0].n;
  return {
    receipt: old.id,
    subtotal: Number(old.subtotal_paisa),
    discount: Number(old.discount_paisa),
    loyaltyDiscount: (Number(redeemed) / 100) * 5000,
    redeemedPoints: Number(redeemed),
    tax: Number(old.tax_paisa),
    total: Number(old.total_paisa),
    received: Number(old.received_paisa),
    customer: old.customer,
    payment: old.payment,
    lines: lines.map(x => ({
      name: x.name,
      qty: Number(x.qty_milli),
      unitPrice: Number(x.unit_price_paisa),
      total: Number(x.line_total_paisa),
    })),
    createdAt: old.created_at,
    replayed: true,
  };
}

// POS sale. Idempotent per cashier requestKey; staff discounts are capped; tax comes from product rates unless
// the owner overrides it explicitly.
export async function checkout(b, user = { role: 'admin', id: 'owner' }) {
  const lines = b.lines;
  if (!Array.isArray(lines) || !lines.length || lines.length > 100)
    throw fail('Add at least one product');
  const seen = new Set(),
    requested = lines
      .map(x => {
        const productId = required(x.productId, 'Product');
        if (seen.has(productId)) throw fail('Duplicate product in bill');
        seen.add(productId);
        const qty = milli(x.qty);
        if (!qty) throw fail('Quantity must be greater than zero');
        return { productId, qty };
      })
      .sort((a, b) => a.productId.localeCompare(b.productId));
  const manualDiscount = paisa(b.discount ?? 0, 'Discount'),
    manualTax =
      user.role === 'admin' && b.tax !== undefined && b.tax !== null && b.tax !== ''
        ? paisa(b.tax, 'Tax')
        : null,
    payment = POS_PAYMENTS.includes(b.payment) ? b.payment : 'Cash',
    note = str(b.note, 1000),
    customerId = str(b.customerId) || null,
    redeemPoints = Number(b.redeemPoints || 0),
    discountReason = str(b.discountReason, 200);
  let customer = str(b.customer) || 'Walk-in';
  if (!Number.isInteger(redeemPoints) || redeemPoints < 0 || redeemPoints % 100 !== 0)
    throw fail('Points must be redeemed in blocks of 100');
  if (payment === 'Credit' && !customerId)
    throw fail('Select a registered customer for credit sales');
  if (redeemPoints && !customerId) throw fail('Select a registered customer to redeem points');
  if (manualDiscount && !discountReason) throw fail('Enter a reason for the discount');
  const requestKey = b.requestKey ? user.id + ':' + str(b.requestKey, 80) : null;
  if (requestKey && !/^[A-Za-z0-9_-]+:[a-zA-Z0-9-]{10,80}$/.test(requestKey))
    throw fail('Invalid request key');
  const requestHash = hash(
    JSON.stringify({
      requested,
      manualDiscount,
      manualTax,
      payment,
      customer,
      customerId,
      redeemPoints,
      received: b.received ?? null,
      note,
    })
  );
  return tx(async c => {
    if (requestKey) {
      const old = (await c.query('SELECT * FROM receipts WHERE request_key=$1', [requestKey]))
        .rows[0];
      if (old) {
        if (old.request_hash !== requestHash)
          throw fail('This bill changed since the last attempt. Start the sale again.', 409);
        return replayReceipt(c, old);
      }
    }
    if (customerId) {
      const account = await c.query(
        'SELECT id,name FROM customer_accounts WHERE id=$1 FOR UPDATE',
        [customerId]
      );
      if (!account.rows.length) throw fail('Customer account not found', 404);
      customer = account.rows[0].name;
    }
    const purchased = [];
    for (const x of requested) {
      const p = await lockProduct(c, x.productId);
      if (!p) throw fail('Product not found');
      if (p.catalog_status === 'archived' || p.deleted_at) throw fail(p.name + ' is archived');
      const available = availableOf(p);
      if (x.qty > available)
        throw fail(
          p.name +
            ' has insufficient stock. Available: ' +
            available / 1000 +
            (reservedOf(p) ? ' (' + reservedOf(p) / 1000 + ' reserved by online orders)' : '')
        );
      purchased.push({ ...x, p, base: lineAmount(x.qty, int(p.price_paisa)) });
    }
    const subtotal = purchased.reduce((n, x) => n + x.base, 0),
      loyaltyDiscount = (redeemPoints / 100) * 5000;
    const grossProfit = purchased.reduce(
        (n, x) => n + x.base - lineAmount(x.qty, int(x.p.cost_paisa)),
        0
      ),
      costsKnown = purchased.every(x => int(x.p.cost_paisa) > 0);
    const rewardError = rewardAllowed({
      subtotal,
      grossProfit,
      manualDiscount,
      points: redeemPoints,
      balance: redeemPoints ? await pointsBalance(c, customerId) : 0,
      costsKnown,
    });
    if (rewardError) throw fail(rewardError);
    if (user.role !== 'admin') {
      const cap = Math.min(
        Math.floor((subtotal * STAFF_MAX_DISCOUNT_BPS) / 10000),
        STAFF_MAX_DISCOUNT_PAISA
      );
      if (manualDiscount > cap)
        throw fail(
          `Staff discounts are limited to Rs ${(cap / 100).toLocaleString('en-PK')} on this bill. Ask the owner.`,
          403
        );
    }
    const discount = manualDiscount + loyaltyDiscount;
    if (discount > subtotal) throw fail('Discount exceeds subtotal');
    const weights = purchased.map(x => x.base),
      discounts = allocate(discount, weights),
      taxes =
        manualTax !== null
          ? allocate(manualTax, weights)
          : purchased.map((x, i) =>
              Math.round(((x.base - discounts[i]) * int(x.p.tax_rate_bps)) / 10000)
            ),
      tax = taxes.reduce((n, t) => n + t, 0);
    const total = subtotal - discount + tax,
      received =
        b.received === '' || b.received == null
          ? payment === 'Credit'
            ? 0
            : total
          : paisa(b.received, 'Amount received');
    if (payment !== 'Credit' && received < total) throw fail('Amount received is less than total');
    if (payment === 'Credit' && received > total)
      throw fail('Received amount exceeds credit bill total');
    const receipt = receiptId();
    await c.query(
      'INSERT INTO receipts(id,subtotal_paisa,discount_paisa,tax_paisa,total_paisa,received_paisa,payment,customer,note,customer_id,request_key,request_hash,discount_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
      [
        receipt,
        subtotal,
        discount,
        tax,
        total,
        received,
        payment,
        customer,
        note,
        customerId,
        requestKey,
        requestKey ? requestHash : null,
        discountReason,
      ]
    );
    const output = [];
    for (let i = 0; i < purchased.length; i++) {
      const x = purchased[i],
        lineTotal = x.base - discounts[i] + taxes[i],
        sale = id();
      await c.query(
        'INSERT INTO sales(id,receipt,product_id,qty_milli,unit_price_paisa,line_total_paisa,cost_at_sale_paisa,payment,customer,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          sale,
          receipt,
          x.productId,
          x.qty,
          int(x.p.price_paisa),
          lineTotal,
          int(x.p.cost_paisa),
          payment,
          customer,
          note,
        ]
      );
      await c.query(
        'INSERT INTO stock_movements(id,product_id,qty_milli,kind,ref_id,reason) VALUES($1,$2,$3,$4,$5,$6)',
        [id(), x.productId, -x.qty, 'sale', sale, 'POS sale']
      );
      output.push({ name: x.p.name, qty: x.qty, unitPrice: int(x.p.price_paisa), total: lineTotal });
    }
    if (manualDiscount > ALERT_DISCOUNT_PAISA)
      await c.query(
        "INSERT INTO activity_events(entity,entity_id,action,actor) VALUES('receipts',$1,'DISCOUNT',$2)",
        [receipt, currentActor()]
      );
    if (customerId) {
      if (redeemPoints)
        await c.query(
          "INSERT INTO loyalty_entries(id,customer_id,receipt_id,points,kind) VALUES($1,$2,$3,$4,'redeemed')",
          [id(), customerId, receipt, -redeemPoints]
        );
      if (payment !== 'Credit' || received === total)
        await awardPoints(c, customerId, receipt, total);
    }
    return {
      receipt,
      subtotal,
      discount,
      loyaltyDiscount,
      redeemedPoints: redeemPoints,
      tax,
      total,
      received,
      customer,
      payment,
      lines: output,
      createdAt: new Date().toISOString(),
    };
  });
}

export async function addPurchase(b) {
  const qty = milli(b.qty);
  if (!qty) throw fail('Quantity must be greater than zero');
  const cost = paisa(b.cost, 'Cost'),
    pid = required(b.productId, 'Product'),
    vendorId = str(b.vendorId) || null,
    expiry = validDate(b.expiry, 'expiry date');
  return tx(async c => {
    const p = await lockProduct(c, pid);
    if (!p || p.deleted_at) throw fail('Product not found', 404);
    if (p.vendor_id && vendorId !== p.vendor_id)
      throw fail('Purchase vendor must match this product supplier');
    if (vendorId && !(await c.query('SELECT id FROM vendors WHERE id=$1', [vendorId])).rows.length)
      throw fail('Vendor not found');
    const purchase = id(),
      batch = str(b.batch, 100),
      note = str(b.note, 1000),
      total = lineAmount(qty, cost),
      status = ['Paid', 'Unpaid', 'Part paid'].includes(b.payment) ? b.payment : 'Unpaid',
      paid =
        status === 'Paid' ? total : status === 'Part paid' ? paisa(b.paid ?? 0, 'Paid amount') : 0,
      method =
        status === 'Unpaid'
          ? 'Credit'
          : ['Cash', 'Card', 'Bank transfer'].includes(b.paymentMethod)
            ? b.paymentMethod
            : 'Unspecified';
    if (paid > total || (status === 'Part paid' && (paid === 0 || paid === total)))
      throw fail('Enter a partial payment between zero and total');
    await c.query(
      'INSERT INTO purchases(id,product_id,vendor_id,qty_milli,unit_cost_paisa,invoice,payment,batch,expiry,note,paid_paisa,payment_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        purchase,
        pid,
        vendorId,
        qty,
        cost,
        str(b.invoice, 100),
        status,
        batch,
        expiry,
        note,
        paid,
        method,
      ]
    );
    await c.query(
      'INSERT INTO stock_movements(id,product_id,qty_milli,kind,ref_id,reason,note,batch,expiry) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id(), pid, qty, 'purchase', purchase, 'Purchase', note, batch, expiry]
    );
    await c.query('UPDATE products SET cost_paisa=$1,updated_at=NOW() WHERE id=$2', [cost, pid]);
    return { id: purchase };
  });
}

export async function addAdjustment(b) {
  const signed = Number(b.change);
  if (!Number.isFinite(signed) || signed === 0) throw fail('Change must be nonzero');
  const qty = Math.sign(signed) * milli(Math.abs(signed), 'Change');
  if (!qty) throw fail('Change must be nonzero');
  const pid = required(b.productId, 'Product'),
    reason = required(b.reason, 'Reason'),
    note = required(b.note, 'Explanation', 1000);
  return tx(async c => {
    const p = await lockProduct(c, pid);
    if (!p || p.deleted_at) throw fail('Product not found', 404);
    if (stockOf(p) + qty < 0) throw fail('Stock cannot become negative');
    if (stockOf(p) + qty < reservedOf(p))
      throw fail('This stock is reserved by pending customer orders');
    const adjustment = id();
    await c.query(
      'INSERT INTO adjustments(id,product_id,qty_milli,reason,note) VALUES($1,$2,$3,$4,$5)',
      [adjustment, pid, qty, reason, note]
    );
    await c.query(
      'INSERT INTO stock_movements(id,product_id,qty_milli,kind,ref_id,reason,note) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id(), pid, qty, 'adjustment', adjustment, reason, note]
    );
    return { id: adjustment };
  });
}
