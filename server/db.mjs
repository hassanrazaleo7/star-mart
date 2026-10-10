import { currentActor } from './request-context.mjs';

// Two engines: a pg Pool when DATABASE_URL is set, otherwise embedded PGlite in ./.data (or STAR_MART_DATA_DIR).
// Tests set STAR_MART_DATA_DIR, which wins over DATABASE_URL unless STAR_MART_FORCE_PG=1 opts in explicitly.
let pool, local;
let localQueue = Promise.resolve();
const preferLocal = () => !!process.env.STAR_MART_DATA_DIR || process.env.NODE_ENV === 'test';

export async function db() {
  if (process.env.DATABASE_URL && (!preferLocal() || process.env.STAR_MART_FORCE_PG)) {
    if (!pool) {
      const { Pool } = await import('pg');
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: process.env.VERCEL ? 1 : 5,
        idleTimeoutMillis: 20_000,
        connectionTimeoutMillis: 10_000,
      });
      pool.on('error', e => console.error('pg idle client error', e));
    }
    return pool;
  }
  if (process.env.VERCEL)
    throw Error('DATABASE_URL is required on Vercel. Connect a Postgres database.');
  if (!local) {
    // Non-literal specifier keeps the bundler/tracer from shipping PGlite to the serverless function.
    const name = '@electric-sql/pglite';
    const { PGlite } = await import(/* @vite-ignore */ name);
    const instance = new PGlite(process.env.STAR_MART_DATA_DIR || './.data');
    try {
      await instance.waitReady;
    } catch (e) {
      throw Object.assign(e, { initFailure: true });
    }
    local = instance;
  }
  return local;
}

// Every write goes through tx(). The audit actor is attached with set_config so the triggers can record it.
export async function tx(fn, actor) {
  const database = await db();
  const who = actor || currentActor();
  if (database.connect) {
    const c = await database.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('star_mart.actor',$1,true)", [who]);
      const value = await fn(c);
      await c.query('COMMIT');
      c.release();
      return value;
    } catch (e) {
      try {
        await c.query('ROLLBACK');
      } catch {
        /* connection already gone; release(e) destroys it */
      }
      c.release(e);
      throw e;
    }
  }
  // PGlite is a single session: serialize transactions so two requests never interleave BEGIN/COMMIT.
  let release;
  const previous = localQueue;
  localQueue = new Promise(r => (release = r));
  await previous;
  try {
    await database.query('BEGIN');
    try {
      await database.query("SELECT set_config('star_mart.actor',$1,true)", [who]);
      const value = await fn(database);
      await database.query('COMMIT');
      return value;
    } catch (e) {
      await database.query('ROLLBACK');
      throw e;
    }
  } finally {
    release();
  }
}

