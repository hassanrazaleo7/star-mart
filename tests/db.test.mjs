import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolate } from './helpers.mjs';
import { db, init, tx, close } from '../server/db.mjs';

test('tests prefer the local engine even when DATABASE_URL is exported', async () => {
  isolate();
  const dir = await mkdtemp(join(tmpdir(), 'star-db-'));
  process.env.STAR_MART_DATA_DIR = dir;
  process.env.DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:1/none';
  try {
    const database = await db();
    assert.equal(typeof database.connect, 'undefined');
    await init();
    assert.equal((await database.query('SELECT 1 one')).rows[0].one, 1);
  } finally {
    delete process.env.DATABASE_URL;
    await close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failed initialisation does not poison later requests', async () => {
  isolate();
  const dir = await mkdtemp(join(tmpdir(), 'star-db2-'));
  const broken = join(dir, 'not-a-directory');
  await writeFile(broken, 'x');
  process.env.STAR_MART_DATA_DIR = broken;
  try {
    await assert.rejects(() => init());
    process.env.STAR_MART_DATA_DIR = join(dir, 'good');
    await init();
    assert.equal((await (await db()).query('SELECT 2 two')).rows[0].two, 2);
  } finally {
    await close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('transactions on the local engine are serialized and migrations are idempotent', async () => {
  isolate();
  const dir = await mkdtemp(join(tmpdir(), 'star-db3-'));
  process.env.STAR_MART_DATA_DIR = dir;
  try {
    await init();
    const order = [];
    let release;
    const gate = new Promise(r => (release = r));
    const a = tx(async () => {
      order.push('a:start');
      await gate;
      order.push('a:end');
    });
    const b = tx(async () => order.push('b'));
    await new Promise(r => setTimeout(r, 20));
    release();
    await Promise.all([a, b]);
    assert.deepEqual(order, ['a:start', 'a:end', 'b']);
    // A rolled-back transaction leaves no trace and later writes still work.
    await assert.rejects(() =>
      tx(async c => {
        await c.query("INSERT INTO vendors(id,name) VALUES('v-rollback','Ghost')");
        throw Error('boom');
      })
    );
    assert.equal((await (await db()).query("SELECT COUNT(*) n FROM vendors WHERE id='v-rollback'")).rows[0].n, 0);
    await init();
    const version = (await (await db()).query("SELECT value FROM schema_meta WHERE key='version'")).rows[0].value;
    assert.ok(Number(version) >= 1);
  } finally {
    await close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('no server module writes outside tx()', () => {
  const files = ['server', 'server/routes'].flatMap(d =>
    readdirSync(d).filter(f => f.endsWith('.mjs')).map(f => join(d, f))
  );
  const offenders = files.filter(f =>
    /db\(\)\s*\)\s*\.query\(\s*['"`]\s*(INSERT|UPDATE|DELETE)/i.test(readFileSync(f, 'utf8'))
  );
  assert.deepEqual(offenders, []);
});
