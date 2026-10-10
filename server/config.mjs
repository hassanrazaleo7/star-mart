// Central configuration. Values can be overridden with environment variables where noted.
const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};
export const TIMEZONE = 'Asia/Karachi';
// Pakistan has no daylight saving time, so a fixed offset is safe for day boundaries.
export const TIMEZONE_OFFSET_MINUTES = 300;
export const BODY_LIMIT = 2_000_000;
export const IMAGE_LIMIT = 1_000_000;
export const IMAGE_MAX_DIMENSION = 8000;
export const SESSION_DAYS = 7;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
// POS discount policy for staff accounts (owner is unlimited). STAFF_MAX_DISCOUNT_BPS=500 means 5 %.
export const STAFF_MAX_DISCOUNT_BPS = num('STAFF_MAX_DISCOUNT_BPS', 500);
export const STAFF_MAX_DISCOUNT_PAISA = num('STAFF_MAX_DISCOUNT_PAISA', 50_000);
export const ALERT_DISCOUNT_PAISA = num('ALERT_DISCOUNT_PAISA', 20_000);
// Online order limits. Guests (WhatsApp orders without an account) never reserve stock.
export const GUEST_ORDER = {
  maxLines: num('GUEST_ORDER_MAX_LINES', 20),
  maxLineMilli: num('GUEST_ORDER_MAX_UNITS', 10) * 1000,
  maxOpen: num('GUEST_ORDER_MAX_OPEN', 3),
  expiryHours: num('GUEST_ORDER_EXPIRY_HOURS', 2),
};
export const CUSTOMER_ORDER = {
  maxLines: 100,
  maxLineMilli: num('CUSTOMER_ORDER_MAX_UNITS', 50) * 1000,
  maxOpen: num('CUSTOMER_ORDER_MAX_OPEN', 3),
  expiryHours: num('CUSTOMER_ORDER_EXPIRY_HOURS', 48),
  transferExpiryHours: num('TRANSFER_ORDER_EXPIRY_HOURS', 24),
};
export const STATE_LIMIT = 5000;
export const ACTIVITY_RETENTION_DAYS = num('ACTIVITY_RETENTION_DAYS', 180);
export const SWEEP_INTERVAL_MS = 60_000;
export const RATE_LIMIT = { max: 20, windowMinutes: 15 };