// Bump SCHEMA_VERSION whenever the DDL below changes; steady-state cold starts then run a single SELECT.
export const SCHEMA_VERSION = 2;
const TABLES = `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS admin_identities (uid TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS vendors (id TEXT PRIMARY KEY,name TEXT NOT NULL,contact TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',email TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',terms TEXT NOT NULL DEFAULT '',tax_id TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY,name TEXT NOT NULL,sku TEXT,barcode TEXT,brand TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT '',pack_size TEXT NOT NULL DEFAULT '',unit TEXT NOT NULL DEFAULT 'piece',location TEXT NOT NULL DEFAULT '',vendor_id TEXT REFERENCES vendors(id) ON DELETE SET NULL,cost_paisa BIGINT NOT NULL DEFAULT 0 CHECK(cost_paisa>=0),price_paisa BIGINT NOT NULL DEFAULT 0 CHECK(price_paisa>=0),reorder_milli BIGINT NOT NULL DEFAULT 0 CHECK(reorder_milli>=0),reorder_qty_milli BIGINT NOT NULL DEFAULT 0 CHECK(reorder_qty_milli>=0),tax_rate_bps INTEGER NOT NULL DEFAULT 0,image TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS stock_movements (id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),qty_milli BIGINT NOT NULL CHECK(qty_milli<>0),kind TEXT NOT NULL CHECK(kind IN ('opening','purchase','sale','adjustment')),ref_id TEXT,reason TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',batch TEXT NOT NULL DEFAULT '',expiry DATE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id);
CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),vendor_id TEXT REFERENCES vendors(id) ON DELETE SET NULL,qty_milli BIGINT NOT NULL CHECK(qty_milli>0),unit_cost_paisa BIGINT NOT NULL CHECK(unit_cost_paisa>=0),invoice TEXT NOT NULL DEFAULT '',payment TEXT NOT NULL DEFAULT 'Paid',batch TEXT NOT NULL DEFAULT '',expiry DATE,note TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY,receipt TEXT NOT NULL,product_id TEXT NOT NULL REFERENCES products(id),qty_milli BIGINT NOT NULL CHECK(qty_milli>0),unit_price_paisa BIGINT NOT NULL CHECK(unit_price_paisa>=0),line_total_paisa BIGINT NOT NULL CHECK(line_total_paisa>=0),cost_at_sale_paisa BIGINT NOT NULL CHECK(cost_at_sale_paisa>=0),payment TEXT NOT NULL,customer TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_sales_receipt ON sales(receipt);
CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY,subtotal_paisa BIGINT NOT NULL,discount_paisa BIGINT NOT NULL,tax_paisa BIGINT NOT NULL,total_paisa BIGINT NOT NULL,received_paisa BIGINT NOT NULL,payment TEXT NOT NULL,customer TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS adjustments (id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),qty_milli BIGINT NOT NULL CHECK(qty_milli<>0),reason TEXT NOT NULL,note TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY,category TEXT NOT NULL,description TEXT NOT NULL,amount_paisa BIGINT NOT NULL CHECK(amount_paisa>0),payment TEXT NOT NULL,reference TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS customer_orders (id TEXT PRIMARY KEY,customer_uid TEXT NOT NULL,customer_name TEXT NOT NULL,customer_email TEXT NOT NULL DEFAULT '',customer_phone TEXT NOT NULL DEFAULT '',fulfillment TEXT NOT NULL CHECK(fulfillment IN ('Pickup','Delivery')),address TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'Pending',total_paisa BIGINT NOT NULL CHECK(total_paisa>=0),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS customer_order_items (id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES customer_orders(id),product_id TEXT NOT NULL REFERENCES products(id),name TEXT NOT NULL,qty_milli BIGINT NOT NULL CHECK(qty_milli>0),unit_price_paisa BIGINT NOT NULL CHECK(unit_price_paisa>=0),line_total_paisa BIGINT NOT NULL CHECK(line_total_paisa>=0));
CREATE INDEX IF NOT EXISTS idx_order_items_product ON customer_order_items(product_id);
CREATE TABLE IF NOT EXISTS store_accounts (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,salt TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('staff','vendor')),vendor_id TEXT REFERENCES vendors(id),active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS account_sessions (token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES store_accounts(id),expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS customer_accounts (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,phone TEXT NOT NULL DEFAULT '',password_hash TEXT NOT NULL,salt TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS customer_avatars(customer_id TEXT PRIMARY KEY REFERENCES customer_accounts(id) ON DELETE CASCADE,data BYTEA NOT NULL,mime TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS customer_sessions (token_hash TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customer_accounts(id),expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS customer_identities (uid TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customer_accounts(id),provider TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS customer_credit_payments (id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customer_accounts(id),receipt_id TEXT NOT NULL REFERENCES receipts(id),amount_paisa BIGINT NOT NULL CHECK(amount_paisa>0),method TEXT NOT NULL,reference TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS loyalty_entries (id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customer_accounts(id),receipt_id TEXT NOT NULL REFERENCES receipts(id),points INTEGER NOT NULL CHECK(points<>0),kind TEXT NOT NULL CHECK(kind IN ('earned','redeemed')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS vendor_applications (id TEXT PRIMARY KEY,business TEXT NOT NULL,contact TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,address TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Rejected')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS vendor_payments (id TEXT PRIMARY KEY,vendor_id TEXT NOT NULL REFERENCES vendors(id),amount_paisa BIGINT NOT NULL CHECK(amount_paisa>0),method TEXT NOT NULL CHECK(method IN ('Cash','Bank transfer','Card')),reference TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS vendor_returns (id TEXT PRIMARY KEY,vendor_id TEXT NOT NULL REFERENCES vendors(id),purchase_id TEXT NOT NULL REFERENCES purchases(id),product_id TEXT NOT NULL REFERENCES products(id),qty_milli BIGINT NOT NULL CHECK(qty_milli>0),amount_paisa BIGINT NOT NULL CHECK(amount_paisa>=0),reason TEXT NOT NULL,reference TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS activity_events (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,entity TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL DEFAULT 'Store system',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_activity_events_date ON activity_events(created_at DESC);
CREATE TABLE IF NOT EXISTS product_images (product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,data BYTEA NOT NULL,mime TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS customer_shopping_preferences(customer_id TEXT PRIMARY KEY REFERENCES customer_accounts(id) ON DELETE CASCADE,fulfillment TEXT NOT NULL CHECK(fulfillment IN ('Delivery','Pickup')),phone TEXT NOT NULL,address TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;

const COLUMNS = `ALTER TABLE products ADD COLUMN IF NOT EXISTS vendor_available_milli BIGINT NOT NULL DEFAULT 0 CHECK(vendor_available_milli>=0);
ALTER TABLE products ADD COLUMN IF NOT EXISTS vendor_availability_updated_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS catalog_status TEXT NOT NULL DEFAULT 'active' CHECK(catalog_status IN ('active','hidden','archived'));
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vendor_proposed_price_paisa BIGINT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_milli BIGINT NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS reserved_milli BIGINT NOT NULL DEFAULT 0;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_barcode_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_live ON products(sku) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_live ON products(barcode) WHERE deleted_at IS NULL;
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS request_key TEXT;
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS request_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_request ON customer_orders(customer_uid,request_key) WHERE request_key IS NOT NULL;
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'Cash on delivery';
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS payment_reference TEXT NOT NULL DEFAULT '';
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'Awaiting collection';
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS verified_reference TEXT NOT NULL DEFAULT '';
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS payment_verified_at TIMESTAMPTZ;
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS client_key TEXT;
ALTER TABLE customer_orders DROP CONSTRAINT IF EXISTS customer_orders_status_check;
ALTER TABLE customer_orders ADD CONSTRAINT customer_orders_status_check CHECK(status IN ('Inquiry','Pending','Fulfilled','Cancelled'));
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS paid_paisa BIGINT NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'Unspecified';
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS customer_id TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS request_key TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS request_hash TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS order_id TEXT REFERENCES customer_orders(id);
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS discount_reason TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_request ON receipts(request_key) WHERE request_key IS NOT NULL;
ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS actor TEXT NOT NULL DEFAULT 'Store system';
ALTER TABLE vendor_applications ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE vendor_applications ADD COLUMN IF NOT EXISTS salt TEXT`;

const INDEXES = `CREATE INDEX IF NOT EXISTS idx_receipts_customer ON receipts(customer_id,created_at);
CREATE INDEX IF NOT EXISTS idx_receipts_order ON receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON customer_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_pending ON customer_orders(status,expires_at) WHERE status IN ('Pending','Inquiry');
CREATE INDEX IF NOT EXISTS idx_orders_customer ON customer_orders(customer_uid,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_client_key ON customer_orders(client_key) WHERE client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_updated ON customer_orders(updated_at);
CREATE INDEX IF NOT EXISTS idx_products_updated ON products(updated_at);
CREATE INDEX IF NOT EXISTS idx_products_vendor ON products(vendor_id);
CREATE INDEX IF NOT EXISTS idx_movements_product_date ON stock_movements(product_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_date ON stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_product ON sales(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_vendor ON purchases(vendor_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_adjustments_product ON adjustments(product_id);
CREATE INDEX IF NOT EXISTS idx_adjustments_date ON adjustments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_vendor ON vendor_payments(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_returns_vendor ON vendor_returns(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_returns_purchase ON vendor_returns(purchase_id);
CREATE INDEX IF NOT EXISTS idx_vendor_returns_product ON vendor_returns(product_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_customer ON loyalty_entries(customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_receipt_kind ON loyalty_entries(receipt_id,kind);
CREATE INDEX IF NOT EXISTS idx_credit_payments_receipt ON customer_credit_payments(receipt_id);
CREATE INDEX IF NOT EXISTS idx_credit_payments_customer ON customer_credit_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_account_sessions_exp ON account_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_exp ON customer_sessions(expires_at)`;

// Audit trigger. Product rows are also touched by the stock-sync triggers below; those updates leave updated_at
// untouched, so they are skipped here and the activity feed only shows real edits.
const FUNCTIONS = [
  `CREATE OR REPLACE FUNCTION star_mart_log_change() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME='products' THEN
    IF TG_OP='UPDATE' THEN
      IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN RETURN NEW; END IF;
    END IF;
  END IF;
  INSERT INTO activity_events(entity,entity_id,action,actor) VALUES(TG_TABLE_NAME,CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END,TG_OP,COALESCE(NULLIF(current_setting('star_mart.actor',true),''),'Store operation'));
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$ LANGUAGE plpgsql`,
  `CREATE OR REPLACE FUNCTION star_mart_log_image() RETURNS trigger AS $$
BEGIN
  INSERT INTO activity_events(entity,entity_id,action,actor) VALUES('product_images',CASE WHEN TG_OP='DELETE' THEN OLD.product_id ELSE NEW.product_id END,TG_OP,COALESCE(NULLIF(current_setting('star_mart.actor',true),''),'Catalog operator'));
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$ LANGUAGE plpgsql`,
  `CREATE OR REPLACE FUNCTION star_mart_sync_stock() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN UPDATE products SET stock_milli=stock_milli-OLD.qty_milli WHERE id=OLD.product_id; END IF;
  IF TG_OP IN ('UPDATE','INSERT') THEN UPDATE products SET stock_milli=stock_milli+NEW.qty_milli WHERE id=NEW.product_id; END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql`,
  `CREATE OR REPLACE FUNCTION star_mart_sync_reserved_product(pid TEXT) RETURNS void AS $$
BEGIN
  UPDATE products SET reserved_milli=(SELECT COALESCE(SUM(i.qty_milli),0) FROM customer_order_items i JOIN customer_orders o ON o.id=i.order_id WHERE o.status='Pending' AND i.product_id=pid) WHERE id=pid;
END; $$ LANGUAGE plpgsql`,
  `CREATE OR REPLACE FUNCTION star_mart_sync_reserved_item() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN PERFORM star_mart_sync_reserved_product(OLD.product_id); END IF;
  IF TG_OP IN ('UPDATE','INSERT') AND (TG_OP='INSERT' OR NEW.product_id<>OLD.product_id) THEN PERFORM star_mart_sync_reserved_product(NEW.product_id); END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql`,
  `CREATE OR REPLACE FUNCTION star_mart_sync_reserved_order() RETURNS trigger AS $$
DECLARE r RECORD;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    FOR r IN SELECT DISTINCT product_id FROM customer_order_items WHERE order_id=NEW.id ORDER BY product_id LOOP
      PERFORM star_mart_sync_reserved_product(r.product_id);
    END LOOP;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql`,
];
const TRIGGER = (name, table, fn, events = 'INSERT OR UPDATE OR DELETE') =>
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='${name}' AND tgrelid='${table}'::regclass) THEN CREATE TRIGGER ${name} AFTER ${events} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}(); END IF; END $$`;
export const AUDITED_TABLES = [
  'customer_orders',
  'products',
  'stock_movements',
  'purchases',
  'sales',
  'receipts',
  'adjustments',
  'expenses',
  'vendors',
  'vendor_applications',
  'vendor_payments',
  'vendor_returns',
  'customer_accounts',
  'customer_credit_payments',
  'store_accounts',
  'loyalty_entries',
];
const TRIGGERS = [
  ...AUDITED_TABLES.map(t => TRIGGER('star_mart_activity', t, 'star_mart_log_change')),
  TRIGGER('star_mart_activity', 'product_images', 'star_mart_log_image'),
  TRIGGER('star_mart_stock', 'stock_movements', 'star_mart_sync_stock'),
  TRIGGER('star_mart_reserved', 'customer_order_items', 'star_mart_sync_reserved_item'),
  TRIGGER('star_mart_reserved_order', 'customer_orders', 'star_mart_sync_reserved_order', 'UPDATE'),
];
// Recomputes the materialized stock columns from the ledgers; idempotent, run on every schema upgrade.
const BACKFILL = `UPDATE products p SET stock_milli=COALESCE((SELECT SUM(m.qty_milli) FROM stock_movements m WHERE m.product_id=p.id),0),reserved_milli=COALESCE((SELECT SUM(i.qty_milli) FROM customer_order_items i JOIN customer_orders o ON o.id=i.order_id WHERE o.status='Pending' AND i.product_id=p.id),0)`;
const LINK_RECEIPTS = `UPDATE receipts r SET order_id=o.id FROM customer_orders o WHERE r.order_id IS NULL AND r.note='Order '||o.id`;

const statements = text =>
  text
    .split(';\n')
    .map(x => x.trim())
    .filter(Boolean);

async function migrate() {
  const database = await db();
  // A dedicated client keeps the advisory lock and the DDL on one connection.
  const c = database.connect ? await database.connect() : database;
  try {
    await c.query(
      'CREATE TABLE IF NOT EXISTS schema_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)'
    );
    if (database.connect) await c.query('SELECT pg_advisory_lock(727401)');
    try {
      const current = Number(
        (await c.query("SELECT value FROM schema_meta WHERE key='version'")).rows[0]?.value || 0
      );
      if (current >= SCHEMA_VERSION) return;
      const { securityInit } = await import('./account-security.mjs');
      const { settingsInit } = await import('./store-settings.mjs');
      const { limitInit } = await import('./auth-limits.mjs');
      for (const s of statements(TABLES)) await c.query(s);
      await securityInit(c);
      await settingsInit(c);
      await limitInit(c);
      for (const s of statements(COLUMNS)) await c.query(s);
      for (const s of statements(INDEXES)) await c.query(s);
      for (const s of FUNCTIONS) await c.query(s);
      for (const s of TRIGGERS) await c.query(s);
      await c.query(BACKFILL);
      await c.query(LINK_RECEIPTS);
      await c.query(
        "INSERT INTO schema_meta(key,value) VALUES('version',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
        [String(SCHEMA_VERSION)]
      );
    } finally {
      if (database.connect) await c.query('SELECT pg_advisory_unlock(727401)');
    }
  } finally {
    if (database.connect) c.release();
  }
}

let initialized;
// Memoized per process. A failed migration resets the memo so the next request retries instead of poisoning the instance.
export function init() {
  initialized ||= migrate().catch(e => {
    initialized = null;
    throw Object.assign(e, { initFailure: true });
  });
  return initialized;
}

export async function close() {
  if (pool) await pool.end();
  if (local) await local.close();
  pool = null;
  local = null;
  initialized = null;
  localQueue = Promise.resolve();
}
