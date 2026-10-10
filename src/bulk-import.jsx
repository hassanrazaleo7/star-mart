import React, { useState } from 'react';
import { unzip, strFromU8 } from 'fflate';
import { post, seg, upload } from './lib/api.js';
import { resizeToJpeg } from './lib/image.js';
import { UploadCloud, Download, CheckCircle, AlertCircle } from 'lucide-react';
import './bulk-import.css';
function csv(text) {
  let rows = [],
    row = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    let ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (quoted) throw Error('CSV has an unclosed quote');
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) return [];
  let headers = rows.shift().map((x, i) => (i === 0 ? x.replace(/^\uFEFF/, '') : x));
  return rows.map(values => Object.fromEntries(headers.map((h, j) => [h, values[j] || ''])));
}
// Decompress off the main thread so a 30 MB ZIP does not freeze the admin.
const unzipAsync = data =>
  new Promise((resolve, reject) => unzip(data, (err, out) => (err ? reject(err) : resolve(out))));
async function imageBlob(bytes) {
  if (bytes.byteLength < 900000) return new Blob([bytes]);
  return resizeToJpeg(new Blob([bytes]), { quality: 0.78, limit: 900000 });
}
export default function BulkImport({ onImported }) {
  let [file, setFile] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [progress, setProgress] = useState(''),
    [summary, setSummary] = useState(null);
  async function run() {
    if (!file) return;
    setBusy(true);
    setError('');
    setSummary(null);
    let tally = {
      customersAdded: 0,
      customersSkipped: 0,
      productsAdded: 0,
      productsSkipped: 0,
      imagesAdded: 0,
      imagesFailed: 0,
    };
    try {
      if (file.size > 30_000_000)
        throw Error('ZIP must be under 30 MB. Split a larger catalog into separate ZIP files.');
      let entries = await unzipAsync(new Uint8Array(await file.arrayBuffer()));
      let paths = Object.keys(entries),
        find = name => paths.find(p => p === name || p.endsWith('/' + name)),
        customersPath = find('customers.csv'),
        productsPath = find('products.csv');
      if (!customersPath || !productsPath)
        throw Error('ZIP must contain customers.csv and products.csv');
      let customers = csv(strFromU8(entries[customersPath])),
        products = csv(strFromU8(entries[productsPath]));
      if (!customers.length && !products.length) throw Error('Both CSV sheets are empty');
      if (customers.length > 5000 || products.length > 5000)
        throw Error('Use up to 5,000 customers and 5,000 products per ZIP');
      let imageNames = new Set(),
        skus = new Set(),
        emails = new Set();
      for (let row of customers) {
        if (!row.name || !row.email || !row.temporary_password)
          throw Error('Every customer needs name, email and temporary_password');
        let key = row.email.toLowerCase();
        if (emails.has(key)) throw Error('Duplicate customer email: ' + key);
        emails.add(key);
      }
      for (let row of products) {
        if (!row.sku || !row.name || !row.price_rs)
          throw Error('Every product needs SKU, name and price_rs');
        if (skus.has(row.sku)) throw Error('Duplicate product SKU: ' + row.sku);
        skus.add(row.sku);
        if (row.image_filename) {
          if (imageNames.has(row.image_filename))
            throw Error('Image filename used by more than one product: ' + row.image_filename);
          imageNames.add(row.image_filename);
          if (!find('images/' + row.image_filename))
            throw Error('Image missing: images/' + row.image_filename);
        }
      }
      let pending = [
          ...customers.map(row => ({ kind: 'customer', row })),
          ...products.map(row => ({ kind: 'product', row })),
        ],
        map = new Map();
      for (let i = 0; i < pending.length; i += 80) {
        let chunk = pending.slice(i, i + 80),
          result = await post('/bulk/import', {
            customers: chunk.filter(x => x.kind === 'customer').map(x => x.row),
            products: chunk.filter(x => x.kind === 'product').map(x => x.row),
          });
        for (let k of ['customersAdded', 'customersSkipped', 'productsAdded', 'productsSkipped'])
          tally[k] += result[k];
        for (let p of result.products) map.set(p.sku, p);
        setProgress(
          'Imported ' + Math.min(i + 80, pending.length) + ' / ' + pending.length + ' rows'
        );
      }
      let firstIssue = '';
      for (let i = 0; i < products.length; i++) {
        let product = products[i];
        if (!product.image_filename || !map.get(product.sku)?.added) continue;
        let imagePath = find('images/' + product.image_filename),
          bytes = entries[imagePath];
        try {
          if (!/\.(jpg|jpeg|png|webp)$/i.test(imagePath)) throw Error('Use JPG, PNG or WebP');
          await upload(
            '/products/' + seg(map.get(product.sku).id) + '/image',
            await imageBlob(bytes)
          );
          tally.imagesAdded++;
        } catch (e) {
          tally.imagesFailed++;
          firstIssue ||= product.image_filename + ' — ' + e.message;
          setError('Some images could not upload. First issue: ' + firstIssue);
        }
        setProgress('Images ' + (i + 1) + ' / ' + products.length);
      }
      setSummary(tally);
      await onImported();
      setProgress('Import completed. Existing records were skipped.');
    } catch (e) {
      setError(
        e.message +
          ' Previously completed batches remain saved; retrying the ZIP safely skips matching emails and SKUs.'
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card bulk-panel">
      <div className="card-title">
        <div>
          <span className="eyebrow">STORE SETUP</span>
          <h2>Bulk import customers & groceries</h2>
        </div>
        <a className="bulk-download" href="/bulk-import-template.zip" download>
          <Download size={16} />
          Download sample format
        </a>
      </div>
      <p>
        <a className="bulk-download" href="/star-mart-210-sample-catalog.zip" download>
          Download 210 demo products (21 categories × 10)
        </a>{' '}
        · sample prices and images must be replaced before adding real stock.
      </p>
      <p>
        Fill <b>customers.csv</b> and <b>products.csv</b>, put JPG/PNG/WebP photos inside{' '}
        <b>images/</b>, ZIP them together and import once. Existing email/SKU rows are skipped.
        Prices are in rupees; opening stock is recorded once for new products.
      </p>
      <label className="bulk-picker">
        <UploadCloud size={24} />
        <span>{file ? file.name : 'Choose your prepared ZIP'}</span>
        <input
          type="file"
          accept=".zip,application/zip"
          onChange={e => {
            setFile(e.target.files[0] || null);
            setSummary(null);
            setError('');
          }}
        />
      </label>
      <button className="primary" disabled={!file || busy} onClick={run}>
        {busy ? 'Importing…' : 'Import ZIP'}
      </button>
      {progress && <p className="bulk-progress">{progress}</p>}
      {error && (
        <p className="bulk-error">
          <AlertCircle size={16} />
          {error}
        </p>
      )}
      {summary && (
        <div className="bulk-summary">
          <CheckCircle size={19} />
          <span>
            Customers: {summary.customersAdded} added, {summary.customersSkipped} skipped ·
            Products: {summary.productsAdded} added, {summary.productsSkipped} skipped · Images:{' '}
            {summary.imagesAdded} added, {summary.imagesFailed} failed
          </span>
        </div>
      )}
      <small>
        Give imported customers their passwords privately. Password change/reset is not included
        yet; do not share or upload a filled ZIP containing passwords publicly.
      </small>
    </section>
  );
}
