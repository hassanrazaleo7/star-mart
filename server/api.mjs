import { withRequestContext } from './request-context.mjs';
import { init, tx } from './db.mjs';
import { json, body, imageBody, sameOrigin } from './http.mjs';
import { match } from './router.mjs';
import { guard } from './sessions.mjs';
import { authLimit } from './auth-limits.mjs';
import { fail, describeError } from './errors.mjs';
import './routes/public.mjs';
import './routes/customer.mjs';
import './routes/store.mjs';

// Request pipeline: init → origin check → route match → guard → body → rate limits → (tx) → handler → respond.
async function handleRequest(req, res) {
  try {
    try {
      await init();
    } catch (e) {
      console.error('database initialisation failed', e);
      return json(
        res,
        503,
        { error: 'The store is starting up. Please try again in a moment.' },
        { 'retry-after': '5' }
      );
    }
    const url = new URL(req.url || '/', 'http://localhost');
    const path = url.pathname.replace(/^\/api(?:\/index\.js)?/, '') || '/',
      method = req.method || 'GET';
    if (!sameOrigin(req, method)) throw fail('Cross-site request blocked', 403);
    const found = match(method, path);
    if (!found) throw fail('Endpoint not found', 404);
    if (found.methodMismatch) throw fail('Method not allowed', 405);
    const { r, params } = found;
    const ctx = { req, res, method, path, params, query: url.searchParams };
    await guard(r.auth, ctx);
    if (r.body === 'json') ctx.body = await body(req);
    else if (r.body === 'image') ctx.image = await imageBody(req);
    for (const l of [].concat(r.limit || [])) {
      const who = l.byUser
        ? (ctx.user || ctx.customer)?.id || ''
        : l.byEmail
          ? String(ctx.body?.[l.byEmail === true ? 'email' : l.byEmail] ?? '')
          : '';
      await authLimit(req, l.scope, who, l);
    }
    const result = r.tx ? await tx(c => r.handler({ ...ctx, c })) : await r.handler(ctx);
    if (!result) return json(res, 200, {});
    if (result.raw) {
      res.writeHead(result.status, result.headers);
      return res.end(result.data);
    }
    return json(res, result.status || 200, result.body, result.headers || {});
  } catch (e) {
    const { status, message, extra } = describeError(e);
    if (status === 500) console.error(e);
    json(res, status, { ...extra, error: message });
  }
}

export function handle(req, res) {
  return withRequestContext(() => handleRequest(req, res));
}
