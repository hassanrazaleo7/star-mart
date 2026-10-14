import React, { useState } from 'react';
import { Search, PackagePlus, ClipboardCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { post, seg } from './lib/api.js';
import { formatQty } from './lib/money.js';
export default function StockPanel({ products, vendors, stock, onReceive, onRefresh }) {
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [supplier, setSupplier] = useState('all'),
    [selected, setSelected] = useState(null),
    [quantity, setQuantity] = useState(''),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const live = products.filter(p => !p.deleted_at),
    available = p => stock(p) - Number(p.reserved_milli || 0),
    low = p => available(p) <= Number(p.reorder_milli || 0);
  const shown = live.filter(
    p =>
      (p.name + ' ' + (p.barcode || '')).toLowerCase().includes(search.toLowerCase()) &&
      (supplier === 'all' || p.vendor_id === supplier) &&
      (filter === 'all' || (filter === 'low' && low(p)) || (filter === 'out' && available(p) <= 0))
  );
  async function save(e) {
    e.preventDefault();
    if (!Number.isInteger(Number(quantity)) || Number(quantity) < 0) {
      setError('Enter whole units: 0, 1, 2…');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await post('/products/' + seg(selected.id) + '/stock', { quantity, note });
      setSelected(null);
      setMessage('Physical stock count updated and recorded in the activity log.');
      await onRefresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ow-panel sm-stock-panel">
      <div className="ow-heading">
        <span className="ow-symbol">
          <ClipboardCheck size={22} />
        </span>
        <div>
          <h2>Stock control</h2>
          <p>
            Store stock and supplier availability are separate. Reserved units are already held for
            orders.
          </p>
        </div>
        <button
          className="ow-primary"
          onClick={() => onReceive(null, supplier === 'all' ? '' : supplier)}
        >
          <PackagePlus size={16} />
          Receive stock
        </button>
      </div>
      <div className="ow-metrics">
        <div>
          <span>Tracked products</span>
          <b>{live.length}</b>
        </div>
        <div>
          <span>Low stock products</span>
          <b>{live.filter(p => low(p) && available(p) > 0).length}</b>
        </div>
        <div>
          <span>Out of stock</span>
          <b>{live.filter(p => available(p) <= 0).length}</b>
        </div>
      </div>
      <div className="sm-stock-filters">
        <label>
          <Search size={17} />
          <input
            placeholder="Search product or barcode"
            aria-label="Search stock"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Stock vendor"
          value={supplier}
          onChange={e => setSupplier(e.target.value)}
        >
          <option value="all">All vendors</option>
          {vendors.map(v => (
            <option value={v.id} key={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <select aria-label="Stock status" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All stock</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </select>
      </div>
      {message && (
        <p className="ow-success" role="status">
          {message}
        </p>
      )}
      {error && !selected && (
        <p className="ow-error" role="alert">
          {error}
        </p>
      )}
      <div className="ow-table-wrap">
        <table className="ow-table">
          <thead>
            <tr>
              {[
                'Product',
                'Vendor',
                'In store',
                'Reserved',
                'Available',
                'Supplier stock',
                'Status',
                'Action',
              ].map(x => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(p => (
              <tr key={p.id}>
                <td>
                  <strong>{p.name}</strong>
                  <small>
                    {p.barcode || 'No barcode'} · {p.unit}
                  </small>
                </td>
                <td>{vendors.find(v => v.id === p.vendor_id)?.name || 'Store stock'}</td>
                <td>{formatQty(stock(p))}</td>
                <td>{formatQty(p.reserved_milli)}</td>
                <td>
                  <strong>{formatQty(available(p))}</strong>
                </td>
                <td>{formatQty(p.vendor_available_milli || 0)}</td>
                <td>
                  <span
                    className={'ow-badge ' + (available(p) > 0 && !low(p) ? 'approved' : 'pending')}
                  >
                    {p.review_status !== 'Approved'
                      ? 'Needs approval'
                      : available(p) <= 0
                        ? 'Out of stock'
                        : low(p)
                          ? 'Low stock'
                          : 'Available'}
                  </span>
                </td>
                <td>
                  <div className="sm-stock-actions">
                    <button disabled={p.review_status !== 'Approved'} onClick={() => onReceive(p)}>
                      Receive
                    </button>
                    <button
                      disabled={p.review_status !== 'Approved'}
                      onClick={() => {
                        setSelected(p);
                        setQuantity(String(stock(p) / 1000));
                        setNote('');
                        setError('');
                      }}
                    >
                      Set stock
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="ow-empty">No matching stock records.</p>}
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={v => {
          if (!v && !busy) setSelected(null);
        }}
      >
        <DialogContent className="ow-dialog">
          <DialogTitle>Set physical stock</DialogTitle>
          <DialogDescription>
            {selected?.name}. Enter the total counted in store, including reserved units.
          </DialogDescription>
          <form onSubmit={save}>
            <label className="ow-note">
              Counted units
              <input
                required
                type="number"
                min="0"
                step="1"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
              />
            </label>
            <label className="ow-note">
              Reason for correction
              <textarea
                required
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="e.g. Physical count after damaged packs"
              />
            </label>
            {error && <p className="ow-error">{error}</p>}
            <button className="ow-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save verified count'}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
