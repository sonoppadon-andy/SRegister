import { redis } from './store.js';

export async function audit(event, data = {}) {
  const rec = { ts: new Date().toISOString(), event, ...data };
  console.log(JSON.stringify({ audit: rec }));
  try {
    await redis.lpush('audit', JSON.stringify(rec));
    await redis.ltrim('audit', 0, 9999);
  } catch (e) {
    console.error('audit write failed', e.message);
  }
}
