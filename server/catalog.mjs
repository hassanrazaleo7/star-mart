import {
  GROCERY_CATEGORIES,
  LEGACY_CATEGORIES,
  normalizeCategory,
} from '../src/grocery-categories.mjs';
import { tx } from './db.mjs';
import { id } from './auth.mjs';
import { paisa, wholeQuantity as milli } from './money.mjs';
import { fail } from './errors.mjs';
import { str, required } from './validate.mjs';

const CATEGORIES = new Set([...GROCERY_CATEGORIES, ...LEGACY_CATEGORIES]);
// Fields a vendor may still edit once the store has received or sold the product.
const VENDOR_EDITABLE_WHEN_STOCKED = ['brand', 'pack_size', 'description'];

export async function saveProduct(b, productId, actor = { role: 'admin' }) {
  const name = required(b.name, 'Product name'),
    sku = str(b.sku, 80) || null,
    barcode = str(b.barcode, 80) || null,
    cost = paisa(b.cost ?? 0, 'Cost'),
    price = paisa(b.price ?? 0, 'Selling price'),
    reorder = milli(b.reorder ?? 0, 'Reorder level'),
    reorderQty = milli(b.reorderQty ?? 0, 'Reorder quantity'),
    taxRate = Math.round(Number(b.taxRate || 0) * 100);
  if (!Number.isInteger(taxRate) || taxRate < 0 || taxRate > 10000) throw fail('Invalid tax rate');
  const vendorAvailable =
    b.vendorAvailable !== undefined
      ? milli(b.vendorAvailable, 'Vendor available stock')
      : undefined;
  const vendor = actor.role === 'vendor';
  const vendorId = vendor ? actor.vendor_id : str(b.vendorId) || null,
    opening = vendor ? 0 : b.opening === undefined ? 0 : milli(b.opening, 'Opening stock');
  const category = normalizeCategory(str(b.category));
  if (category && !CATEGORIES.has(category)) throw fail('Choose a grocery category');
  return tx(async c => {
    if (vendorId && !(await c.query('SELECT id FROM vendors WHERE id=$1', [vendorId])).rows.length)
      throw fail('Vendor not found');
    const next = {
      name,
      sku,
      barcode,
      brand: str(b.brand),
      category,
      pack_size: str(b.packSize),
      unit: str(b.unit) || 'piece',
      location: str(b.location),
      vendor_id: vendorId,
      cost_paisa: cost,
      price_paisa: price,
      reorder_milli: reorder,
      reorder_qty_milli: reorderQty,
      tax_rate_bps: taxRate,
      image: '',
      description: str(b.description, 3000),
    };
    if (productId) {
      const old = (await c.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [productId]))
        .rows[0];
      if (!old || old.deleted_at) throw fail('Product not found', 404);
      if (vendor && old.vendor_id !== actor.vendor_id)
        throw fail('Product not in your catalog', 403);
      next.image = old.image;
      let proposedPrice = old.vendor_proposed_price_paisa;
      if (vendor) {
        // Operational fields always stay with the owner.
        for (const k of ['sku', 'location', 'reorder_milli', 'reorder_qty_milli', 'tax_rate_bps'])
          next[k] = old[k];
        const stocked =
          (
            await c.query(
              'SELECT 1 FROM stock_movements WHERE product_id=$1 UNION ALL SELECT 1 FROM sales WHERE product_id=$1 LIMIT 1',
              [productId]
            )
          ).rows.length > 0;
        if (stocked) {
          // Once the store holds or sells the item, price, cost, identity and unit need owner approval.
          for (const k of Object.keys(next))
            if (!VENDOR_EDITABLE_WHEN_STOCKED.includes(k)) next[k] = old[k];
          proposedPrice = price !== Number(old.price_paisa) ? price : null;
        }
      } else if (price !== Number(old.price_paisa)) proposedPrice = null;
      await c.query(
        `UPDATE products SET name=$1,sku=$2,barcode=$3,brand=$4,category=$5,pack_size=$6,unit=$7,location=$8,vendor_id=$9,cost_paisa=$10,price_paisa=$11,reorder_milli=$12,reorder_qty_milli=$13,tax_rate_bps=$14,image=$15,description=$16,vendor_proposed_price_paisa=$17,updated_at=NOW() WHERE id=$18 RETURNING *`,
        [
          next.name,
          next.sku,
          next.barcode,
          next.brand,
          next.category,
          next.pack_size,
          next.unit,
          next.location,
          next.vendor_id,
          next.cost_paisa,
          next.price_paisa,
          next.reorder_milli,
          next.reorder_qty_milli,
          next.tax_rate_bps,
          next.image,
          next.description,
          proposedPrice,
          productId,
        ]
      );
    } else {
      productId = id();
      if (!next.sku) next.sku = 'SM-' + productId.slice(0, 16).toUpperCase();
      await c.query(
        `INSERT INTO products(id,name,sku,barcode,brand,category,pack_size,unit,location,vendor_id,cost_paisa,price_paisa,reorder_milli,reorder_qty_milli,tax_rate_bps,image,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [
          productId,
          next.name,
          next.sku,
          next.barcode,
          next.brand,
          next.category,
          next.pack_size,
          next.unit,
          next.location,
          next.vendor_id,
          next.cost_paisa,
          next.price_paisa,
          next.reorder_milli,
          next.reorder_qty_milli,
          next.tax_rate_bps,
          next.image,
          next.description,
        ]
      );
      if (opening)
        await c.query(
          'INSERT INTO stock_movements(id,product_id,qty_milli,kind,reason) VALUES($1,$2,$3,$4,$5)',
          [id(), productId, opening, 'opening', 'Opening stock']
        );
    }
    if (vendorAvailable !== undefined)
      await c.query(
        'UPDATE products SET vendor_available_milli=$1,vendor_availability_updated_at=NOW(),updated_at=NOW() WHERE id=$2',
        [vendorAvailable, productId]
      );
    return (await c.query('SELECT * FROM products WHERE id=$1', [productId])).rows[0];
  });
}

// Owner accepts (or rejects) a vendor's proposed selling price.
export async function reviewProposedPrice(productId, accept) {
  return tx(async c => {
    const p = (await c.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [productId])).rows[0];
    if (!p || p.deleted_at) throw fail('Product not found', 404);
    if (p.vendor_proposed_price_paisa == null) throw fail('No proposed price to review', 409);
    const r = await c.query(
      accept
        ? 'UPDATE products SET price_paisa=vendor_proposed_price_paisa,vendor_proposed_price_paisa=NULL,updated_at=NOW() WHERE id=$1 RETURNING *'
        : 'UPDATE products SET vendor_proposed_price_paisa=NULL,updated_at=NOW() WHERE id=$1 RETURNING *',
      [productId]
    );
    return r.rows[0];
  });
}

export async function storeImage(c, productId, data, mime) {
  await c.query(
    'INSERT INTO product_images(product_id,data,mime) VALUES($1,$2,$3) ON CONFLICT(product_id) DO UPDATE SET data=EXCLUDED.data,mime=EXCLUDED.mime,updated_at=NOW()',
    [productId, data, mime]
  );
  await c.query('UPDATE products SET image=$1,updated_at=NOW() WHERE id=$2', [
    '/api/images/' + productId,
    productId,
  ]);
  return '/api/images/' + productId + '?v=' + Date.now();
}
