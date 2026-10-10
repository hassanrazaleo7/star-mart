import { db } from './db.mjs';
import { adminOverview } from './admin-overview.mjs';
import { fail } from './errors.mjs';
import { validDate } from './validate.mjs';
import { STATE_LIMIT, TIMEZONE_OFFSET_MINUTES } from './config.mjs';

// Local-day boundaries without relying on the database session timezone.
export function localDayStart(dateString) {
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - TIMEZONE_OFFSET_MINUTES * 60_000);
}
export function localDate(at = new Date()) {
  return new Date(at.getTime() + TIMEZONE_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}
export function firstOfPreviousMonth() {
  const [y, m] = localDate().split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 2, 1));
  return date.toISOString().slice(0, 10);
}

// Admin working set. History is windowed (default: since the first day of the previous month) and bounded.
export async function state(user, { from } = {}) {
  if (user.role === 'vendor') throw fail('Use vendor overview', 403);
  const d = await db();
  const products = (await d.query('SELECT * FROM products ORDER BY name')).rows;
  if (user.role === 'staff')
    return {
      products: products.map(
        ({ cost_paisa: _c, tax_rate_bps: _t, vendor_proposed_price_paisa: _p, ...x }) => x
      ),
      vendors: [],
      purchases: [],
      sales: [],
      receipts: [],
      adjustments: [],
      expenses: [],
      movements: [],
    };
  const since = localDayStart(validDate(from, 'start date') || firstOfPreviousMonth());
  const window = sql => d.query(sql, [since.toISOString(), STATE_LIMIT]);
  const [vendors, purchases, sales, receipts, adjustments, expenses, movements, daily] =
    await Promise.all([
      d.query('SELECT * FROM vendors ORDER BY name'),
      window('SELECT * FROM purchases WHERE created_at>=$1 ORDER BY created_at DESC LIMIT $2'),
      window('SELECT * FROM sales WHERE created_at>=$1 ORDER BY created_at DESC LIMIT $2'),
      window('SELECT * FROM receipts WHERE created_at>=$1 ORDER BY created_at DESC LIMIT $2'),
      window('SELECT * FROM adjustments WHERE created_at>=$1 ORDER BY created_at DESC LIMIT $2'),
      window('SELECT * FROM expenses WHERE created_at>=$1 ORDER BY created_at DESC LIMIT $2'),
      window(
        'SELECT * FROM stock_movements WHERE created_at>=$1 ORDER BY created_at DESC LIMIT $2'
      ),
      d.query('SELECT COALESCE(SUM(total_paisa),0) total FROM receipts WHERE created_at>=$1', [
        localDayStart(localDate()).toISOString(),
      ]),
    ]);
  return {
    ...(await adminOverview()),
    todaySalesPaisa: Number(daily.rows[0].total),
    window: { from: since.toISOString(), limit: STATE_LIMIT },
    products,
    vendors: vendors.rows,
    purchases: purchases.rows,
    sales: sales.rows,
    receipts: receipts.rows,
    adjustments: adjustments.rows,
    expenses: expenses.rows,
    movements: movements.rows,
  };
}

// Aggregated reporting for any date range, computed in the database instead of shipping rows to the browser.
export async function reportRange(from, to) {
  const start = validDate(from, 'start date') || firstOfPreviousMonth(),
    end = validDate(to, 'end date') || localDate();
  if (start > end) throw fail('Start date must be before end date');
  const lo = localDayStart(start).toISOString(),
    hi = new Date(localDayStart(end).getTime() + 86_400_000).toISOString();
  const d = await db(),
    range = [lo, hi],
    day = `TO_CHAR(created_at+($3::text||' minutes')::interval,'YYYY-MM-DD')`,
    // "day" is an interval keyword in PostgreSQL, so the alias needs an explicit AS.
    withTz = [lo, hi, String(TIMEZONE_OFFSET_MINUTES)];
  const [days, payments, products, categories, totals, purchases, expenses] = await Promise.all([
    d.query(
      `SELECT ${day} AS day,COUNT(*)::int bills,SUM(total_paisa) total_paisa,SUM(discount_paisa) discount_paisa FROM receipts WHERE created_at>=$1 AND created_at<$2 GROUP BY 1 ORDER BY 1`,
      withTz
    ),
    d.query(
      'SELECT payment,COUNT(*)::int bills,SUM(total_paisa) total_paisa FROM receipts WHERE created_at>=$1 AND created_at<$2 GROUP BY payment ORDER BY SUM(total_paisa) DESC',
      range
    ),
    d.query(
      'SELECT s.product_id,p.name,SUM(s.qty_milli) qty_milli,SUM(s.line_total_paisa) total_paisa,SUM(s.line_total_paisa)-SUM((s.qty_milli*s.cost_at_sale_paisa+500)/1000) profit_paisa FROM sales s LEFT JOIN products p ON p.id=s.product_id WHERE s.created_at>=$1 AND s.created_at<$2 GROUP BY s.product_id,p.name ORDER BY SUM(s.line_total_paisa) DESC LIMIT 50',
      range
    ),
    d.query(
      "SELECT COALESCE(NULLIF(p.category,''),'Uncategorised') category,SUM(s.line_total_paisa) total_paisa,SUM(s.qty_milli) qty_milli FROM sales s LEFT JOIN products p ON p.id=s.product_id WHERE s.created_at>=$1 AND s.created_at<$2 GROUP BY 1 ORDER BY 2 DESC",
      range
    ),
    d.query(
      'SELECT COUNT(DISTINCT receipt)::int bills,COALESCE(SUM(line_total_paisa),0) sales_paisa,COALESCE(SUM((qty_milli*cost_at_sale_paisa+500)/1000),0) cost_paisa FROM sales WHERE created_at>=$1 AND created_at<$2',
      range
    ),
    d.query(
      'SELECT COALESCE(SUM((qty_milli*unit_cost_paisa+500)/1000),0) total_paisa,COUNT(*)::int count FROM purchases WHERE created_at>=$1 AND created_at<$2',
      range
    ),
    d.query(
      'SELECT category,COALESCE(SUM(amount_paisa),0) total_paisa FROM expenses WHERE created_at>=$1 AND created_at<$2 GROUP BY category ORDER BY 2 DESC',
      range
    ),
  ]);
  const t = totals.rows[0],
    expensesTotal = expenses.rows.reduce((n, x) => n + Number(x.total_paisa), 0);
  return {
    from: start,
    to: end,
    days: days.rows,
    payments: payments.rows,
    products: products.rows,
    categories: categories.rows,
    expenses: expenses.rows,
    totals: {
      bills: Number(t.bills),
      salesPaisa: Number(t.sales_paisa),
      costPaisa: Number(t.cost_paisa),
      grossProfitPaisa: Number(t.sales_paisa) - Number(t.cost_paisa),
      purchasesPaisa: Number(purchases.rows[0].total_paisa),
      purchaseCount: Number(purchases.rows[0].count),
      expensesPaisa: expensesTotal,
      netPaisa: Number(t.sales_paisa) - Number(t.cost_paisa) - expensesTotal,
    },
  };
}
