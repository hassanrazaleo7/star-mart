// One error helper for the whole server. `status` drives the HTTP response; `extra` is merged into the body.
export const fail = (message, status = 400, extra = {}) =>
  Object.assign(new Error(message), { status, ...extra });

const DB_ERRORS = {
  23505: [409, 'A record with these details already exists.'],
  23503: [409, 'A related record was not found or is still in use.'],
  23514: [400, 'A value is outside the allowed range.'],
  '22P02': [400, 'A value has the wrong format.'],
  '40P01': [409, 'The store was busy for a moment. Please try again.'],
  '55P03': [409, 'The record is being updated by someone else. Please try again.'],
};

// Maps any thrown value to {status, message, extra}. Unknown errors become a generic 500 so no internals leak.
export function describeError(e) {
  if (e?.status) {
    const { message, status, stack, ...extra } = e;
    return { status, message, extra };
  }
  const known = DB_ERRORS[e?.code];
  if (known) return { status: known[0], message: known[1], extra: {} };
  return { status: 500, message: 'Server error. Check database connection and server logs.', extra: {} };
}
