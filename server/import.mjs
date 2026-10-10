import { tx } from './db.mjs';
import { id } from './auth.mjs';
import { paisa, milli, lineAmount } from './money.mjs';
import { fail } from './errors.mjs';
const text = (x, max = 500) =>
  String(x ?? '')
    .trim()
    .slice(0, max);
const at = x => {
  const d = new Date(x || Date.now());
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
};
const date = x => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? x : null);
export const LEGACY_LIMITS = { products: 10000, rows: 20000 };
const BATCH = 200;

// Multi-row INSERT so a backup loads in a few round trips per table instead of one per row.
async function insertMany(c, table, columns, rows) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH),
      values = [],
      params = [];
    chunk.forEach((row, r) => {
      values.push('(' + columns.map((_, k) => '$' + (r * columns.length + k + 1)).join(',') + ')');
      params.push(...row);
    });
    await c.query(`INSERT INTO ${table}(${columns.join(',')}) VALUES ${values.join(',')}`, params);
  }
}

export async function importLegacy(data) {
  if (
    data?.version !== 1 ||
    !['products', 'vendors', 'purchases', 'sales'].every(x => Array.isArray(data[x]))
  )
    throw fail('Select a valid backup from the old Star Mart manager.');
  if (
    data.products.length > LEGACY_LIMITS.products ||
    data.purchases.length + data.sales.length > LEGACY_LIMITS.rows
  )
    throw fail(
      `Backup is too large. Import at most ${LEGACY_LIMITS.products} products and ${LEGACY_LIMITS.rows} purchase and sale rows per file.`
    );
  return tx(async c => {
    for (const t of ['products', 'vendors', 'purchases', 'sales', 'expenses'])
      if ((await c.query('SELECT 1 FROM ' + t + ' LIMIT 1')).rows.length)
        throw fail('Import only into an empty store to prevent duplicate records.', 409);
    const vendors = new Map(),
      products = new Map(),
      receipts = new Map();
    const vendorRows = [],
      productRows = [],
      movementRows = [],
      purchaseRows = [],
      saleRows = [],
      adjustmentRows = [],
      expenseRows = [];
    for (const v of data.vendors) {
      const key = id();
      vendors.set(String(v.id), key);
      vendorRows.push([
        key,
        text(v.name) || 'Unnamed vendor',
        text(v.contact),
        text(v.phone),
        text(v.email),
        text(v.address, 1000),
        text(v.terms),
        text(v.taxId),
        at(v.at),
      ]);
    }
    for (const p of data.products) {
      const key = id();
      products.set(String(p.id), key);
      const opening = milli(p.opening ?? 0);
      productRows.push([
        key,
        text(p.name) || 'Unnamed product',
        text(p.sku, 80) || null,
        text(p.barcode, 80) || null,
        text(p.brand),
        text(p.category),
        text(p.packSize),
        text(p.unit) || 'piece',
        text(p.location),
        vendors.get(String(p.vendorId)) || null,
        paisa(p.cost ?? 0),
        paisa(p.price ?? 0),
        milli(p.reorder ?? 0),
        milli(p.reorderQty ?? 0),
        Math.round(Number(p.taxRate || 0) * 100),
        text(p.image, 1000),
        text(p.description, 3000),
        at(p.at),
      ]);
      if (opening)
        movementRows.push([
          id(),
          key,
          opening,
          'opening',
          null,
          'Legacy opening stock',
          '',
          '',
          null,
          at(p.at),
        ]);
    }
    for (const x of data.purchases) {
      const pid = products.get(String(x.productId));
      if (!pid) continue;
      const key = id(),
        qty = milli(x.qty),
        cost = paisa(x.cost ?? 0);
      if (!qty) continue;
      purchaseRows.push([
        key,
        pid,
        vendors.get(String(x.vendorId)) || null,
        qty,
        cost,
        text(x.invoice, 100),
        text(x.payment) || 'Paid',
        text(x.batch, 100),
        date(x.expiry),
        text(x.note, 1000),
        at(x.at),
      ]);
      movementRows.push([
        id(),
        pid,
        qty,
        'purchase',
        key,
        'Legacy purchase',
        text(x.note, 1000),
        text(x.batch, 100),
        date(x.expiry),
        at(x.at),
      ]);
    }
    for (const x of data.sales) {
      const pid = products.get(String(x.productId));
      if (!pid) continue;
      const key = id(),
        qty = milli(x.qty),
        unit = paisa(x.price ?? 0),
        cost = paisa(
          x.costAtSale ?? data.products.find(p => String(p.id) === String(x.productId))?.cost ?? 0
        ),
        total = lineAmount(qty, unit);
      if (!qty) continue;
      const receipt = text(x.receipt) || 'LEGACY-' + key.slice(0, 12),
        saleAt = at(x.at);
      saleRows.push([
        key,
        receipt,
        pid,
        qty,
        unit,
        total,
        cost,
        text(x.payment) || 'Cash',
        text(x.customer) || 'Walk-in',
        text(x.note, 1000),
        saleAt,
      ]);
      movementRows.push([id(), pid, -qty, 'sale', key, 'Legacy sale', '', '', null, saleAt]);
      const group = receipts.get(receipt) || {
        total: 0,
        at: saleAt,
        payment: text(x.payment) || 'Cash',
        customer: text(x.customer) || 'Walk-in',
      };
      group.total += total;
      receipts.set(receipt, group);
    }
    for (const x of data.adjustments || []) {
      const pid = products.get(String(x.productId));
      if (!pid) continue;
      const change = Number(x.change);
      if (!Number.isFinite(change) || !change) continue;
      const qty = Math.sign(change) * milli(Math.abs(change)),
        key = id();
      adjustmentRows.push([
        key,
        pid,
        qty,
        text(x.reason) || 'Legacy correction',
        text(x.note) || 'Imported record',
        at(x.at),
      ]);
      movementRows.push([
        id(),
        pid,
        qty,
        'adjustment',
        key,
        text(x.reason),
        text(x.note),
        '',
        null,
        at(x.at),
      ]);
    }
    for (const x of data.expenses || []) {
      const amount = paisa(x.amount);
      if (!amount) continue;
      expenseRows.push([
        id(),
        text(x.category) || 'Other',
        text(x.description) || 'Legacy expense',
        amount,
        text(x.payment) || 'Cash',
        text(x.reference),
        at(x.at),
      ]);
    }
    await insertMany(
      c,
      'vendors',
      ['id', 'name', 'contact', 'phone', 'email', 'address', 'terms', 'tax_id', 'created_at'],
      vendorRows
    );
    await insertMany(
      c,
      'products',
      [
        'id',
        'name',
        'sku',
        'barcode',
        'brand',
        'category',
        'pack_size',
        'unit',
        'location',
        'vendor_id',
        'cost_paisa',
        'price_paisa',
        'reorder_milli',
        'reorder_qty_milli',
        'tax_rate_bps',
        'image',
        'description',
        'created_at',
      ],
      productRows
    );
    await insertMany(
      c,
      'purchases',
      [
        'id',
        'product_id',
        'vendor_id',
        'qty_milli',
        'unit_cost_paisa',
        'invoice',
        'payment',
        'batch',
        'expiry',
        'note',
        'created_at',
      ],
      purchaseRows
    );
    await insertMany(
      c,
      'receipts',
      [
        'id',
        'subtotal_paisa',
        'discount_paisa',
        'tax_paisa',
        'total_paisa',
        'received_paisa',
        'payment',
        'customer',
        'created_at',
      ],
      [...receipts].map(([receipt, g]) => [
        receipt,
        g.total,
        0,
        0,
        g.total,
        g.total,
        g.payment,
        g.customer,
        g.at,
      ])
    );
    await insertMany(
      c,
      'sales',
      [
        'id',
        'receipt',
        'product_id',
        'qty_milli',
        'unit_price_paisa',
        'line_total_paisa',
        'cost_at_sale_paisa',
        'payment',
        'customer',
        'note',
        'created_at',
      ],
      saleRows
    );
    await insertMany(
      c,
      'adjustments',
      ['id', 'product_id', 'qty_milli', 'reason', 'note', 'created_at'],
      adjustmentRows
    );
    await insertMany(
      c,
      'stock_movements',
      [
        'id',
        'product_id',
        'qty_milli',
        'kind',
        'ref_id',
        'reason',
        'note',
        'batch',
        'expiry',
        'created_at',
      ],
      movementRows
    );
    await insertMany(
      c,
      'expenses',
      ['id', 'category', 'description', 'amount_paisa', 'payment', 'reference', 'created_at'],
      expenseRows
    );
    return {
      products: products.size,
      vendors: vendors.size,
      purchases: purchaseRows.length,
      sales: saleRows.length,
      adjustments: adjustmentRows.length,
      expenses: expenseRows.length,
    };
  });
}
