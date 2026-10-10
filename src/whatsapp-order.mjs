export function whatsappNumber(value) {
  let n = String(value || '').replace(/[^0-9]/g, '');
  if (n.startsWith('00')) n = n.slice(2);
  if (/^03[0-9]{9}$/.test(n)) n = '92' + n.slice(1);
  return /^[1-9][0-9]{7,14}$/.test(n) ? n : '';
}
export function whatsappOrderLink(number, order) {
  const phone = whatsappNumber(number);
  if (!phone) return '';
  const money = n => 'Rs ' + (Number(n) / 100).toFixed(2);
  const rows = order.items.map(
    i =>
      `${i.name} × ${Number(i.qty ?? i.qty_milli) / 1000} — ${money(i.lineTotal ?? i.line_total_paisa)}`
  );
  const text = [
    'STAR MART ORDER',
    `Order: ${order.id}`,
    `Method: ${order.fulfillment === 'Pickup' ? 'Self Pickup' : 'Delivery'}`,
    `Name: ${order.name}`,
    `Mobile: ${order.phone}`,
    order.fulfillment === 'Delivery' ? `Address: ${order.address}` : 'Collect at Star Mart',
    '',
    ...rows,
    '',
    `Groceries total: ${money(order.total)}`,
    `Payment: ${order.paymentMethod}`,
    order.paymentReference
      ? `Advance transfer reference: ${order.paymentReference} (pending verification)`
      : 'Payment on collection',
    order.note ? `Instructions: ${order.note}` : '',
    'Please confirm availability and any delivery charges.',
  ]
    .filter(Boolean)
    .join('\n');
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
