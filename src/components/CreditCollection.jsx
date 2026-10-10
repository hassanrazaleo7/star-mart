import React, { useState } from 'react';
import { post } from '../lib/api.js';
import { formatPaisa } from '../lib/money.js';
// One row per unpaid bill, each with its own amount so a value typed for one bill never posts against another.
function CreditRow({ bill, customerId, onPaid, onError }) {
  const [amount, setAmount] = useState(''),
    [method, setMethod] = useState('Cash'),
    [busy, setBusy] = useState(false);
  const valid = Number(amount) > 0 && Math.round(Number(amount) * 100) <= bill.duePaisa;
  async function pay() {
    if (!valid) {
      onError('Enter an amount up to ' + formatPaisa(bill.duePaisa) + '.');
      return;
    }
    setBusy(true);
    try {
      const r = await post('/customers/credit-payment', {
        customerId,
        receiptId: bill.id,
        amount,
        method,
      });
      setAmount('');
      await onPaid(r);
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="credit-line">
      <div>
        <strong>{bill.id}</strong>
        <small>Due {formatPaisa(bill.duePaisa)}</small>
      </div>
      <input
        type="number"
        min="0.01"
        step="0.01"
        max={bill.duePaisa / 100}
        value={amount}
        onChange={e => setAmount(e.target.value)}
        placeholder="Rs amount"
        aria-label={'Payment amount for ' + bill.id}
      />
      <select value={method} onChange={e => setMethod(e.target.value)} aria-label="Payment method">
        <option>Cash</option>
        <option>Card</option>
        <option>Bank transfer</option>
      </select>
      <button disabled={busy || !valid} onClick={pay}>
        {busy ? 'Saving…' : 'Record payment'}
      </button>
    </div>
  );
}
export default function CreditCollection({ customerId, info, reload, flash, setError }) {
  const bills = info?.bills.filter(b => b.duePaisa > 0) || [];
  return (
    <div className="pos-credit">
      <h3>Collect customer credit</h3>
      {bills.length ? (
        bills.map(b => (
          <CreditRow
            key={b.id}
            bill={b}
            customerId={customerId}
            onError={setError}
            onPaid={async r => {
              await reload();
              flash('Credit payment recorded. Remaining: ' + formatPaisa(r.remainingPaisa));
            }}
          />
        ))
      ) : (
        <p>No unpaid credit bills for this customer.</p>
      )}
    </div>
  );
}
