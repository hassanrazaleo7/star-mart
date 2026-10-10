import { tx } from './db.mjs';
import { hash } from './auth.mjs';
import { fail } from './errors.mjs';
import { RATE_LIMIT } from './config.mjs';

export async function limitInit(d) {
  await d.query(
    'CREATE TABLE IF NOT EXISTS auth_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,started_at TIMESTAMPTZ NOT NULL DEFAULT NOW())'
  );
  await d.query('CREATE INDEX IF NOT EXISTS idx_auth_limits_started ON auth_limits(started_at)');
}

// Vercel sets x-real-ip itself; elsewhere x-forwarded-for is only trusted behind a proxy we control.
export function clientIp(req) {
  const h = req.headers || {};
  if (process.env.VERCEL)
    return (
      String(h['x-real-ip'] || h['x-forwarded-for'] || '')
        .split(',')[0]
        .trim() || 'unknown'
    );
  if (process.env.TRUST_PROXY) {
    const chain = String(h['x-forwarded-for'] || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (chain.length) return chain[chain.length - 1];
  }
  return req.socket?.remoteAddress || 'local';
}

// Sliding-window counter per (scope, ip, email). `perAccount` drops the IP so distributed guessing is also capped.
export async function authLimit(
  req,
  scope,
  email = '',
  { max = RATE_LIMIT.max, windowMinutes = RATE_LIMIT.windowMinutes, perAccount = false } = {}
) {
  const ip = perAccount ? '*' : clientIp(req);
  const key = hash(
    scope +
      '|' +
      ip +
      '|' +
      String(email ?? '')
        .trim()
        .toLowerCase()
  );
  const attempts = await tx(
    async c =>
      (
        await c.query(
          "INSERT INTO auth_limits(key,attempts) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_limits.started_at<NOW()-($2::text||' minutes')::interval THEN 1 ELSE auth_limits.attempts+1 END,started_at=CASE WHEN auth_limits.started_at<NOW()-($2::text||' minutes')::interval THEN NOW() ELSE auth_limits.started_at END RETURNING attempts",
          [key, String(windowMinutes)]
        )
      ).rows[0].attempts
  );
  if (Number(attempts) > max)
    throw fail('Too many attempts. Please wait a few minutes and try again.', 429);
}
