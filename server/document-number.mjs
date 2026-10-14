// Row locking makes numbering atomic across concurrent Neon/Vercel requests.
export async function nextDocumentNumber(c) {
  await c.query(
    "INSERT INTO document_counters(name,value) SELECT 'store',COALESCE(MAX(substring(id FROM 3)::bigint),0) FROM (SELECT id FROM receipts WHERE id ~ '^SM[0-9]+$' UNION ALL SELECT id FROM customer_orders WHERE id ~ '^SM[0-9]+$') historical ON CONFLICT(name) DO NOTHING"
  );
  const r = await c.query(
    "UPDATE document_counters SET value=value+1 WHERE name='store' RETURNING value"
  );
  return 'SM' + String(r.rows[0].value).padStart(3, '0');
}
