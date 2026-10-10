// Stock is materialized on products (stock_milli, reserved_milli) and maintained by database triggers.
// Every mutation locks the product row first so the numbers it reads are the numbers it changes.
export async function lockProduct(c, productId) {
  return (await c.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [productId])).rows[0] || null;
}
export const stockOf = p => Number(p?.stock_milli || 0);
export const reservedOf = p => Number(p?.reserved_milli || 0);
export const availableOf = p => stockOf(p) - reservedOf(p);
