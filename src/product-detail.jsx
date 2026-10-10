import React, { useEffect, useRef, useState } from 'react';
import { X, ShoppingBag, CheckCircle2 } from 'lucide-react';
import { get, seg } from './lib/api.js';
import { formatPaisa as money } from './lib/money.js';
import './product-detail.css';
// Product dialog: shows the full description (fetched on demand) and lets the shopper set the cart quantity directly.
export default function ProductDetail({ product, quantity, onAdd, onQuantity, onCart, onClose }) {
  const close = useRef();
  const [draft, setDraft] = useState(String(quantity || 1)),
    [error, setError] = useState(''),
    [detail, setDetail] = useState(null);
  useEffect(() => setDraft(String(quantity || 1)), [quantity]);
  useEffect(() => {
    let active = true;
    if (product.description !== undefined) return;
    get('/public/products/' + seg(product.id))
      .then(r => active && setDetail(r.product))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [product.id]);
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus();
    const key = e => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const nodes = close.current
            ?.closest('[role="dialog"]')
            ?.querySelectorAll('button:not(:disabled),input'),
          first = nodes?.[0],
          last = nodes?.[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
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
      previous?.focus();
    };
  }, []);
  const available = Math.max(0, Math.floor(Number(product.stock_milli || 0) / 1000)),
    full = quantity >= available,
    description = product.description ?? detail?.description;
  function addDraft() {
    const n = Number(draft);
    if (!Number.isInteger(n) || n < 1 || n + quantity > available) {
      setError('Choose a whole quantity within available stock.');
      return;
    }
    if (onAdd(product.id, n)) setError('');
  }
  return (
    <div
      className="pd-overlay"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="pd-dialog" role="dialog" aria-modal="true" aria-labelledby="pd-title">
        <button
          ref={close}
          className="pd-close"
          aria-label="Close product details"
          onClick={onClose}
        >
          <X size={22} />
        </button>
        <div className="pd-image">
          {product.image ? (
            <img src={product.image} alt={product.name} />
          ) : (
            <ShoppingBag size={70} />
          )}
        </div>
        <div className="pd-content">
          <span className="pd-category">
            {product.category} · {product.brand || 'Star Mart'}
          </span>
          <h2 id="pd-title">{product.name}</h2>
          <p>{product.pack_size || product.unit}</p>
          <strong className="pd-price">{money(product.price_paisa)}</strong>
          <span className={'pd-stock ' + (!available ? 'empty' : '')}>
            {available ? available + ' available' : 'Currently out of stock'}
          </span>
          {description && <p className="pd-description">{description}</p>}
          {quantity > 0 && (
            <p className="pd-added" role="status">
              <CheckCircle2 size={17} /> {quantity} in your cart
            </p>
          )}
          {!available && (
            <p className="pd-description">
              This product can be ordered once Star Mart receives more stock.
            </p>
          )}
          {available > 0 && (
            <label className="pd-quantity">
              {quantity > 0 ? 'Quantity in cart' : 'Quantity to add'}
              <div>
                <button
                  disabled={quantity > 0 ? quantity <= 0 : Number(draft) <= 1}
                  onClick={() =>
                    quantity > 0
                      ? onQuantity(Math.max(0, quantity - 1))
                      : setDraft(String(Math.max(1, Number(draft || 1) - 1)))
                  }
                  aria-label="Reduce quantity"
                >
                  −
                </button>
                <input
                  type="number"
                  min={quantity > 0 ? 0 : 1}
                  max={available}
                  step="1"
                  value={draft}
                  onChange={e => {
                    setDraft(e.target.value);
                    setError('');
                  }}
                  onBlur={() => {
                    if (quantity <= 0) return;
                    const n = Number(draft);
                    if (draft === '' || !Number.isInteger(n) || n < 0 || n > available) {
                      setError('Enter a whole quantity from 0 to ' + available);
                      setDraft(String(quantity));
                      return;
                    }
                    onQuantity(n);
                  }}
                  aria-label={quantity > 0 ? 'Quantity in cart' : 'Quantity to add'}
                />
                <button
                  disabled={quantity > 0 ? full : Number(draft) >= available}
                  onClick={() =>
                    quantity > 0
                      ? onQuantity(quantity + 1)
                      : setDraft(String(Number(draft || 0) + 1))
                  }
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
              {quantity > 0 && <small>Enter quantity directly. Zero removes this product.</small>}
              {error && <small role="alert">{error}</small>}
            </label>
          )}
          {quantity <= 0 && (
            <button className="pd-add" disabled={!available} onClick={addDraft}>
              {!available ? 'Out of stock' : 'Add to cart'}
            </button>
          )}
          {quantity > 0 && (
            <button className="pd-view" onClick={onCart}>
              View cart & checkout →
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
