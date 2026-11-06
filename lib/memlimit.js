// Best-effort, in-memory limits (no database).
// Each Vercel function instance has its own memory, so these limits are NOT global.
// They slow down abuse; real limits need a shared store (next phase) or a Vercel Firewall rule.
const buckets = new Map();

export function hit(key, limit, windowSec) {
  const now = Date.now();
  if (buckets.size > 5000) for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
  let b = buckets.get(key);
  if (!b || b.reset < now) {
    b = { n: 0, reset: now + windowSec * 1000 };
    buckets.set(key, b);
  }
  b.n += 1;
  return b.n <= limit;
}
