import { formatPaisa as money, formatQty } from './money.js';
export function receiptHtml(
  r,
  { logo = '/logo.png', cashier = 'Owner', address = '', phone = '' } = {}
) {
  const esc = value =>
    String(value ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const due = Math.max(0, Number(r.total) - Number(r.received));
  const row = (label, value, cls = '') =>
    `<div class="row ${cls}"><span>${label}</span><b>${esc(value)}</b></div>`;
  return `<!doctype html><html><head><meta charset="UTF-8"><title>Star Mart ${esc(r.receipt)}</title><style>@page{size:80mm auto;margin:4mm}*{box-sizing:border-box}body{width:72mm;margin:12px auto;font:12px/1.5 Arial,sans-serif;color:#111}.brand{text-align:center;padding-bottom:12px;border-bottom:2px solid #111}.brand img{width:170px;height:72px;object-fit:contain}.brand p{margin:3px 0;font-size:10px}.tag{font-size:10px;text-transform:uppercase;letter-spacing:2px}.meta{padding:12px 0;border-bottom:1px dashed #888}.row{display:flex;justify-content:space-between;gap:12px;padding:4px 0}.row b{text-align:right}table{width:100%;border-collapse:collapse;margin:12px 0}th{font-size:10px;text-align:left;border-bottom:1px solid #111;padding:7px 0}th:last-child,td:last-child{text-align:right}td{vertical-align:top;padding:9px 0;border-bottom:1px dashed #ccc}td small{display:block;font-size:10px;color:#333}.total{font-size:17px;border-top:2px solid #111;margin-top:7px;padding-top:9px}.footer{text-align:center;border-top:1px dashed #888;margin-top:17px;padding-top:12px}.footer strong{font-size:13px}.footer p{font-size:10px;margin:5px 0}@media print{body{margin:0 auto}}</style></head><body><div class="brand"><img src="${esc(logo)}" alt="Star Mart"><div class="tag">House of Groceries</div>${address ? `<p>${esc(address)}</p>` : ''}${phone ? `<p>${esc(phone)}</p>` : ''}</div><div class="meta">${row('Invoice', r.receipt)}${row('Date', new Date(r.createdAt).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }))}${row('Cashier', r.cashier || cashier)}${row('Customer', r.customer || 'Walk-in customer')}${row('Payment', r.payment)}</div><table><thead><tr><th>ITEM / QTY × PRICE</th><th>AMOUNT</th></tr></thead><tbody>${r.lines.map(x => `<tr><td>${esc(x.name)}<small>${esc(formatQty(x.qty))} × ${esc(money(x.unitPrice))}</small></td><td>${esc(money(x.total))}</td></tr>`).join('')}</tbody></table>${row('Subtotal', money(r.subtotal))}${row('Discount', '− ' + money(r.discount))}${row('Tax', money(r.tax))}${row('TOTAL', money(r.total), 'total')}${row('Payment received', money(r.received))}${row(due ? 'Balance due' : 'Change', money(due || Math.max(0, Number(r.received) - Number(r.total))))}<div class="footer"><strong>Thank you for shopping at Star Mart!</strong><p>Keep this receipt for any purchase query.</p><p>Your trust. Our everyday commitment.</p></div></body></html>`;
}
