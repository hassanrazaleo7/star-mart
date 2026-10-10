import {
  GROCERY_CATEGORIES,
  LEGACY_CATEGORIES,
  normalizeCategory,
} from '../src/grocery-categories.mjs';
import { tx } from './db.mjs';
import { id, passwordHashAsync, checkPassword } from './auth.mjs';
import { paisa, wholeQuantity as milli } from './money.mjs';
import { fail } from './errors.mjs';
import { str, EMAIL } from './validate.mjs';

const categories = new Set([...GROCERY_CATEGORIES, ...LEGACY_CATEGORIES]);
const number = (v, label) => {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n < 0) throw fail(label + ' must be zero or more');
  return n;
};

export async function importCatalogBatch(payload) {
  const customers = payload.customers || [],
    products = payload.products || [];
  if (
    !Array.isArray(customers) ||
    !Array.isArray(products) ||
    customers.length + products.length === 0 ||
    customers.length + products.length > 80
  )
    throw fail('Each import batch needs 1–80 rows');
  // Validate and hash outside the transaction so the database is not held open during CPU work.
  const prepared = [];
  for (const row of customers) {
    const email = str(row.email, 250).toLowerCase(),
      name = str(row.name),
      phone = str(row.phone, 30);
    if (!name || !EMAIL.test(email)) throw fail('Customer needs a name and valid email');
    prepared.push({ email, name, phone, password: String(row.temporary_password || '') });
  }
  return tx(async c => {
    const result = {
      customersAdded: 0,
      customersSkipped: 0,
      productsAdded: 0,
      productsSkipped: 0,
      products: [],
    };
    for (const row of prepared) {
      const prior = await c.query('SELECT id FROM customer_accounts WHERE email=$1', [row.email]);
      if (prior.rows.length) {
        result.customersSkipped++;
        continue;
      }
      let password;
      try {
        password = checkPassword(row.password);
      } catch {
        throw fail('Temporary password needs 8–128 characters for ' + row.email);
      }
      const salt = id();
      await c.query(
        'INSERT INTO customer_accounts(id,name,email,phone,password_hash,salt) VALUES($1,$2,$3,$4,$5,$6)',
        [id(), row.name, row.email, row.phone, await passwordHashAsync(password, salt), salt]
      );
      result.customersAdded++;
    }
    for (const row of products) {
      const sku = str(row.sku, 80) || null,
        barcode = str(row.barcode, 80) || null,
        name = str(row.name),
        category = normalizeCategory(str(row.category)),
        unit = str(row.unit) || 'piece',
        price = paisa(number(row.price_rs, 'Price'), 'Price'),
        cost = paisa(number(row.cost_rs, 'Cost'), 'Cost'),
        opening = milli(number(row.opening_stock, 'Opening stock'), 'Opening stock'),
        reorder = milli(number(row.reorder_level, 'Reorder level'), 'Reorder level');
      if (!name || !sku) throw fail('Every product needs a name and SKU');
      if (category && !categories.has(category)) throw fail('Unknown grocery category for ' + sku);
      const match = await c.query(
        'SELECT id,sku FROM products WHERE deleted_at IS NULL AND (sku=$1 OR ($2::text IS NOT NULL AND barcode=$2))',
        [sku, barcode]
      );
      if (match.rows.length) {
        if (match.rows.length > 1 || match.rows[0].sku !== sku)
          throw fail('SKU/barcode conflict for ' + sku);
        result.productsSkipped++;
        result.products.push({ sku, id: match.rows[0].id, added: false });
        continue;
      }
      const key = id();
      await c.query(
        'INSERT INTO products(id,name,sku,barcode,brand,category,pack_size,unit,location,cost_paisa,price_paisa,reorder_milli,image,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        [
          key,
          name,
          sku,
          barcode,
          str(row.brand),
          category,
          str(row.pack_size),
          unit,
          str(row.location),
          cost,
          price,
          reorder,
          '',
          str(row.description, 3000),
        ]
      );
      if (opening)
        await c.query(
          "INSERT INTO stock_movements(id,product_id,qty_milli,kind,reason) VALUES($1,$2,$3,'opening','Bulk import opening stock')",
          [id(), key, opening]
        );
      result.productsAdded++;
      result.products.push({ sku, id: key, added: true });
    }
    return result;
  });
}
