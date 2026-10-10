import React, { useEffect, useState } from 'react';
import { CheckCircle2, Search, Store, Mail, Phone, MapPin, UserRound } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { get, post, seg } from './lib/api.js';
import { formatPaisa as money, formatQty, formatDate, lineTotalPaisa } from './lib/money.js';
import './vendor.css';
import './vendor-admin.css';
const amount = p => lineTotalPaisa(p.qty_milli, p.unit_cost_paisa);
const EMPTY_ACCOUNT = {
  ledger: { entries: [], summary: {} },
  purchases: [],
  payments: [],
  returns: [],
  sales: [],
};
// Owner's vendor workspace. Supplier history comes from /vendors/:id/account so balances never depend on the
// admin's windowed working set.
export default function VendorManagement({
  vendors,
  products = [],
  accounts = [],
  onChanged,
  onEditVendor,
  renderCatalog,
}) {
  const [requests, setRequests] = useState([]),
    [selected, setSelected] = useState(''),
    [account, setAccount] = useState(EMPTY_ACCOUNT),
    [tab, setTab] = useState('details'),
    [search, setSearch] = useState(''),
    [review, setReview] = useState(false),
    [success, setSuccess] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState({ method: 'Cash' }),
    [returnForm, setReturnForm] = useState({});
  async function loadApplications() {
    try {
      setRequests((await get('/vendor/applications')).applications);
    } catch (e) {
      setError(e.message);
    }
  }
  async function loadAccount(id = selected) {
    if (!id) return;
    try {
      const a = await get('/vendors/' + seg(id) + '/account');
      setAccount(a);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    loadApplications();
  }, []);
  useEffect(() => {
    setAccount(EMPTY_ACCOUNT);
    loadAccount(selected);
  }, [selected]);
  const vendor = vendors.find(v => v.id === selected),
    pending = requests.filter(a => a.status === 'Pending'),
    catalog = products.filter(p => p.vendor_id === selected),
    productName = id => products.find(p => p.id === id)?.name || 'Historical product',
    summary = account.ledger.summary,
    balance = Number(summary.balance || 0);
  function choose(id) {
    setSelected(id);
    setTab('details');
    setError('');
    setForm({ method: 'Cash' });
    setReturnForm({});
  }
  async function run(fn, after) {
    setBusy(true);
    setError('');
    try {
      const r = await fn();
      await after?.(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const approve = a =>
    run(
      () => post('/vendor/applications/' + seg(a.id) + '/approve'),
      async r => {
        await onChanged();
        await loadApplications();
        setReview(false);
        choose(r.vendorId);
        setSuccess({ name: a.business, email: r.email });
      }
    );
  const reject = a =>
    run(() => post('/vendor/applications/' + seg(a.id) + '/reject'), loadApplications);
  const record = e => {
    e.preventDefault();
    run(
      () => post('/vendor/payments', { ...form, vendorId: selected }),
      async () => {
        setForm({ method: 'Cash' });
        await loadAccount();
        await onChanged();
      }
    );
  };
  const recordReturn = e => {
    e.preventDefault();
    run(
      () => {
        if (!account.purchases.some(p => p.id === returnForm.purchaseId))
          throw Error('Choose a receipt for this vendor.');
        return post('/vendor/returns', returnForm);
      },
      async () => {
        setReturnForm({});
        await loadAccount();
        await onChanged();
      }
    );
  };
  const tabs = [
    ['details', 'Details'],
    ['products', 'Products'],
    ['purchases', 'Purchases'],
    ['sales', 'Sales'],
    ['payments', 'Payments & credit'],
    ['returns', 'Returns'],
    ['statement', 'Statement'],
  ];
  return (
    <div className="vh">
      <div className="vh-toolbar">
        <div>
          <Store size={23} />
          <strong>Vendor workspace</strong>
        </div>
        <label>
          <Search size={17} />
          <input
            placeholder="Find vendor by name or email"
            aria-label="Find vendor"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </label>
        <select aria-label="Select vendor" value={selected} onChange={e => choose(e.target.value)}>
          <option value="">Select a vendor</option>
          {vendors
            .filter(v => (v.name + ' ' + v.email).toLowerCase().includes(search.toLowerCase()))
            .map(v => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
        </select>
        <button
          className="primary"
          onClick={() => {
            setReview(true);
            setError('');
          }}
        >
          Applications <b>{pending.length}</b>
        </button>
      </div>
      {error && !review && (
        <p className="vh-error" role="alert">
          {error}
        </p>
      )}
      {!vendor ? (
        <section className="vh-empty">
          <Store size={42} />
          <h2>Choose a vendor to get started</h2>
          <p>All their details, products, purchases and payments appear together here.</p>
        </section>
      ) : (
        <>
          <section className="vh-profile">
            <div className="vh-avatar">
              <Store size={27} />
            </div>
            <div>
              <h2>{vendor.name}</h2>
              <p>
                {vendor.contact || 'Supplier'} · {vendor.email || 'No email added'}
              </p>
            </div>
            <button className="quiet" onClick={() => onEditVendor(vendor)}>
              Edit details
            </button>
          </section>
          <nav className="vh-tabs" aria-label="Vendor sections">
            {tabs.map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? 'active' : ''}
                onClick={() => {
                  setTab(id);
                  setError('');
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          {tab === 'details' && (
            <section className="vh-card">
              <h3>Business & account details</h3>
              <div className="vh-details">
                {[
                  [Store, 'Business name', vendor.name],
                  [UserRound, 'Contact person', vendor.contact],
                  [Mail, 'Email', vendor.email],
                  [Phone, 'Phone', vendor.phone],
                  [MapPin, 'Address', vendor.address],
                  [Store, 'Payment terms', vendor.terms],
                  [Store, 'Tax ID', vendor.tax_id],
                  [Mail, 'Portal login email', accounts.find(a => a.vendor_id === selected)?.email],
                  [
                    UserRound,
                    'Portal access',
                    accounts.some(a => a.vendor_id === selected && a.active)
                      ? 'Active vendor account'
                      : 'No active portal account',
                  ],
                ].map(([Icon, label, value]) => (
                  <div key={label}>
                    <Icon size={19} />
                    <div>
                      <small>{label}</small>
                      <strong>{value || 'Not added'}</strong>
                    </div>
                  </div>
                ))}
              </div>
              <div className="vh-summary">
                {[
                  ['Products', catalog.filter(p => !p.deleted_at).length],
                  ['Stock received', money(summary.supplied)],
                  [
                    'Payments & credits',
                    money(
                      (summary.paidAtReceipt || 0) +
                        (summary.paidLater || 0) +
                        (summary.returnCredit || 0)
                    ),
                  ],
                  [
                    balance < 0 ? 'Vendor owes store' : 'Outstanding balance',
                    money(Math.abs(balance)),
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <small>{label}</small>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}
          {tab === 'products' && renderCatalog(vendor)}
          {tab === 'purchases' && (
            <Table
              headings={['Date / invoice', 'Product', 'Quantity', 'Cost', 'Paid', 'Payment']}
              rows={account.purchases.map(p => [
                formatDate(p.created_at) + ' · ' + (p.invoice || 'No invoice'),
                productName(p.product_id),
                formatQty(p.qty_milli),
                money(amount(p)),
                money(p.payment === 'Paid' ? amount(p) : p.paid_paisa),
                p.payment,
              ])}
            />
          )}
          {tab === 'sales' && (
            <>
              <p className="vh-note">
                Customer sales of this vendor’s products. Supplier payments are recorded separately.
              </p>
              <Table
                headings={[
                  'Date / receipt',
                  'Product',
                  'Quantity',
                  'Payment',
                  'Unit sale price',
                  'Sales value',
                ]}
                rows={account.sales.map(s => [
                  formatDate(s.created_at) + ' · ' + s.receipt,
                  productName(s.product_id),
                  formatQty(s.qty_milli),
                  s.payment,
                  money(s.unit_price_paisa),
                  money(s.line_total_paisa),
                ])}
              />
            </>
          )}
          {tab === 'payments' && (
            <section className="vh-card">
              <div className="vh-summary">
                {[
                  ['Received stock', money(summary.supplied)],
                  ['Paid at receipt', money(summary.paidAtReceipt)],
                  ['Later payments', money(summary.paidLater)],
                  ['Return credits', money(summary.returnCredit)],
                  [balance < 0 ? 'Vendor owes store' : 'Balance due', money(Math.abs(balance))],
                ].map(([label, value]) => (
                  <div key={label}>
                    <small>{label}</small>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <h3>Record payment to {vendor.name}</h3>
              <form className="vh-form" onSubmit={record}>
                <label>
                  Amount (Rs)
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={form.amount || ''}
                    onChange={e => setForm({ ...form, amount: e.target.value })}
                  />
                </label>
                <label>
                  Method
                  <select
                    value={form.method}
                    onChange={e => setForm({ ...form, method: e.target.value })}
                  >
                    {['Cash', 'Bank transfer', 'Card'].map(m => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Reference
                  <input
                    value={form.reference || ''}
                    onChange={e => setForm({ ...form, reference: e.target.value })}
                  />
                </label>
                <button className="primary" disabled={busy || balance <= 0}>
                  Record payment
                </button>
              </form>
              <Table
                headings={['Date', 'Method', 'Reference', 'Amount']}
                rows={account.payments.map(p => [
                  formatDate(p.created_at),
                  p.method,
                  p.reference || '—',
                  money(p.amount_paisa),
                ])}
              />
            </section>
          )}
          {tab === 'returns' && (
            <section className="vh-card">
              <h3>Return stock to {vendor.name}</h3>
              <p className="vh-note">
                Available, unreserved stock only. Credit uses the original receipt cost.
              </p>
              <form className="vh-form" onSubmit={recordReturn}>
                <label>
                  Stock receipt
                  <select
                    required
                    value={returnForm.purchaseId || ''}
                    onChange={e => setReturnForm({ ...returnForm, purchaseId: e.target.value })}
                  >
                    <option value="">Choose this vendor’s receipt</option>
                    {account.purchases.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.invoice || p.id} · {productName(p.product_id)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Quantity
                  <input
                    required
                    type="number"
                    min="1"
                    step="1"
                    value={returnForm.qty || ''}
                    onChange={e => setReturnForm({ ...returnForm, qty: e.target.value })}
                  />
                </label>
                <label>
                  Reason
                  <input
                    required
                    value={returnForm.reason || ''}
                    onChange={e => setReturnForm({ ...returnForm, reason: e.target.value })}
                  />
                </label>
                <label>
                  Credit reference
                  <input
                    value={returnForm.reference || ''}
                    onChange={e => setReturnForm({ ...returnForm, reference: e.target.value })}
                  />
                </label>
                <button className="primary" disabled={busy || !account.purchases.length}>
                  Record return & credit
                </button>
              </form>
              <Table
                headings={['Date', 'Product', 'Quantity', 'Reason', 'Credit']}
                rows={account.returns.map(r => [
                  formatDate(r.created_at),
                  productName(r.product_id),
                  formatQty(r.qty_milli),
                  r.reason,
                  money(r.amount_paisa),
                ])}
              />
            </section>
          )}
          {tab === 'statement' && (
            <Table
              headings={[
                'Date',
                'Entry / reference',
                'Method',
                'Stock charges',
                'Payments / credits',
                'Running balance',
              ]}
              rows={account.ledger.entries.map(x => [
                formatDate(x.date),
                x.type + ' · ' + x.reference,
                x.method,
                x.debit ? money(x.debit) : '—',
                x.credit ? money(x.credit) : '—',
                money(x.balance),
              ])}
            />
          )}
        </>
      )}
      <Dialog
        open={review}
        onOpenChange={v => {
          if (!busy) setReview(v);
        }}
      >
        <DialogContent className="vh-dialog">
          <DialogTitle>Vendor applications</DialogTitle>
          <DialogDescription>
            Review business details. Vendors choose their own passwords; approval activates their
            account.
          </DialogDescription>
          {error && (
            <p className="vh-error" role="alert">
              {error}
            </p>
          )}
          {!pending.length && <p>No pending applications.</p>}
          {pending.map(a => (
            <article className="vh-application" key={a.id}>
              <h3>{a.business}</h3>
              <dl>
                {[
                  ['Contact', a.contact],
                  ['Email', a.email],
                  ['Phone', a.phone],
                  ['Address', a.address],
                  ['Products supplied', a.note],
                ].map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt>{k}</dt>
                    <dd>{v || 'Not added'}</dd>
                  </React.Fragment>
                ))}
              </dl>
              {!a.password_ready && (
                <p className="vh-error">
                  Older request: reject this application and ask the vendor to reapply with their
                  own password.
                </p>
              )}
              <div>
                <button
                  className="primary"
                  disabled={busy || !a.password_ready}
                  onClick={() => approve(a)}
                >
                  Approve vendor
                </button>
                <button className="quiet" disabled={busy} onClick={() => reject(a)}>
                  Reject
                </button>
              </div>
            </article>
          ))}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(success)}
        onOpenChange={v => {
          if (!v) setSuccess(null);
        }}
      >
        <DialogContent className="vh-success">
          <CheckCircle2 size={54} />
          <DialogTitle>Vendor approved successfully</DialogTitle>
          <DialogDescription>
            <strong>{success?.name}</strong> is ready to supply Star Mart. They can sign in at
            /vendor with <strong>{success?.email}</strong> and their own password.
          </DialogDescription>
          <button className="primary" onClick={() => setSuccess(null)}>
            Open vendor workspace
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function Table({ headings, rows }) {
  return (
    <div className="vh-table">
      <table>
        <thead>
          <tr>
            {headings.map(h => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p>No records for this vendor yet.</p>}
    </div>
  );
}
