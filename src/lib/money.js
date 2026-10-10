// Single source of truth for money, quantity and date formatting on the client.
export const TIMEZONE = 'Asia/Karachi';
export function formatPaisa(n, { decimals = 2, prefix = 'Rs ' } = {}) {
  const value = Number(n || 0) / 100;
  return (
    prefix +
    value.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: decimals })
  );
}
export function formatQty(milli, unit = '') {
  const text = (Number(milli || 0) / 1000).toLocaleString('en-PK', { maximumFractionDigits: 3 });
  return unit ? text + ' ' + unit : text;
}
export const formatDateTime = x =>
  new Date(x).toLocaleString('en-PK', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: TIMEZONE,
  });
export const formatDate = x =>
  new Date(x).toLocaleDateString('en-PK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: TIMEZONE,
  });
export function localDay(value = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const get = t => parts.find(p => p.type === t)?.value;
  return get('year') + '-' + get('month') + '-' + get('day');
}
export const rupeesToPaisa = v => Math.round(Number(v || 0) * 100);
export const paisaToRupees = n => Number(n || 0) / 100;
export const milliToUnits = n => Number(n || 0) / 1000;
export const lineTotalPaisa = (qtyMilli, unitPaisa) =>
  Math.round((Number(qtyMilli) * Number(unitPaisa)) / 1000);
