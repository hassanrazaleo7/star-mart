import React, { useEffect, useState, useRef } from 'react';
import { useLiveRefresh } from './live.js';
export const pakistanDay = value => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const get = t => parts.find(p => p.type === t)?.value;
  return get('year') + '-' + get('month') + '-' + get('day');
};
const money = n =>
  'Rs ' + (Number(n || 0) / 100).toLocaleString('en-PK', { maximumFractionDigits: 2 });
export default function DailySales() {
  const [day, setDay] = useState(() => pakistanDay(Date.now())),
    [data, setData] = useState(null),
    [error, setError] = useState('');
  const latest = useRef(day);
  latest.current = day;
  async function load() {
    const selectedDay = day;
    try {
      const r = await fetch('/api/reports/daily-sales?date=' + encodeURIComponent(day), {
          credentials: 'same-origin',
          cache: 'no-store',
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error || 'Report unavailable');
      if (j.day === latest.current) {
        setData(j);
        setError('');
      }
    } catch (e) {
      if (selectedDay === latest.current) setError(e.message);
    }
  }
  useEffect(() => {
    setData(null);
    if (day) load();
  }, [day]);
  useLiveRefresh(load);
  return (
    <section className="card">
      <div className="card-title">
        <div>
          <span className="eyebrow">COMPLETED SALES · PAKISTAN TIME</span>
          <h2>Sales by date</h2>
        </div>
        <input
          type="date"
          aria-label="Sales date"
          value={day}
          onChange={e => setDay(e.target.value)}
        />
      </div>
      {error && <p role="alert">{error}</p>}
      {data ? (
        <>
          <div className="report-grid">
            {[
              ['Total sales', money(data.summary.total_paisa)],
              ['Bills', data.summary.bills],
              ['Collected at sale', money(data.summary.received_paisa)],
            ].map(([k, v]) => (
              <article className="report-card" key={k}>
                <span>{k}</span>
                <strong>{v}</strong>
              </article>
            ))}
          </div>
          <p>
            Pending orders are excluded. Sales appear on the date payment is confirmed and the order
            is fulfilled. Later credit collections are separate.
          </p>
          {data.payments.map(p => (
            <div className="pulse-row" key={p.payment}>
              <span>
                {p.payment} · {p.bills} bills
              </span>
              <b>{money(p.total_paisa)}</b>
            </div>
          ))}
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  {['Date / receipt', 'Customer / order', 'Payment', 'Sale total'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.receipts.map(r => (
                  <tr key={r.id}>
                    <td>
                      {new Date(r.created_at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}
                      <small>{r.id}</small>
                    </td>
                    <td>
                      {r.customer}
                      <small>{r.note}</small>
                    </td>
                    <td>{r.payment}</td>
                    <td>{money(r.total_paisa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.receipts.length && <p>No completed sales on this date.</p>}
          {Number(data.summary.bills) > 500 && (
            <p>Showing the latest 500 receipts for this date. Totals include all receipts.</p>
          )}
        </>
      ) : (
        !error && <p>Loading daily sales…</p>
      )}
    </section>
  );
}
