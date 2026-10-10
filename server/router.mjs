// Declarative route table. Every route states its guard, body type, rate limits and whether it runs in a transaction,
// so a route can no longer be accidentally public or write outside tx().
//   route(method, pattern, {auth, body, limit, tx}, handler)
//   auth:  'public' | 'customer' | 'customerLinked' | 'customerOptional' | 'firebase' | 'session' | 'worker' | 'owner' | 'vendor' | 'catalog'
//   body:  'none' | 'json' | 'image'
//   limit: {scope, max?, windowMinutes?, byEmail?: true|'field', byUser?: true, perAccount?: true} or an array of them
//   tx:    true → the handler receives ctx.c, an open transaction client
// Handlers return ok(body, status, headers) or raw(status, headers, data).
export const routes = [];
export function route(method, pattern, opts, handler) {
  if (typeof opts === 'function') {
    handler = opts;
    opts = {};
  }
  if (!opts.auth) throw Error(`Route ${method} ${pattern} must declare auth`);
  for (const m of [].concat(method))
    routes.push({ method: m, pattern, body: 'none', tx: false, ...opts, handler });
}
export function match(method, path) {
  for (const r of routes) {
    if (r.method !== method) continue;
    if (typeof r.pattern === 'string') {
      if (r.pattern === path) return { r, params: [] };
      continue;
    }
    const m = r.pattern.exec(path);
    if (m) return { r, params: m.slice(1) };
  }
  // Distinguish 404 from 405 for a friendlier message.
  const other = routes.find(r =>
    typeof r.pattern === 'string' ? r.pattern === path : r.pattern.test(path)
  );
  return other ? { methodMismatch: true } : null;
}
export const ok = (body, status = 200, headers = {}) => ({ status, body, headers });
export const raw = (status, headers, data) => ({ raw: true, status, headers, data });
