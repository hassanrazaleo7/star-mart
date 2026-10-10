import { tx } from './db.mjs';
import { id } from './auth.mjs';
import { wholeQuantity } from './money.mjs';
import { fail } from './errors.mjs';
import { str } from './validate.mjs';
import { lockProduct, stockOf, reservedOf } from './inventory.mjs';

export async function catalogAction(b) {
  const { ids, action } = b;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 500 ||
    ids.some(x => typeof x !== 'string') ||
    new Set(ids).size !== ids.length
  )
    throw fail('Select 1–500 unique products');
  if (!['hide', 'show', 'archive', 'delete'].includes(action)) throw fail('Unknown product action');
  return tx(async c => {
    const products = (
      await c.query(
        'SELECT id,name,deleted_at,reserved_milli FROM products WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',
        [ids]
      )
    ).rows;
    if (products.length !== ids.length)
      throw fail('Some products no longer exist. Refresh the catalog.', 409);
    if (action === 'show' && products.some(p => p.deleted_at))
      throw fail('Deleted products cannot be shown again. Create the product afresh.', 409);
    if (action === 'delete') {
      const pending = (
        await c.query(
          "SELECT DISTINCT o.id FROM customer_order_items i JOIN customer_orders o ON o.id=i.order_id WHERE i.product_id=ANY($1::text[]) AND o.status IN ('Pending','Inquiry')",
          [ids]
        )
      ).rows;
      if (pending.length)
        throw fail('Pending orders reserve this product. Cancel those orders to delete it.', 409, {
          pendingOrders: pending.map(x => x.id),
        });
      await c.query(
        "UPDATE products SET deleted_at=NOW(),catalog_status='archived',updated_at=NOW() WHERE id=ANY($1::text[])",
        [ids]
      );
      return {
        changed: ids.length,
        deleted: ids.length,
        skipped: [],
        message:
          'Removed from the active catalog. Existing stock and financial history are preserved in records.',
      };
    }
    await c.query(
      'UPDATE products SET catalog_status=$1,updated_at=NOW() WHERE id=ANY($2::text[]) AND deleted_at IS NULL',
      [{ hide: 'hidden', show: 'active', archive: 'archived' }[action], ids]
    );
    return { changed: ids.length, deleted: 0, skipped: [] };
  });
}

export async function setStock(productId, b) {
  const target = wholeQuantity(b.quantity, 'Stock'),
    note = str(b.note, 1000);
  if (!note) throw fail('Enter a reason for the stock correction');
  return tx(async c => {
    const p = await lockProduct(c, productId);
    if (!p || p.deleted_at) throw fail('Product not found', 404);
    if (target < reservedOf(p))
      throw fail('Complete or cancel reserved orders before reducing this stock');
    const change = target - stockOf(p);
    if (change) {
      const aid = id();
      await c.query(
        "INSERT INTO adjustments(id,product_id,qty_milli,reason,note) VALUES($1,$2,$3,'Physical count',$4)",
        [aid, productId, change, note]
      );
      await c.query(
        "INSERT INTO stock_movements(id,product_id,qty_milli,kind,ref_id,reason,note) VALUES($1,$2,$3,'adjustment',$4,'Physical count',$5)",
        [id(), productId, change, aid, note]
      );
      await c.query('UPDATE products SET updated_at=NOW() WHERE id=$1', [productId]);
    }
    return { id: productId, stockMilli: target, changed: change !== 0 };
  });
}
