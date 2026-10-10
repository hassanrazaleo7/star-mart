import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handle } from '../server/api.mjs';
import { close } from '../server/db.mjs';

// Tests must never reach a real database, whatever the developer's shell exports.
export function isolate() {
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.APP_ORIGINS;
  delete process.env.TRUST_PROXY;
  delete process.env.SETUP_SECRET;
  delete process.env.NODE_ENV;
}
export async function withTempDb(prefix, fn) {
  isolate();
  const dir = await mkdtemp(join(tmpdir(), prefix));
  process.env.STAR_MART_DATA_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    await close();
    await rm(dir, { recursive: true, force: true });
  }
}
export const cookieOf = headers => {
  const sc = headers?.['set-cookie'];
  const first = Array.isArray(sc) ? sc[0] : sc;
  return first ? first.split(';')[0] : '';
};
export async function request(
  path,
  method = 'GET',
  payload,
  { cookie = '', headers = {}, raw = false, ip = '127.0.0.1' } = {}
) {
  const bytes = raw
    ? payload
    : payload !== undefined
      ? Buffer.from(JSON.stringify(payload))
      : Buffer.alloc(0);
  const req = Readable.from(bytes.length ? [bytes] : []);
  req.url = '/api' + path;
  req.method = method;
  req.headers = { cookie, host: 'localhost:8787', ...headers };
  req.socket = { remoteAddress: ip };
  let status,
    resHeaders,
    chunks = [];
  await handle(req, {
    writeHead(s, h) {
      status = s;
      resHeaders = h;
    },
    end(x) {
      if (x) chunks.push(Buffer.from(x));
    },
  });
  const out = Buffer.concat(chunks);
  const isJson = resHeaders?.['content-type']?.includes('application/json');
  return {
    status,
    headers: resHeaders,
    body: isJson ? JSON.parse(out.toString()) : out,
    cookie: cookieOf(resHeaders),
  };
}
export async function setupOwner(password = 'ownerpass1') {
  await request('/setup', 'POST', { name: 'Owner', password });
  return (await request('/login', 'POST', { password })).cookie;
}
export async function createStaff(owner, email = 'staff@example.com', password = 'staffpass1') {
  const r = await request(
    '/accounts',
    'POST',
    { name: 'Cashier', email, password, role: 'staff' },
    { cookie: owner }
  );
  if (r.status !== 201) throw Error('staff: ' + JSON.stringify(r.body));
  return (await request('/account/login', 'POST', { email, password })).cookie;
}
export async function createVendor(owner, email = 'vendor@example.com', password = 'vendorpass1') {
  const a = await request('/vendor/apply', 'POST', {
    business: 'Farm',
    contact: 'Vendor',
    phone: '03001234567',
    email,
    password,
  });
  if (a.status !== 201) throw Error('apply: ' + JSON.stringify(a.body));
  const approved = await request(
    '/vendor/applications/' + a.body.id + '/approve',
    'POST',
    undefined,
    { cookie: owner }
  );
  if (approved.status !== 201) throw Error('approve: ' + JSON.stringify(approved.body));
  return {
    vendorId: approved.body.vendorId,
    cookie: (await request('/account/login', 'POST', { email, password })).cookie,
  };
}
export async function createCustomer(email = 'customer@example.com', password = 'customerpass') {
  const r = await request('/customer/signup', 'POST', {
    name: 'Customer',
    email,
    password,
    phone: '03001234567',
  });
  if (r.status !== 201) throw Error('signup: ' + JSON.stringify(r.body));
  return { cookie: r.cookie, id: r.body.user.id };
}
export async function createProduct(owner, extra = {}) {
  const r = await request(
    '/products',
    'POST',
    { name: 'Rice', category: 'Grocery Staples', opening: 10, price: '250', cost: '180', ...extra },
    { cookie: owner }
  );
  if (r.status !== 201) throw Error('product: ' + JSON.stringify(r.body));
  return r.body;
}
export const pngOf = (width, height) => {
  const b = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
};
