import { isRemovedCategory } from '../src/grocery-categories.mjs';
import { db, tx } from './db.mjs';
import { id, hash } from './auth.mjs';
import { milli, paisa, lineAmount } from './money.mjs';
import { awardPoints } from './customer-ledger.mjs';
import { fail } from './errors.mjs';
import { str, PHONE } from './validate.mjs';
import { GUEST_ORDER, CUSTOMER_ORDER } from './config.mjs';
import { lockProduct, availableOf, stockOf } from './inventory.mjs';

export const ORDER_PAYMENTS = [
  'Cash on delivery',
  'Cash on pickup',
  'JazzCash transfer',
  'Easypaisa transfer',
  'Bank transfer',
  'POS card on delivery',
  'POS card on pickup',
];
export const TRANSFER_METHODS = ['JazzCash transfer', 'Easypaisa transfer', 'Bank transfer'];
export const PICKUP_METHODS = [
  'Cash on pickup',
  'POS card on pickup',
  'JazzCash transfer',
  'Easypaisa transfer',
  'Bank transfer',
];
export const isGuest = customer => String(customer?.id || '').startsWith('guest-');
const orderId = () =>
  'SMO-' + Date.now().toString(36).toUpperCase() + '-' + id().slice(0, 8).toUpperCase();
const receiptId = () =>
  'SM-' + Date.now().toString(36).toUpperCase() + '-' + id().slice(0, 8).toUpperCase();

