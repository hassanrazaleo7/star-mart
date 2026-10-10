import React, { useEffect, useRef, useState } from 'react';
import { X, ShoppingBag, CheckCircle2 } from 'lucide-react';
import './product-detail.css';
const money = n =>
  'Rs ' + (Number(n || 0) / 100).toLocaleString('en-PK', { maximumFractionDigits: 2 });
export default function ProductDetail({ product, quantity, onAdd, onQuantity, onCart, onClose }) {
  const close = useRef();
  const [draft, setDraft] = useState(String(quantity)),
    [error, setError] = useState('');
  useEffect(() => setDraft(String(quantity)), [quantity]);
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus();
    const key = e => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        let nodes = close.current
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
  let available = product.sample
      ? 10
      : Math.max(0, Math.floor(Number(product.stock_milli || 0) / 1000)),
    full = quantity >= available;
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
          {product.description && <p className="pd-description">{product.description}</p>}
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
          {quantity > 0 && (
            <label className="pd-quantity">
              Quantity in cart
              <div>
                <button
                  onClick={() => onQuantity(Math.max(0, quantity - 1))}
                  aria-label="Reduce quantity"
                >
                  −
                </button>
                <input
                  type="number"
                  min="0"
                  max={available}
                  step="1"
                  value={draft}
                  onChange={e => {
                    setDraft(e.target.value);
                    setError('');
                  }}
                  onBlur={() => {
                    let n = Number(draft);
                    if (draft === '' || !Number.isInteger(n) || n < 0 || n > available) {
                      setError('Enter a whole quantity from 0 to ' + available);
                      setDraft(String(quantity));
                      return;
                    }
                    onQuantity(n);
                  }}
                  aria-label="Quantity in cart"
                />
                <button
                  disabled={full}
                  onClick={() => onQuantity(quantity + 1)}
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
              <small>Enter quantity directly. Zero removes this product.</small>
              {error && <small role="alert">{error}</small>}
            </label>
          )}
          <button
            className="pd-add"
            disabled={!available || full}
            onClick={() => onAdd(product.id)}
          >
            {!available
              ? 'Out of stock'
              : full
                ? 'All available units are in your cart'
                : 'Add to cart'}
          </button>
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
