import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  automaticDeserialization: false, // values are plain strings (hashes, emails)
});

/** Fixed-window rate limit. Returns true if the request is allowed. */
export async function rateLimit(key, limit, windowSec) {
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, windowSec);
  return n <= limit;
}