// Reserves stock for signed-in customers (status Pending). Guests get an Inquiry that staff confirm first,
// so an anonymous caller can never hold inventory. Idempotent per (customer, requestKey).
export async function placeOrder(customer, b, { clientKey = '' } = {}) {
  const guest = isGuest(customer),
    policy = guest ? GUEST_ORDER : CUSTOMER_ORDER;
  if (!Array.isArray(b.lines) || !b.lines.length) throw fail('Basket is empty');
  if (b.lines.length > policy.maxLines)
    throw fail(`Order up to ${policy.maxLines} different products at a time`);
  const fulfillment = ['Pickup', 'Delivery'].includes(b.fulfillment) ? b.fulfillment : 'Pickup',
    name = str(b.name) || customer.name,
    phone = str(b.phone, 30) || customer.phone,
    address = str(b.address, 500);
  if (!phone) throw fail('Enter your contact number');
  if (!PHONE.test(phone)) throw fail('Enter a valid contact number');
  if (fulfillment === 'Delivery' && !address) throw fail('Enter delivery address');
  const paymentMethod =
    str(b.paymentMethod, 40) || (fulfillment === 'Delivery' ? 'Cash on delivery' : 'Cash on pickup');
  if (!ORDER_PAYMENTS.includes(paymentMethod)) throw fail('Choose a payment method');
  if (
    (fulfillment === 'Delivery' && ['Cash on pickup', 'POS card on pickup'].includes(paymentMethod)) ||
    (fulfillment === 'Pickup' && ['Cash on delivery', 'POS card on delivery'].includes(paymentMethod))
  )
    throw fail('Payment method does not match delivery or pickup');
  const paymentReference = str(b.paymentReference, 120);
  const transfer = TRANSFER_METHODS.includes(paymentMethod);
  if (transfer && !paymentReference)
    throw fail('Enter a transfer reference. Store staff will verify it.');
  const seen = new Set(),
    lines = b.lines
      .map(x => {
        const productId = str(x.productId);
        if (!productId) throw fail('Product is required');
        if (seen.has(productId)) throw fail('Duplicate item');
        seen.add(productId);
        const qty = milli(x.qty);
        if (!qty || qty % 1000 !== 0) throw fail('Order whole items only');
        if (qty > policy.maxLineMilli)
          throw fail(`Order up to ${policy.maxLineMilli / 1000} units of one product at a time`);
        return { productId, qty };
      })
      .sort((a, b) => a.productId.localeCompare(b.productId));
  const note = str(b.note, 1000);
  const requestKey = str(b.requestKey, 80) || null;
  if (requestKey && !/^[a-zA-Z0-9-]{10,80}$/.test(requestKey))
    throw fail('Invalid order request key');
  const requestHash = hash(
    JSON.stringify({ lines, fulfillment, name, phone, address, paymentMethod, paymentReference, note })
  );
  const expiryHours = guest
    ? policy.expiryHours
    : transfer
      ? CUSTOMER_ORDER.transferExpiryHours
      : policy.expiryHours;
  return tx(async c => {
    if (!guest)
      await c.query('SELECT id FROM customer_accounts WHERE id=$1 FOR UPDATE', [customer.id]);
    if (requestKey) {
      const old = (
        await c.query('SELECT * FROM customer_orders WHERE customer_uid=$1 AND request_key=$2', [
          customer.id,
          requestKey,
        ])
      ).rows[0];
      if (old) {
        if (old.request_hash !== requestHash)
          throw fail('Order request changed. Please try again.', 409);
        const oldItems = (
          await c.query('SELECT * FROM customer_order_items WHERE order_id=$1', [old.id])
        ).rows;
        return {
          id: old.id,
          status: old.status,
          paymentStatus: old.payment_status,
          total: Number(old.total_paisa),
          items: oldItems,
          expiresAt: old.expires_at,
          replayed: true,
        };
      }
    }
    const open = Number(
      (
        await c.query(
          "SELECT COUNT(*) n FROM customer_orders WHERE customer_uid=$1 AND status IN ('Pending','Inquiry') AND (expires_at IS NULL OR expires_at>NOW())",
          [customer.id]
        )
      ).rows[0].n
    );
    if (open >= policy.maxOpen)
      throw fail(
        `You already have ${open} open order${open === 1 ? '' : 's'}. Wait for the store to complete them.`,
        429
      );
    if (guest && clientKey) {
      const perClient = Number(
        (
          await c.query(
            "SELECT COUNT(*) n FROM customer_orders WHERE client_key=$1 AND status IN ('Pending','Inquiry') AND (expires_at IS NULL OR expires_at>NOW())",
            [clientKey]
          )
        ).rows[0].n
      );
      if (perClient >= policy.maxOpen)
        throw fail('Too many open orders from this connection. Please wait for the store.', 429);
    }
    const items = [];
    for (const x of lines) {
      const p = await lockProduct(c, x.productId);
      if (!p || p.catalog_status !== 'active' || p.deleted_at) throw fail('Product not found');
      const available = availableOf(p);
      if (x.qty > available) throw fail(p.name + ' has only ' + available / 1000 + ' available');
      items.push({
        ...x,
        name: p.name,
        unitPrice: Number(p.price_paisa),
        lineTotal: lineAmount(x.qty, Number(p.price_paisa)),
      });
    }
    const order = orderId(),
      total = items.reduce((n, x) => n + x.lineTotal, 0),
      status = guest ? 'Inquiry' : 'Pending',
      paymentStatus = paymentReference ? 'Reference submitted · unverified' : 'Awaiting collection';
    const inserted = await c.query(
      "INSERT INTO customer_orders(id,customer_uid,customer_name,customer_email,customer_phone,fulfillment,address,note,total_paisa,payment_method,payment_reference,payment_status,status,expires_at,client_key,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()+($14::text||' hours')::interval,$15,$16,$17) RETURNING expires_at",
      [
        order,
        customer.id,
        name,
        customer.email || '',
        phone,
        fulfillment,
        address,
        note,
        total,
        paymentMethod,
        paymentReference,
        paymentStatus,
        status,
        String(expiryHours),
        guest ? clientKey || null : null,
        requestKey,
        requestKey ? requestHash : null,
      ]
    );
    for (const x of items)
      await c.query(
        'INSERT INTO customer_order_items(id,order_id,product_id,name,qty_milli,unit_price_paisa,line_total_paisa) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [id(), order, x.productId, x.name, x.qty, x.unitPrice, x.lineTotal]
      );
    return {
      id: order,
      status,
      paymentStatus,
      total,
      items,
      expiresAt: inserted.rows[0].expires_at,
      guest,
    };
  });
}

