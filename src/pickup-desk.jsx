import React, { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ShoppingBag, CheckCircle2 } from 'lucide-react';
import { post, seg } from './lib/api.js';
import { formatPaisa as money, formatQty } from './lib/money.js';
const METHODS = [
  'Cash on pickup',
  'POS card on pickup',
  'JazzCash transfer',
  'Easypaisa transfer',
  'Bank transfer',
];
export default function PickupDesk({ orders, onComplete, onError }) {
  const [order, setOrder] = useState(null),
    [method, setMethod] = useState('Cash on pickup'),
    [received, setReceived] = useState(''),
    [reference, setReference] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = orders.filter(o => o.fulfillment === 'Pickup' && o.status === 'Pending');
  function open(o) {
    setOrder(o);
    setMethod(METHODS.includes(o.payment_method) ? o.payment_method : 'Cash on pickup');
    setReceived(String(Number(o.total_paisa) / 100));
    setReference('');
    setError('');
  }
  async function close(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const j = await post('/orders/' + seg(order.id) + '/ClosePickup', {
        paymentCollected: true,
        paymentMethod: method,
        received,
        verifiedReference: reference,
      });
      setOrder(null);
      await onComplete(j.receipt);
    } catch (e) {
      setError(e.message);
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card pickup-desk">
      <div className="card-title">
        <div>
          <span className="eyebrow">STORE COLLECTION</span>
          <h2>Collect a pickup order</h2>
          <p>Receive payment and hand over the groceries. This closes the sale immediately.</p>
        </div>
        <ShoppingBag size={24} />
      </div>
      {pending.length ? (
        <div className="pickup-list">
          {pending.map(o => (
            <article key={o.id}>
              <div>
                <strong>{o.customer_name}</strong>
                <small>
                  {o.id} · {o.customer_phone}
                </small>
                <small>
                  {o.items.map(i => i.name + ' × ' + formatQty(i.qty_milli)).join(', ')}
                </small>
              </div>
              <b>{money(o.total_paisa)}</b>
              <button className="primary" onClick={() => open(o)}>
                Receive payment
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p>No pickup orders waiting for collection.</p>
      )}
      <Dialog
        open={!!order}
        onOpenChange={v => {
          if (!v && !busy) setOrder(null);
        }}
      >
        {order && (
          <DialogContent className="pickup-payment">
            <DialogTitle>Close pickup sale</DialogTitle>
            <DialogDescription>
              {order.customer_name} · {order.id}
            </DialogDescription>
            <form onSubmit={close}>
              <div className="pickup-total">
                Total due <strong>{money(order.total_paisa)}</strong>
              </div>
              <label>
                Actual payment method
                <select value={method} onChange={e => setMethod(e.target.value)}>
                  {METHODS.map(v => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Amount received (Rs)
                <input
                  type="number"
                  required
                  min={Number(order.total_paisa) / 100}
                  step="0.01"
                  value={received}
                  onChange={e => setReceived(e.target.value)}
                />
              </label>
              {method.includes('transfer') && (
                <label>
                  Verified transaction reference
                  <input required value={reference} onChange={e => setReference(e.target.value)} />
                </label>
              )}
              <p>
                Press only after payment is collected and groceries are handed over. Receipt, stock,
                sales and eligible points update together.
              </p>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button className="primary full" disabled={busy}>
                <CheckCircle2 size={18} />
                {busy ? 'Closing sale…' : 'Payment received · Close sale'}
              </button>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
