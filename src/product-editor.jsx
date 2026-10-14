import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Upload, PackageCheck } from 'lucide-react';
import { ProductBarcode } from './barcode-scanner.jsx';
import { GROCERY_CATEGORIES } from './grocery-categories.mjs';
import './product-editor.css';

// One small, shared product form for both owner and vendor. Extra operational fields stay optional.
export default function ProductEditor({
  form,
  setForm,
  photo,
  setPhoto,
  vendors = [],
  vendor = false,
  reviewerRequired = false,
  inventorySeparated = false,
  busy = false,
  storeStock = 0,
}) {
  const [preview, setPreview] = useState('');
  const input = useRef(null);
  useEffect(() => {
    if (!photo) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  const update = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const protectedProduct = false;
  const categoryOptions =
    form.category && !GROCERY_CATEGORIES.includes(form.category)
      ? [...GROCERY_CATEGORIES, form.category]
      : GROCERY_CATEGORIES;
  function field(
    key,
    label,
    { number = false, required = false, whole = false, locked = false, placeholder = '' } = {}
  ) {
    return (
      <label className="pe-field" key={key}>
        <span>
          {label}
          {required && <b aria-hidden="true"> *</b>}
        </span>
        <input
          aria-label={label}
          required={required}
          disabled={busy || locked}
          type={number ? 'number' : 'text'}
          inputMode={number ? (whole ? 'numeric' : 'decimal') : undefined}
          min={number ? '0' : undefined}
          step={number ? (whole ? '1' : '0.01') : undefined}
          value={form[key] ?? ''}
          placeholder={placeholder}
          onChange={e => update(key, e.target.value)}
        />
      </label>
    );
  }
  return (
    <div className="pe-editor">
      <div className="pe-photo-row">
        <button
          type="button"
          className="pe-photo"
          disabled={busy}
          onClick={() => input.current?.click()}
          aria-label="Upload product photo"
        >
          {preview || form.image ? (
            <img src={preview || form.image} alt="Product preview" />
          ) : (
            <ImagePlus size={32} />
          )}
          <span>
            <strong>{preview || form.image ? 'Change photo' : 'Add product photo'}</strong>
            <small>Choose from your phone or computer</small>
          </span>
          <Upload size={18} />
        </button>
        <input
          ref={input}
          className="pe-file"
          type="file"
          aria-label="Product image"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) setPhoto(file);
            e.target.value = '';
          }}
        />
        {photo && (
          <button
            className="pe-remove-photo"
            type="button"
            disabled={busy}
            onClick={() => setPhoto(null)}
          >
            Undo new photo
          </button>
        )}
      </div>
      <fieldset disabled={busy} className="pe-basics">
        <legend>Product essentials</legend>
        <div className="pe-grid">
          {field('name', 'Product name', {
            required: true,
            locked: protectedProduct,
            placeholder: 'e.g. Milk Pak 1 litre',
          })}
          <label className="pe-field">
            <span>
              Category <b aria-hidden="true">*</b>
            </span>
            <select
              aria-label="Category"
              required
              disabled={protectedProduct}
              value={form.category || ''}
              onChange={e => update('category', e.target.value)}
            >
              <option value="">Choose category</option>
              {categoryOptions.map(c => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {field('cost', vendor ? 'Supply price (Rs)' : 'Purchase price (Rs)', {
            number: true,
            required: true,
            locked: protectedProduct,
          })}
          {field('price', 'Selling price (Rs)', { number: true, required: true })}
          {!vendor &&
            !reviewerRequired &&
            !inventorySeparated &&
            !form.id &&
            field('opening', 'Stock in store', { number: true, whole: true, required: true })}
          {vendor &&
            field('vendorAvailable', 'Stock you can supply', {
              number: true,
              whole: true,
              required: true,
            })}
          {!vendor && (
            <label className="pe-field">
              <span>Supplier / vendor</span>
              <select
                aria-label="Supplier / vendor"
                value={form.vendorId || ''}
                onChange={e => update('vendorId', e.target.value)}
              >
                <option value="">Store’s own product</option>
                {vendors.map(v => (
                  <option value={v.id} key={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </fieldset>
      {!vendor && form.id && (
        <p className="pe-stock-note">
          <PackageCheck size={18} /> {storeStock} units in store. Open the Stock section to receive
          goods or update the physical stock count.
        </p>
      )}
      {(vendor || reviewerRequired) && (
        <p className="pe-stock-note">
          <PackageCheck size={18} /> Submitted details stay pending until the owner approves them.
          Only verified received stock can be sold.
        </p>
      )}
      <details className="pe-more">
        <summary>
          More details <span>Barcode, brand, pack size &amp; notes</span>
        </summary>
        <fieldset disabled={busy}>
          <div className={protectedProduct ? 'pe-barcode-locked' : ''}>
            {protectedProduct ? (
              <p className="pe-stock-note">
                Barcode: {form.barcode || 'Not set'} · Ask the owner to change a stocked product’s
                barcode.
              </p>
            ) : (
              <ProductBarcode value={form.barcode} onChange={code => update('barcode', code)} />
            )}
          </div>
          <div className="pe-grid">
            {field('brand', 'Brand', { placeholder: 'e.g. Nestlé' })}
            {field('packSize', 'Pack size', { placeholder: 'e.g. 500g / 1 litre' })}
            <label className="pe-field">
              <span>Unit</span>
              <select
                aria-label="Unit"
                disabled={protectedProduct}
                value={form.unit || 'piece'}
                onChange={e => update('unit', e.target.value)}
              >
                {['piece', 'pack', 'box', 'kg', 'litre'].map(u => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
            {!vendor && (
              <>
                {field('location', 'Shelf / aisle')}
                {field('reorder', 'Low stock alert at', { number: true, whole: true })}
                {field('reorderQty', 'Reorder quantity', { number: true, whole: true })}
                {field('taxRate', 'Tax rate %', { number: true })}
              </>
            )}
            <label className="pe-field pe-wide">
              <span>Description</span>
              <textarea
                aria-label="Description"
                rows="3"
                value={form.description || ''}
                onChange={e => update('description', e.target.value)}
              />
            </label>
          </div>
        </fieldset>
      </details>
      {protectedProduct && (
        <p className="pe-stock-note">
          For stocked products, identity and purchase-price changes need the owner. A new selling
          price is sent for approval.
        </p>
      )}
    </div>
  );
}