async function withItems(c, orders) {
  if (!orders.length) return [];
  const items = (
    await c.query('SELECT * FROM customer_order_items WHERE order_id=ANY($1::text[])', [
      orders.map(x => x.id),
    ])
  ).rows;
  const byOrder = new Map();
  for (const i of items) {
    if (!byOrder.has(i.order_id)) byOrder.set(i.order_id, []);
    byOrder.get(i.order_id).push(i);
  }
  return orders.map(o => ({ ...o, items: byOrder.get(o.id) || [] }));
}
export async function customerOrders(customer) {
  const c = await db();
  return withItems(
    c,
    (
      await c.query(
        'SELECT * FROM customer_orders WHERE customer_uid=$1 ORDER BY created_at DESC LIMIT 100',
        [customer.id]
      )
    ).rows
  );
}
export async function allOrders({ limit = 1000 } = {}) {
  const c = await db();
  return withItems(
    c,
    (
      await c.query(
        "SELECT * FROM customer_orders ORDER BY CASE WHEN status IN ('Pending','Inquiry') THEN 0 ELSE 1 END,created_at DESC LIMIT $1",
        [Math.max(1, Math.min(5000, Number(limit) || 1000))]
      )
    ).rows
  );
}

// Actions: Confirm (Inquiry → Pending), Extend, Cancelled, Fulfilled, ClosePickup (fulfil with cash received).
export async function changeOrder(idValue, action, body = {}, role = 'admin') {
  const pickup = action === 'ClosePickup';
  if (pickup) action = 'Fulfilled';
  if (!['Fulfilled', 'Cancelled', 'Confirm', 'Extend'].includes(action))
    throw fail('Invalid action');
  return tx(async c => {
    const order = (
      await c.query('SELECT * FROM customer_orders WHERE id=$1 FOR UPDATE', [idValue])
    ).rows[0];
    if (!order) throw fail('Order not found', 404);
    const items = (
      await c.query('SELECT * FROM customer_order_items WHERE order_id=$1 ORDER BY product_id', [
        idValue,
      ])
    ).rows;
    // Lock the products in a fixed order so the reservation trigger never deadlocks with a concurrent sale.
    const products = new Map();
    for (const item of items) products.set(item.product_id, await lockProduct(c, item.product_id));
    if (action === 'Extend') {
      if (!['Pending', 'Inquiry'].includes(order.status))
        throw fail('Only open orders can be extended');
      const r = await c.query(
        "UPDATE customer_orders SET expires_at=GREATEST(COALESCE(expires_at,NOW()),NOW())+INTERVAL '24 hours',updated_at=NOW() WHERE id=$1 RETURNING expires_at",
        [idValue]
      );
      return { id: idValue, status: order.status, expiresAt: r.rows[0].expires_at };
    }
    if (action === 'Confirm') {
      if (order.status !== 'Inquiry') throw fail('Only WhatsApp inquiries need confirmation', 409);
      for (const item of items) {
        const p = products.get(item.product_id);
        if (!p || p.deleted_at) throw fail(item.name + ' is no longer available');
        if (Number(item.qty_milli) > availableOf(p))
          throw fail(item.name + ' has only ' + availableOf(p) / 1000 + ' available');
      }
      const r = await c.query(
        "UPDATE customer_orders SET status='Pending',expires_at=NOW()+($2::text||' hours')::interval,updated_at=NOW() WHERE id=$1 RETURNING expires_at",
        [idValue, String(CUSTOMER_ORDER.expiryHours)]
      );
      return { id: idValue, status: 'Pending', expiresAt: r.rows[0].expires_at };
    }
    if (action === 'Cancelled') {
      if (!['Pending', 'Inquiry'].includes(order.status))
        throw fail('Only pending orders can be changed');
      await c.query(
        "UPDATE customer_orders SET status='Cancelled',payment_status=CASE WHEN payment_reference<>'' THEN 'Cancelled · contact store for any transfer refund' ELSE 'Cancelled' END,updated_at=NOW() WHERE id=$1",
        [idValue]
      );
      return { id: idValue, status: 'Cancelled' };
    }
    // Fulfilled
    if (pickup && order.fulfillment !== 'Pickup')
      throw fail('Delivery orders must be settled by the owner after cash is deposited');
    if (order.fulfillment === 'Delivery' && role !== 'admin')
      throw fail('Only the owner can verify delivery payment and fulfill', 403);
    if (order.status !== 'Pending')
      throw fail(
        order.status === 'Inquiry'
          ? 'Confirm this WhatsApp inquiry before fulfilling it'
          : 'Only pending orders can be changed'
      );
    let received = Number(order.total_paisa);
    if (pickup) {
      if (!PICKUP_METHODS.includes(body.paymentMethod)) throw fail('Choose the actual payment method');
      received = paisa(body.received, 'Amount received');
      if (received < Number(order.total_paisa))
        throw fail('Collect the full order total before closing the sale');
      order.payment_method = body.paymentMethod;
      await c.query('UPDATE customer_orders SET payment_method=$1 WHERE id=$2', [
        order.payment_method,
        idValue,
      ]);
    }
    if (body.paymentCollected !== true) throw fail('Confirm payment was collected before fulfilling');
    const verifiedReference = str(body.verifiedReference, 120);
    if (TRANSFER_METHODS.includes(order.payment_method) && !verifiedReference)
      throw fail('Enter the confirmed bank/wallet transaction reference before fulfilling');
    const receipt = receiptId();
    for (const item of items) {
      const p = products.get(item.product_id);
      if (!p) throw fail(item.name + ' no longer exists');
      if (Number(item.qty_milli) > stockOf(p)) throw fail(item.name + ' no longer has enough stock');
      const sale = id();
      await c.query(
        'INSERT INTO sales(id,receipt,product_id,qty_milli,unit_price_paisa,line_total_paisa,cost_at_sale_paisa,payment,customer,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          sale,
          receipt,
          item.product_id,
          item.qty_milli,
          item.unit_price_paisa,
          item.line_total_paisa,
          p.cost_paisa,
          order.payment_method,
          order.customer_name,
          'Order ' + order.id,
        ]
      );
      await c.query(
        'INSERT INTO stock_movements(id,product_id,qty_milli,kind,ref_id,reason) VALUES($1,$2,$3,$4,$5,$6)',
        [id(), item.product_id, -Number(item.qty_milli), 'sale', sale, 'Order ' + order.id]
      );
    }
    const linked = (
      await c.query('SELECT id FROM customer_accounts WHERE id=$1', [order.customer_uid])
    ).rows[0];
    await c.query(
      'INSERT INTO receipts(id,subtotal_paisa,discount_paisa,tax_paisa,total_paisa,received_paisa,payment,customer,note,customer_id,order_id) VALUES($1,$2,0,0,$3,$4,$5,$6,$7,$8,$9)',
      [
        receipt,
        order.total_paisa,
        order.total_paisa,
        received,
        order.payment_method,
        order.customer_name,
        'Order ' + order.id,
        linked?.id || null,
        order.id,
      ]
    );
    if (linked) await awardPoints(c, linked.id, receipt, order.total_paisa);
    await c.query(
      "UPDATE customer_orders SET status='Fulfilled',payment_status='Verified · paid',verified_reference=$2,payment_verified_at=NOW(),updated_at=NOW() WHERE id=$1",
      [idValue, verifiedReference]
    );
    return {
      id: idValue,
      status: 'Fulfilled',
      receipt: {
        receipt,
        total: Number(order.total_paisa),
        subtotal: Number(order.total_paisa),
        discount: 0,
        tax: 0,
        received,
        payment: order.payment_method,
        customer: order.customer_name,
        lines: items.map(i => ({
          name: i.name,
          qty: Number(i.qty_milli),
          unitPrice: Number(i.unit_price_paisa),
          total: Number(i.line_total_paisa),
        })),
        createdAt: new Date().toISOString(),
      },
    };
  });
}

const PUBLIC_COLUMNS =
  'p.id,p.name,p.barcode,p.brand,p.category,p.pack_size,p.unit,p.image,p.price_paisa,GREATEST(0,p.stock_milli-p.reserved_milli) stock_milli';
export async function publicProducts() {
  const d = await db(),
    r = await d.query(
      `SELECT ${PUBLIC_COLUMNS} FROM products p WHERE p.catalog_status='active' AND p.deleted_at IS NULL ORDER BY p.name`
    );
  return r.rows.filter(p => !isRemovedCategory(p.category));
}
export async function publicProduct(productId) {
  const d = await db(),
    r = await d.query(
      `SELECT ${PUBLIC_COLUMNS},p.description FROM products p WHERE p.id=$1 AND p.catalog_status='active' AND p.deleted_at IS NULL`,
      [productId]
    );
  const p = r.rows[0];
  if (!p || isRemovedCategory(p.category)) throw fail('Product not found', 404);
  return p;
}
