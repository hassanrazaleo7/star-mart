import React, { useState, useEffect, useRef } from 'react';
import {
  ShoppingBag,
  Truck,
  Store,
  CreditCard,
  Banknote,
  Wallet,
  CheckCircle2,
  ArrowLeft,
  Trash2,
  X,
  ShieldCheck,
  MessageCircle,
} from 'lucide-react';
import './store-checkout.css';
const money = n =>
  'Rs ' + (Number(n || 0) / 100).toLocaleString('en-PK', { maximumFractionDigits: 2 });
export default function StoreCheckout({
  items,
  total,
  busy,
  error,
  user,
  name,
  setName,
  phone,
  setPhone,
  fulfillment,
  setFulfillment,
  address,
  setAddress,
  note,
  setNote,
  paymentMethod,
  setPaymentMethod,
  paymentReference,
  setPaymentReference,
  adjust,
  remove,
  onClose,
  onSubmit,
  onWhatsApp,
}) {
  const [store, setStore] = useState(null);
  useEffect(() => {
    fetch('/api/public/settings')
      .then(r => r.json())
      .then(setStore)
      .catch(() => {});
  }, []);
  const [step, setStep] = useState(0),
    [validation, setValidation] = useState('');
  const panel = useRef(null);
  useEffect(() => {
    const before = document.activeElement;
    panel.current?.focus();
    const key = e => {
      if (e.key === 'Escape' && !busy) onClose();
      if (e.key === 'Tab') {
        const nodes = Array.from(
          panel.current?.querySelectorAll('button:not(:disabled),input,select,textarea,a[href]') ||
            []
        ).filter(n => n.getClientRects().length);
        let first = nodes[0],
          last = nodes.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === panel.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      before?.focus();
    };
  }, [busy]);
  const transfer = ['JazzCash transfer', 'Easypaisa transfer', 'Bank transfer'].includes(
      paymentMethod
    ),
    env = import.meta.env;
  const details =
    paymentMethod === 'JazzCash transfer'
      ? store?.jazzcash
      : paymentMethod === 'Easypaisa transfer'
        ? store?.easypaisa
        : store?.bank;
  const methods = [
    {
      value: fulfillment === 'Delivery' ? 'Cash on delivery' : 'Cash on pickup',
      label: fulfillment === 'Delivery' ? 'Cash on delivery' : 'Cash at store',
      description: 'Pay when you receive your groceries.',
      Icon: Banknote,
    },
    {
      value: fulfillment === 'Delivery' ? 'POS card on delivery' : 'POS card on pickup',
      label: 'Debit / credit card',
      description:
        fulfillment === 'Delivery'
          ? 'Pay on a POS machine on delivery. Store will confirm availability.'
          : 'Pay on the POS machine when collecting at Star Mart.',
      Icon: CreditCard,
    },
    {
      value: 'Easypaisa transfer',
      label: 'Advance · Easypaisa',
      description: 'Transfer to the official store account.',
      Icon: Wallet,
    },
    {
      value: 'JazzCash transfer',
      label: 'Advance · JazzCash',
      description: 'Transfer to the official store account.',
      Icon: Wallet,
    },
    {
      value: 'Bank transfer',
      label: 'Advance · Bank transfer',
      description: 'Pay into the official store bank account.',
      Icon: CreditCard,
    },
  ].filter(
    x =>
      !x.value.includes('transfer') ||
      Boolean(
        x.value === 'JazzCash transfer'
          ? store?.jazzcash
          : x.value === 'Easypaisa transfer'
            ? store?.easypaisa
            : store?.bank
      )
  );
  function next() {
    setValidation('');
    if (step === 2 && !methods.some(x => x.value === paymentMethod)) {
      setValidation('Choose an available payment method.');
      return;
    }
    if (!items.length) return;
    if (step === 1) {
      if (!(name || user?.displayName || user?.name || '').trim()) {
        setValidation('Enter your name.');
        return;
      }
      if (!/^\+?[\d\s()-]{7,20}$/.test((phone || user?.phoneNumber || user?.phone || '').trim())) {
        setValidation('Enter a valid mobile number, e.g. 0300 1234567.');
        return;
      }
      if (fulfillment === 'Delivery' && !address.trim()) {
        setValidation('Enter your delivery address.');
        return;
      }
    }
    if (step === 2 && transfer && !paymentReference.trim()) {
      setValidation('Enter your payment transaction reference.');
      return;
    }
    setStep(x => Math.min(3, x + 1));
  }
  return (
    <div
      className="sc-overlay"
      onMouseDown={e => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={panel}
        tabIndex={-1}
        className="sc-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sc-title"
      >
        <header className="sc-header">
          <div>
            <span>STAR MART · SECURE ORDER</span>
            <h2 id="sc-title">
              {
                ['Your shopping cart', 'Delivery details', 'Choose payment', 'Review your order'][
                  step
                ]
              }
            </h2>
          </div>
          <button disabled={busy} aria-label="Close checkout" onClick={onClose}>
            <X size={22} />
          </button>
        </header>
        <div className="sc-steps">
          {['Cart', 'Delivery', 'Payment', 'Review'].map((label, i) => (
            <span key={label} className={step === i ? 'current' : step > i ? 'done' : ''}>
              <b>{step > i ? '✓' : i + 1}</b>
              {label}
            </span>
          ))}
        </div>
        <div className="sc-layout">
          <main className="sc-body">
            {!items.length ? (
              <div className="sc-empty">
                <ShoppingBag size={44} />
                <h3>Your cart is empty</h3>
                <p>Add your favourite groceries to get started.</p>
                <button className="sc-primary" onClick={onClose}>
                  Continue shopping
                </button>
              </div>
            ) : (
              <>
                {step === 0 &&
                  items.map(({ p, quantity }) => (
                    <article className="sc-item" key={p.id}>
                      {p.image ? (
                        <img src={p.image} alt={p.name} />
                      ) : (
                        <div className="sc-placeholder">
                          <ShoppingBag />
                        </div>
                      )}
                      <div className="sc-item-info">
                        <strong>{p.name}</strong>
                        <small>
                          {p.pack_size || p.unit} · {money(p.price_paisa)} each
                        </small>
                        <div className="sc-quantity">
                          <button
                            disabled={busy}
                            aria-label={'Reduce ' + p.name}
                            onClick={() => adjust(p.id, -1)}
                          >
                            −
                          </button>
                          <b>{quantity}</b>
                          <button
                            disabled={busy || quantity + 1 > Number(p.stock_milli) / 1000}
                            aria-label={'Increase ' + p.name}
                            onClick={() => adjust(p.id, 1)}
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <div className="sc-item-price">
                        <strong>{money(Number(p.price_paisa) * quantity)}</strong>
                        <button
                          disabled={busy}
                          onClick={() => remove(p.id)}
                          aria-label={'Remove ' + p.name}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </article>
                  ))}
                {step === 1 && (
                  <div className="sc-fields">
                    <div className="sc-choice-row">
                      {[
                        ['Delivery', 'Home delivery', Truck],
                        ['Pickup', 'Collect at store', Store],
                      ].map(([value, label, Icon]) => (
                        <button
                          key={value}
                          className={fulfillment === value ? 'selected' : ''}
                          onClick={() => {
                            setFulfillment(value);
                            setPaymentMethod(
                              value === 'Delivery' ? 'Cash on delivery' : 'Cash on pickup'
                            );
                            setPaymentReference('');
                          }}
                        >
                          <Icon size={22} />
                          <strong>{label}</strong>
                        </button>
                      ))}
                    </div>
                    <label>
                      Full name
                      <input
                        autoComplete="name"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Your full name"
                      />
                    </label>
                    <label>
                      Mobile number
                      <input
                        type="tel"
                        autoComplete="tel"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        placeholder="0300 1234567"
                      />
                    </label>
                    {fulfillment === 'Delivery' ? (
                      <label>
                        Full delivery address
                        <textarea
                          autoComplete="street-address"
                          value={address}
                          onChange={e => setAddress(e.target.value)}
                          placeholder="House / flat, street, area and city"
                          rows={3}
                        />
                      </label>
                    ) : (
                      <p className="sc-info">
                        Collect from Star Mart after the store confirms your order is ready.
                      </p>
                    )}
                    <label>
                      Delivery / order instructions <small>(optional)</small>
                      <textarea
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Landmark or any instructions for the store"
                        rows={2}
                      />
                    </label>
                    <p className="sc-info">
                      {store?.deliveryNote ||
                        'The store confirms delivery coverage and timing before dispatch.'}{' '}
                      No delivery fee is included in this order total.
                    </p>
                  </div>
                )}
                {step === 2 && (
                  <div className="sc-payments">
                    <h3>Pay on collection or in advance</h3>
                    <p className="sc-info">
                      Cash / card when you receive your order, or pay the full grocery total in
                      advance using an official store account.
                    </p>
                    {methods.map(({ value, label, description, Icon }) => (
                      <button
                        key={value}
                        className={paymentMethod === value ? 'selected' : ''}
                        onClick={() => {
                          setPaymentMethod(value);
                          setPaymentReference('');
                          setValidation('');
                        }}
                      >
                        <Icon size={25} />
                        <span>
                          <strong>{label}</strong>
                          <small>{description}</small>
                        </span>
                        <i>{paymentMethod === value ? '●' : '○'}</i>
                      </button>
                    ))}
                    {transfer && (
                      <div className="sc-fields sc-transfer">
                        <h3>Pay in advance · {paymentMethod.replace(' transfer', '')}</h3>
                        {details ? (
                          <p className="sc-account">
                            {store?.accountName || 'Star Mart'}
                            <br />
                            <strong>{details}</strong>
                            <br />
                            Transfer exactly {money(total)}.
                          </p>
                        ) : (
                          <p className="sc-info">
                            Get the official {paymentMethod.replace(' transfer', '')} account
                            details from Star Mart before transferring. Payment details have not
                            been configured yet.
                          </p>
                        )}
                        <label>
                          Transaction reference
                          <input
                            value={paymentReference}
                            onChange={e => setPaymentReference(e.target.value)}
                            placeholder="Transaction ID from your payment receipt"
                            maxLength={120}
                          />
                        </label>
                        <small>Your payment stays pending until Star Mart verifies receipt.</small>
                      </div>
                    )}
                  </div>
                )}
                {step === 3 && (
                  <div className="sc-review">
                    <h3>Items in your order</h3>
                    {items.map(({ p, quantity }) => (
                      <div className="sc-review-line" key={p.id}>
                        <span>
                          {p.name} × {quantity}
                        </span>
                        <strong>{money(Number(p.price_paisa) * quantity)}</strong>
                      </div>
                    ))}
                    <h3>{fulfillment === 'Delivery' ? 'Deliver to' : 'Store pickup'}</h3>
                    <p>
                      {name}
                      <br />
                      {phone}
                      {fulfillment === 'Delivery' && (
                        <>
                          <br />
                          {address}
                        </>
                      )}
                    </p>
                    <h3>Payment</h3>
                    <p>
                      {paymentMethod}
                      {transfer && (
                        <>
                          <br />
                          Reference: {paymentReference}
                          <br />
                          Awaiting store verification
                        </>
                      )}
                    </p>
                    {note && (
                      <>
                        <h3>Instructions</h3>
                        <p>{note}</p>
                      </>
                    )}
                    <p className="sc-info">
                      Please check your details. Placing this order does not charge a card or
                      wallet. Choose normal checkout or the separate WhatsApp button below.
                      Transfers remain unverified until the store checks them.
                    </p>
                  </div>
                )}
                {(validation || error) && (
                  <p className="sc-error" role="alert">
                    {validation || error}
                  </p>
                )}
              </>
            )}
          </main>
          <aside className="sc-summary">
            <h3>Order summary</h3>
            <div>
              <span>Items</span>
              <strong>{items.reduce((n, x) => n + x.quantity, 0)}</strong>
            </div>
            <div>
              <span>Groceries subtotal</span>
              <strong>{money(total)}</strong>
            </div>
            <div>
              <span>Delivery fee</span>
              <strong>Not included</strong>
            </div>
            <div className="sc-total">
              <span>Order total</span>
              <strong>{money(total)}</strong>
            </div>
            <p>
              <ShieldCheck size={17} /> Prices and stock are checked again when you place the order.
            </p>
            {items.length > 0 && (
              <>
                <button
                  className="sc-primary"
                  disabled={busy}
                  onClick={step === 3 ? onSubmit : next}
                >
                  {busy
                    ? 'Saving order…'
                    : step === 3
                      ? user
                        ? 'Place order · ' + money(total)
                        : 'Sign in to place order'
                      : ['Continue to delivery', 'Continue to payment', 'Review order'][step]}
                </button>
                {step === 3 && onWhatsApp && (
                  <button className="sc-whatsapp" disabled={busy} onClick={onWhatsApp}>
                    <MessageCircle size={18} /> Order on WhatsApp
                  </button>
                )}
                {step > 0 && (
                  <button
                    className="sc-back"
                    disabled={busy}
                    onClick={() => {
                      setValidation('');
                      setStep(x => x - 1);
                    }}
                  >
                    <ArrowLeft size={16} /> Back
                  </button>
                )}
              </>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
export function OrderConfirmation({ order, onClose }) {
  const whatsapp = order.channel === 'whatsapp';
  return (
    <div className="sc-overlay">
      <section
        className="sc-confirmation"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sc-confirm-title"
      >
        <CheckCircle2 size={58} />
        <h2 id="sc-confirm-title">{whatsapp ? 'Order saved!' : 'Order placed!'}</h2>
        <p>
          {whatsapp
            ? 'Send your basket to Star Mart on WhatsApp to confirm.'
            : 'Thank you for shopping with Star Mart.'}
        </p>
        <strong className="sc-order-number">{order.id}</strong>
        <div className="sc-review-line">
          <span>Groceries total</span>
          <strong>{money(order.total)}</strong>
        </div>
        <p>
          {order.fulfillment === 'Pickup' ? 'Self Pickup' : 'Delivery'} · {order.paymentMethod}
          <br />
          {order.paymentStatus}
        </p>
        <p>The store will confirm your order, payment and delivery charges.</p>
        {whatsapp && order.whatsappUrl && (
          <a
            className="sc-primary"
            href={order.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle size={19} /> Send order on WhatsApp
          </a>
        )}
        {!order.guest && (
          <a className={whatsapp ? 'sc-back' : 'sc-primary'} href="/account">
            View my orders
          </a>
        )}
        <button className="sc-back" onClick={onClose}>
          Continue shopping
        </button>
      </section>
    </div>
  );
}
