import { db } from './db.mjs';
export async function activityFeed(limit = 150) {
  const r = await (
    await db()
  ).query(
    'SELECT id,entity,entity_id,action,actor,created_at FROM activity_events ORDER BY id DESC LIMIT $1',
    [Math.max(1, Math.min(500, Number(limit) || 150))]
  );
  return r.rows;
}
