import { randomBytes, scrypt, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { PASSWORD_MIN, PASSWORD_MAX, SESSION_DAYS } from './config.mjs';
import { fail } from './errors.mjs';

const scryptAsync = promisify(scrypt);
// New hashes use scrypt with N=2^17 (OWASP guidance). Legacy rows are bare hex with the Node default N=16384.
const LOG_N = Number(process.env.SCRYPT_LOG_N || 17);
const MAXMEM = 256 * 1024 * 1024;
const params = logN => ({ N: 2 ** logN, r: 8, p: 1, maxmem: MAXMEM });

export const id = () => randomBytes(16).toString('hex');
export const hash = s => createHash('sha256').update(s).digest('hex');

export function checkPassword(value) {
  const p = String(value ?? '');
  if (p.length < PASSWORD_MIN || p.length > PASSWORD_MAX)
    throw fail(`Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters`);
  return p;
}

// Synchronous legacy hash. Only used by verify() for rows written before the async upgrade.
export function passwordHash(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}
export async function passwordHashAsync(password, salt) {
  const key = await scryptAsync(String(password), salt, 64, params(LOG_N));
  return `scrypt$${LOG_N}$${key.toString('hex')}`;
}
function parseHash(expected) {
  const m = /^scrypt\$(\d+)\$([a-f0-9]+)$/.exec(String(expected || ''));
  return m ? { logN: Number(m[1]), hex: m[2] } : { logN: 14, hex: String(expected || '') };
}
export function verify(password, salt, expected) {
  if (String(password).length > PASSWORD_MAX) return false;
  const { logN, hex } = parseHash(expected);
  let a;
  try {
    a = scryptSync(String(password), salt, 64, params(logN));
  } catch {
    return false;
  }
  const b = Buffer.from(hex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function verifyAsync(password, salt, expected) {
  if (String(password).length > PASSWORD_MAX) return false;
  const { logN, hex } = parseHash(expected);
  let a;
  try {
    a = await scryptAsync(String(password), salt, 64, params(logN));
  } catch {
    return false;
  }
  const b = Buffer.from(hex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
export const needsRehash = expected => parseHash(expected).logN !== LOG_N;

// Constant-cost verification for unknown accounts so timing does not reveal whether an email exists.
const DUMMY_SALT = 'd1b4c7e2f0a9385c6e7d2a1b4c9f0e3a';
let dummyHash;
export async function burnVerify(password = 'x') {
  dummyHash ||= await passwordHashAsync('never-the-password', DUMMY_SALT);
  await verifyAsync(password, DUMMY_SALT, dummyHash);
}

// ---- cookies -------------------------------------------------------------
const STORE = 'sm_session',
  CUSTOMER = 'sm_customer';
export const isSecure = req =>
  process.env.NODE_ENV === 'production' ||
  !!process.env.VERCEL ||
  req?.headers?.['x-forwarded-proto'] === 'https';
function serialize(name, token, clear, sameSite, req) {
  const secure = isSecure(req);
  return `${secure ? '__Host-' : ''}${name}=${clear ? '' : token}; HttpOnly; SameSite=${sameSite}; Path=/; ${secure ? 'Secure; ' : ''}Max-Age=${clear ? 0 : SESSION_DAYS * 86400}`;
}
export const cookie = (token, clear = false, req) => serialize(STORE, token, clear, 'Strict', req);
export const customerCookie = (token, clear = false, req) =>
  serialize(CUSTOMER, token, clear, 'Lax', req);
// When clearing, also expire the un-prefixed legacy cookie so a stale copy cannot linger.
export const clearCookies = (req, kind = 'store') => {
  const name = kind === 'store' ? STORE : CUSTOMER,
    sameSite = kind === 'store' ? 'Strict' : 'Lax';
  const out = [serialize(name, '', true, sameSite, req)];
  if (isSecure(req)) out.push(`${name}=; HttpOnly; SameSite=${sameSite}; Path=/; Secure; Max-Age=0`);
  return out;
};
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}
// Returns every candidate token (prefixed first) so a stale legacy cookie cannot shadow a valid one.
export function tokensFrom(req, kind = 'store') {
  const name = kind === 'store' ? STORE : CUSTOMER,
    jar = parseCookies(req.headers?.cookie);
  return [jar['__Host-' + name], jar[name]].filter(t => t && /^[a-f0-9]{64}$/.test(t));
}
export const tokenFrom = req => tokensFrom(req, 'store')[0] || '';
