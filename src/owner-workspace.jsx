import React, { useCallback, useEffect, useState } from 'react';
import {
  ClipboardCheck,
  Clock3,
  CheckCircle2,
  RotateCcw,
  Wallet,
  UserRound,
  ShieldCheck,
} from 'lucide-react';
import { get, post, seg } from './lib/api.js';
import { formatPaisa as money } from './lib/money.js';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useLiveRefresh } from './live.js';
export function ProductReview({ owner = false, onRefresh, onEdit }) {
  const [rows, setRows] = useState([]),
    [status, setStatus] = useState('Pending'),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState({});
  const load = useCallback(async () => {
    try {
      const r = await get('/product-submissions');
      setRows(r.submissions);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load);
  const counts = state => rows.filter(x => x.status === state && !x.deleted_at).length;
  async function review(action) {
    setBusy(true);
    setError('');
    try {
      await post('/product-submissions/' + seg(selected.id) + '/review', { ...form, action });
      setSelected(null);
      setMessage(
        action === 'approve'
          ? 'Product approved. Verified stock and supplier account updated.'
          : 'Returned with your correction note.'
      );
      await load();
      await onRefresh?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ow-panel ow-review">
      <div className="ow-heading">
        <span className="ow-symbol">
          <ClipboardCheck size={22} />
        </span>
        <div>
          <h2>{owner ? 'Product review' : 'My product submissions'}</h2>
          <p>
            {owner
              ? 'Verify details and received goods before publishing.'
              : 'Your changes go to the owner for review before going live.'}
          </p>
        </div>
        <span className="ow-count">{counts('Pending')} pending</span>
      </div>
      <div className="ow-tabs" role="group" aria-label="Submission status">
        {['Pending', 'Approved', 'Returned'].map(x => (
          <button key={x} className={status === x ? 'active' : ''} onClick={() => setStatus(x)}>
            {x} <b>{counts(x)}</b>
          </button>
        ))}
      </div>
      {message && (
        <p className="ow-success" role="status">
          <CheckCircle2 size={18} />
          {message}
        </p>
      )}
      {error && (
        <p className="ow-error" role="alert">
          {error}
        </p>
      )}
      <div className="ow-review-list">
        {rows
          .filter(s => s.status === status && !s.deleted_at)
          .map(s => (
            <article className="ow-review-row" key={s.id}>
              <div className="ow-item-icon">
                {s.has_image ? (
                  <img src={'/api/submission-images/' + s.id} alt={s.payload.name} />
                ) : (
                  <ClipboardCheck size={22} />
                )}
              </div>
              <div className="ow-item-main">
                <strong>{s.payload.name || s.name}</strong>
                <span>
                  {s.payload.category} · {s.submitted_name} ({s.submitted_role})
                </span>
                <small>
                  {new Date(s.created_at).toLocaleString()} {s.note && ' · ' + s.note}
                </small>
              </div>
              <div className="ow-item-price">
                <b>{money(Math.round(Number(s.payload.price || 0) * 100))}</b>
                <small>Proposed sale price</small>
              </div>
              {owner && s.status === 'Pending' ? (
                <button
                  className="ow-primary"
                  onClick={() => {
                    setSelected(s);
                    setError('');
                    setForm({
                      receivedQty: '0',
                      price: s.payload.price,
                      cost: s.payload.cost,
                      paid: '0',
                      method: 'Cash',
                      invoice: '',
                      note: '',
                      verified: false,
                    });
                  }}
                >
                  Review product
                </button>
              ) : (
                <div className="ow-submission-actions">
                  <span className={'ow-badge ' + s.status.toLowerCase()}>{s.status}</span>
                  {!owner && onEdit && s.status !== 'Approved' && (
                    <button
                      className="ow-primary"
                      onClick={() =>
                        onEdit({
                          ...s.payload,
                          id: s.product_id,
                          image: s.has_image ? '/api/submission-images/' + s.id : '',
                          pack_size: s.payload.packSize,
                          cost_paisa: Math.round(Number(s.payload.cost || 0) * 100),
                          price_paisa: Math.round(Number(s.payload.price || 0) * 100),
                          vendor_available_milli: Number(s.payload.vendorAvailable || 0) * 1000,
                          reorder_milli: Number(s.payload.reorder || 0) * 1000,
                          reorder_qty_milli: Number(s.payload.reorderQty || 0) * 1000,
                          tax_rate_bps: Number(s.payload.taxRate || 0) * 100,
                          vendor_id: s.payload.vendorId,
                        })
                      }
                    >
                      Edit submission
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        {!rows.some(s => s.status === status && !s.deleted_at) && (
          <div className="ow-empty">
            <CheckCircle2 size={28} />
            <strong>
              {status === 'Pending'
                ? 'All caught up'
                : 'No ' + status.toLowerCase() + ' submissions'}
            </strong>
            <span>
              {status === 'Pending'
                ? 'New product submissions will appear here.'
                : 'Review history will appear here.'}
            </span>
          </div>
        )}
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={v => {
          if (!busy && !v) setSelected(null);
        }}
      >
        <DialogContent className="ow-dialog">
          <DialogTitle>Review {selected?.payload.name}</DialogTitle>
          <DialogDescription>
            Only the quantity physically received and checked becomes available to customers.
          </DialogDescription>
          {selected && (
            <form
              onSubmit={e => {
                e.preventDefault();
                review('approve');
              }}
            >
              {selected.has_image && (
                <img
                  className="ow-review-photo"
                  src={'/api/submission-images/' + selected.id}
                  alt={selected.payload.name}
                />
              )}
              <div className="ow-details">
                <div>
                  <span>Category</span>
                  <b>{selected.payload.category}</b>
                </div>
                <div>
                  <span>Barcode</span>
                  <b>{selected.payload.barcode || 'Not provided'}</b>
                </div>
                <div>
                  <span>Submitted by</span>
                  <b>{selected.submitted_name}</b>
                </div>
                <div>
                  <span>Supplier availability</span>
                  <b>{selected.payload.vendorAvailable || 0} units</b>
                </div>
                <div>
                  <span>Supplier</span>
                  <b>{selected.vendor_name || 'Store stock'}</b>
                </div>
                <div>
                  <span>Brand / pack</span>
                  <b>
                    {selected.payload.brand || '—'} · {selected.payload.packSize || '—'}
                  </b>
                </div>
                <div>
                  <span>Unit / tax</span>
                  <b>
                    {selected.payload.unit || 'piece'} · {selected.payload.taxRate || 0}%
                  </b>
                </div>
                <div>
                  <span>Shelf / reorder</span>
                  <b>
                    {selected.payload.location || '—'} · {selected.payload.reorder || 0} units
                  </b>
                </div>
              </div>
              {selected.payload.description && (
                <p className="ow-product-description">{selected.payload.description}</p>
              )}
              <div className="ow-form-grid">
                {[
                  ['cost', 'Purchase price (Rs)'],
                  ['price', 'Sale price (Rs)'],
                  ['receivedQty', 'Verified received units'],
                  ['paid', 'Supplier payment (Rs)'],
                ].map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      required
                      type="number"
                      min="0"
                      step={key === 'receivedQty' ? '1' : '0.01'}
                      value={form[key]}
                      onChange={e => setForm({ ...form, [key]: e.target.value })}
                    />
                  </label>
                ))}
                <label>
                  Supplier invoice
                  <input
                    value={form.invoice}
                    onChange={e => setForm({ ...form, invoice: e.target.value })}
                  />
                </label>
                <label>
                  Payment method
                  <select
                    value={form.method}
                    onChange={e => setForm({ ...form, method: e.target.value })}
                  >
                    {['Cash', 'Card', 'Bank transfer'].map(x => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="ow-note">
                Review / correction note
                <textarea
                  value={form.note}
                  onChange={e => setForm({ ...form, note: e.target.value })}
                  placeholder="Required when returning for correction"
                />
              </label>
              <label className="ow-check">
                <input
                  type="checkbox"
                  checked={form.verified}
                  onChange={e => setForm({ ...form, verified: e.target.checked })}
                />
                <span>I verified the product, prices and received quantity.</span>
              </label>
              {error && <p className="ow-error">{error}</p>}
              <div className="ow-actions">
                <button type="button" disabled={busy} onClick={() => review('return')}>
                  <RotateCcw size={16} /> Return for correction
                </button>
                <button className="ow-primary" type="submit" disabled={busy || !form.verified}>
                  <ShieldCheck size={16} />
                  {busy ? 'Saving…' : 'Approve & publish'}
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
export function ShiftDesk({ owner = false }) {
  const [data, setData] = useState({ shifts: [], current: null }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [opening, setOpening] = useState('0'),
    [counted, setCounted] = useState(''),
    [note, setNote] = useState(''),
    [message, setMessage] = useState('');
  const load = useCallback(async () => {
    try {
      setData(await get('/shifts'));
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/shifts/' + (data.current ? 'close' : 'open'), { opening, counted, note });
      setMessage(
        data.current
          ? 'Shift closed. Cash reconciliation saved for the owner.'
          : 'Your counter shift is open. You can start billing.'
      );
      setCounted('');
      setNote('');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ow-panel ow-shift">
      <div className="ow-heading">
        <span className="ow-symbol">
          <Wallet size={22} />
        </span>
        <div>
          <h2>{owner ? 'Counter accountability' : 'My counter shift'}</h2>
          <p>
            {owner
              ? 'Each staff member has a separate sales and cash record.'
              : 'Open with your cash float. Close with the cash you counted.'}
          </p>
        </div>
        <span className="ow-badge approved">
          <UserRound size={14} />
          {owner
            ? data.shifts.filter(x => !x.closed_at).length + ' counters open'
            : data.current
              ? 'Shift open'
              : 'Shift closed'}
        </span>
      </div>
      {message && <p className="ow-success">{message}</p>}
      {error && <p className="ow-error">{error}</p>}
      {!owner && (
        <>
          <div className="ow-metrics">
            <div>
              <span>Opening cash</span>
              <b>{money(Number(data.current?.opening_paisa || 0))}</b>
            </div>
            <div>
              <span>Shift sales</span>
              <b>{money(Number(data.current?.sales_paisa || 0))}</b>
            </div>
            <div>
              <span>Expected cash</span>
              <b>{money(Number(data.current?.expected_paisa || 0))}</b>
            </div>
          </div>
          <form className="ow-shift-form" onSubmit={submit}>
            <label>
              {data.current ? 'Counted drawer cash (Rs)' : 'Opening drawer cash (Rs)'}
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={data.current ? counted : opening}
                onChange={e =>
                  data.current ? setCounted(e.target.value) : setOpening(e.target.value)
                }
              />
            </label>
            <label>
              Note / cash difference
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Explain any shortage or surplus"
              />
            </label>
            <button className="ow-primary" disabled={busy}>
              <Clock3 size={17} />
              {busy ? 'Saving…' : data.current ? 'Close & reconcile shift' : 'Open my shift'}
            </button>
          </form>
        </>
      )}
      <div className="ow-table-wrap">
        <table className="ow-table">
          <thead>
            <tr>
              <th>{owner ? 'Staff' : 'Opened'}</th>
              <th>Sales / bills</th>
              <th>Expected cash</th>
              <th>Counted cash</th>
              <th>Difference</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.shifts.map(s => (
              <tr key={s.id}>
                <td>
                  <strong>{owner ? s.staff_name : new Date(s.opened_at).toLocaleString()}</strong>
                  {owner && <small>{new Date(s.opened_at).toLocaleString()}</small>}
                  {s.note && <small>{s.note}</small>}
                </td>
                <td>
                  {money(Number(s.sales_paisa))}
                  <small>{s.bills} bills</small>
                </td>
                <td>{money(Number(s.expected_paisa))}</td>
                <td>{s.closed_at ? money(Number(s.counted_paisa)) : '—'}</td>
                <td>
                  <span className={Number(s.variance_paisa) ? 'ow-error-text' : ''}>
                    {s.closed_at ? money(Number(s.variance_paisa)) : '—'}
                  </span>
                </td>
                <td>
                  <span className={'ow-badge ' + (s.closed_at ? 'approved' : 'pending')}>
                    {s.closed_at ? 'Closed' : 'Open'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.shifts.length && <p className="ow-empty">No counter shifts yet.</p>}
      </div>
      {!!data.receipts?.length && (
        <div className="ow-counter-bills">
          <h3>Recent counter bills</h3>
          <div className="ow-table-wrap">
            <table className="ow-table">
              <thead>
                <tr>
                  <th>Invoice / date</th>
                  <th>Customer</th>
                  <th>Cashier</th>
                  <th>Payment</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.receipts.map(r => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.id}</strong>
                      <small>{new Date(r.created_at).toLocaleString()}</small>
                    </td>
                    <td>{r.customer || 'Walk-in customer'}</td>
                    <td>{r.cashier_name}</td>
                    <td>{r.payment}</td>
                    <td>{money(Number(r.total_paisa))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
