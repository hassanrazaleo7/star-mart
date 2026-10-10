import { fail } from './errors.mjs';
export const str = (x, max = 250) =>
  String(x ?? '')
    .trim()
    .slice(0, max);
export const required = (x, name, max = 250) => {
  const v = str(x, max);
  if (!v) throw fail(name + ' is required');
  return v;
};
export const int = x => Number(x || 0);
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE = /^\+?[\d\s()-]{7,20}$/;
export const email = x => {
  const v = str(x, 250).toLowerCase();
  if (!EMAIL.test(v)) throw fail('Enter a valid email');
  return v;
};
export const validDate = (x, label = 'date') => {
  if (!x) return null;
  const v = str(x, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z')))
    throw fail('Invalid ' + label);
  return v;
};
export const oneOf = (value, allowed, message) => {
  if (!allowed.includes(value)) throw fail(message);
  return value;
};
