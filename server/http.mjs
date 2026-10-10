import { normalizeCategory } from '../src/grocery-categories.mjs';
import { BODY_LIMIT, IMAGE_LIMIT, IMAGE_MAX_DIMENSION } from './config.mjs';
import { fail } from './errors.mjs';

export function json(res, status, body, extra = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra,
  });
  res.end(
    JSON.stringify(body, function (key, value) {
      return key === 'category' &&
        typeof value === 'string' &&
        ('price_paisa' in this || 'sku' in this)
        ? normalizeCategory(value)
        : value;
    })
  );
}

async function readAll(req, limit, tooLarge) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw fail(tooLarge, 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function body(req) {
  const raw = (await readAll(req, BODY_LIMIT, 'Request too large')).toString() || '{}';
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw fail('Invalid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Invalid JSON');
  return value;
}

// Reads width/height from the container header; returns null when the format cannot be parsed.
export function imageDimensions(data, mime) {
  try {
    if (mime === 'image/png' && data.length >= 24)
      return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < data.length) {
        if (data[i] !== 0xff) return null;
        const marker = data[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }
        const length = data.readUInt16BE(i + 2);
        const isSof =
          marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
        if (isSof) return { height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
        i += 2 + length;
      }
      return null;
    }
    if (mime === 'image/webp' && data.length >= 30) {
      const chunk = data.toString('ascii', 12, 16);
      if (chunk === 'VP8 ')
        return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const b = data.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X')
        return {
          width: (data.readUIntLE(24, 3) & 0xffffff) + 1,
          height: (data.readUIntLE(27, 3) & 0xffffff) + 1,
        };
    }
  } catch {
    return null;
  }
  return null;
}

export async function imageBody(req) {
  const data = await readAll(req, IMAGE_LIMIT, 'Image must be under 1 MB');
  let mime;
  if (data.length >= 3 && data.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
    mime = 'image/jpeg';
  else if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    mime = 'image/png';
  else if (
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  )
    mime = 'image/webp';
  else throw fail('Upload a JPG, PNG or WebP image');
  const size = imageDimensions(data, mime);
  if (size && (size.width > IMAGE_MAX_DIMENSION || size.height > IMAGE_MAX_DIMENSION))
    throw fail(`Image must be at most ${IMAGE_MAX_DIMENSION} pixels wide or tall`);
  return { data, mime };
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Origin check for mutating requests. Fails closed (403) on malformed or "null" origins.
export function sameOrigin(req, method) {
  if (!MUTATING.has(method)) return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  let o;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  const allowed = String(process.env.APP_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (allowed.length) return allowed.includes(o.origin);
  const host = process.env.VERCEL
    ? req.headers['x-forwarded-host'] || req.headers.host
    : req.headers.host;
  if (o.host === host) return true;
  return (
    process.env.NODE_ENV !== 'production' &&
    ['localhost', '127.0.0.1'].includes(o.hostname) &&
    ['localhost', '127.0.0.1'].includes(String(host || '').split(':')[0])
  );
}
