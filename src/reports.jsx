import React, { useEffect, useState } from 'react';
import { Package, CalendarDays } from 'lucide-react';
import { Badge as UiBadge } from '@/components/ui/badge';
import { get } from './lib/api.js';
import { formatPaisa, formatQty, localDay } from './lib/money.js';
const firstOfPreviousMonth = () => {
  const [y, m] = localDay().split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 10);
};
function Empty({ text }) {
  return (
    <div className="empty">
      <Package size={30} />
      <span>{text}</span>
    </div>
  );
}
// Date-range reporting computed by the server (sales, margin, expenses, top products) plus live stock alerts.
export default function Reports({ products, purchases, low, stock, refreshToken }) {
  const [from, setFrom] = useState(firstOfPreviousMonth),
    [to, setTo] = useState(() => localDay()),
    [report, setReport] = useState(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    get('/reports/range?from=' + from + '&to=' + to)
      .then(r => active && (setReport(r), setError('')))
      .catch(e => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [from, to, refreshToken]);
  const inventory = products.reduce(
    (n, p) => n + Math.round((stock(p) * Number(p.cost_paisa)) / 1000),
    0
  );
  const expiring = purchases.filter(
    x => x.expiry && new Date(x.expiry).getTime() - Date.now() <= 30 * 864e5
  );
  const t = report?.totals;
  const summary = t
    ? [
        ['Sales revenue', t.salesPaisa, 'Completed sales in the period, net of discounts plus tax'],
        ['Estimated gross margin', t.grossProfitPaisa, 'Revenue minus recorded item cost'],
        ['Expenses', t.expensesPaisa, 'Recorded operating costs in the period'],
        ['Estimated result', t.netPaisa, 'Before unrecorded costs and tax obligations'],
        ['Stock purchases', t.purchasesPaisa, t.purchaseCount + ' receipts in the period'],
        ['Stock valuation', inventory, 'Current quantity × last recorded cost'],
      ]
    : [];
  return (
    <>
      <div className="aw-toolbar report-range">
        <label>
          From
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} />
        </label>
        {t && (
          <span>
            {t.bills} bills · {report.from} → {report.to}
          </span>
        )}
      </div>
      {error && (
        <p className="aw-error" role="alert">
          {error}
        </p>
      )}
      {!report && !error && <p>Calculating report…</p>}
      {report && (
        <>
          <div className="report-grid">
            {summary.map(([label, n, desc]) => (
              <article className="report-card" key={label}>
                <span>{label}</span>
                <strong>{formatPaisa(n)}</strong>
                <small>{desc}</small>
              </article>
            ))}
          </div>
          <div className="two-cols">
            <section className="card">
              <div className="card-title">
                <div>
                  <span className="eyebrow">TOP SELLERS</span>
                  <h2>Products by revenue</h2>
                </div>
              </div>
              {report.products.length ? (
                report.products.slice(0, 15).map((p, i) => (
                  <div className="rank-row" key={p.product_id}>
                    <span>{String(i + 1).padStart(2, '0')}</span>
                    <strong>{p.name || 'Historical item'}</strong>
                    <b>
                      {formatQty(p.qty_milli)} · {formatPaisa(p.total_paisa)} ·{' '}
                      <small>margin {formatPaisa(p.profit_paisa)}</small>
                    </b>
                  </div>
                ))
              ) : (
                <Empty text="No sales in this period." />
              )}
            </section>
            <section className="card">
              <div className="card-title">
                <div>
                  <span className="eyebrow">DAILY</span>
                  <h2>Sales by day</h2>
                </div>
              </div>
              {report.days.length ? (
                <div className="aw-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th>Bills</th>
                        <th>Discounts</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.days.map(d => (
                        <tr key={d.day}>
                          <td>{d.day}</td>
                          <td>{d.bills}</td>
                          <td>{formatPaisa(d.discount_paisa)}</td>
                          <td>
                            <strong>{formatPaisa(d.total_paisa)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty text="No completed bills in this period." />
              )}
            </section>
          </div>
          <div className="two-cols">
            <section className="card">
              <div className="card-title">
                <div>
                  <span className="eyebrow">MIX</span>
                  <h2>Payments and categories</h2>
                </div>
              </div>
              {report.payments.map(p => (
                <div className="pulse-row" key={p.payment}>
                  <span>
                    {p.payment} · {p.bills} bills
                  </span>
                  <b>{formatPaisa(p.total_paisa)}</b>
                </div>
              ))}
              {report.categories.slice(0, 10).map(c => (
                <div className="pulse-row" key={c.category}>
                  <span>{c.category}</span>
                  <b>{formatPaisa(c.total_paisa)}</b>
                </div>
              ))}
              {report.expenses.map(e => (
                <div className="pulse-row" key={e.category}>
                  <span>Expense · {e.category}</span>
                  <b>{formatPaisa(e.total_paisa)}</b>
                </div>
              ))}
            </section>
            <section className="card">
              <div className="card-title">
                <div>
                  <span className="eyebrow">REORDER</span>
                  <h2>Items to buy</h2>
                </div>
              </div>
              {low.length ? (
                low.map(p => (
                  <div className="watch-row" key={p.id}>
                    <span className="product-avatar">
                      <Package size={18} />
                    </span>
                    <div>
                      <strong>{p.name}</strong>
                      <small>
                        {p.location || 'No shelf'} · reorder {formatQty(p.reorder_qty_milli)}
                      </small>
                    </div>
                    <UiBadge variant="outline" className="badge warn">
                      {formatQty(stock(p))} / {formatQty(p.reorder_milli)}
                    </UiBadge>
                  </div>
                ))
              ) : (
                <Empty text="Nothing needs reordering." />
              )}
              <div className="card-title">
                <div>
                  <span className="eyebrow">DATE TRACKING</span>
                  <h2>Expiring purchase batches</h2>
                </div>
              </div>
              {expiring.length ? (
                expiring.slice(0, 15).map(x => (
                  <div className="watch-row" key={x.id}>
                    <span className="product-avatar">
                      <CalendarDays size={18} />
                    </span>
                    <div>
                      <strong>
                        {products.find(p => p.id === x.product_id)?.name || 'Product'} ·{' '}
                        {x.batch || 'No batch'}
                      </strong>
                      <small>
                        Purchased {formatQty(x.qty_milli)} · expiry {String(x.expiry).slice(0, 10)}
                      </small>
                    </div>
                    <UiBadge variant="outline" className="badge warn">
                      Check
                    </UiBadge>
                  </div>
                ))
              ) : (
                <Empty text="No dated purchases expiring in 30 days." />
              )}
            </section>
          </div>
          <p className="report-foot">
            These are management estimates. Supplier balances are shown in Vendors → Payments &amp;
            credit, including part payments and return credits. Expiry is based on purchase dates;
            verify remaining quantities physically.
          </p>
        </>
      )}
    </>
  );
}
