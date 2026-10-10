import { db } from './db.mjs';
import { TIMEZONE_OFFSET_MINUTES } from './config.mjs';
import { localDate, localDayStart } from './state.mjs';
export async function adminOverview() {
  const c = await db();
  const [y, m, d] = localDate().split('-').map(Number);
  const since = new Date(Date.UTC(y, m - 1, d - 29) - TIMEZONE_OFFSET_MINUTES * 60_000).toISOString();
  const [sales, expenses, trend, payments, pending] = await Promise.all([
    c.query('SELECT COUNT(*)::int bills,COALESCE(SUM(total_paisa),0) total FROM receipts'),
    c.query('SELECT COALESCE(SUM(amount_paisa),0) total FROM expenses'),
    c.query(
      "SELECT TO_CHAR(created_at+($2::text||' minutes')::interval,'YYYY-MM-DD') sale_day,COUNT(*)::int bills,SUM(total_paisa) total_paisa FROM receipts WHERE created_at>=$1 GROUP BY 1 ORDER BY 1",
      [since, String(TIMEZONE_OFFSET_MINUTES)]
    ),
    c.query(
      'SELECT payment,COUNT(*)::int bills,SUM(total_paisa) total_paisa FROM receipts GROUP BY payment ORDER BY SUM(total_paisa) DESC'
    ),
    c.query(
      "SELECT COUNT(*) FILTER (WHERE status='Pending')::int pending,COUNT(*) FILTER (WHERE status='Inquiry')::int inquiries FROM customer_orders WHERE status IN ('Pending','Inquiry')"
    ),
  ]);
  return {
    dashboardSummary: {
      salesPaisa: Number(sales.rows[0].total),
      billCount: Number(sales.rows[0].bills),
      expensesPaisa: Number(expenses.rows[0].total),
      pendingOrders: Number(pending.rows[0].pending),
      inquiries: Number(pending.rows[0].inquiries),
      today: localDate(),
      todayStart: localDayStart(localDate()).toISOString(),
    },
    receiptTrend: trend.rows.map(({ sale_day, ...r }) => ({ day: sale_day, ...r })),
    paymentSummary: payments.rows,
  };
}
