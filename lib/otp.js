import crypto from 'node:crypto';
import { env } from './config.js';
import { redis } from './store.js';

const MAX_ATTEMPTS = 5;
const ttlSec = () => Number(env('OTP_TTL_MINUTES', '10')) * 60;
const key = (purpose, email) => `otp:${purpose}:${email}`;
const akey = (purpose, email) => `otpa:${purpose}:${email}`;
const hash = (purpose, email, code) =>
  crypto.createHmac('sha256', env('OTP_PEPPER')).update(`${purpose}:${email}:${code}`).digest('hex');

export function newCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** purpose: 'register' | 'login' (a code for one purpose never works for the other) */
export async function saveOtp(purpose, email, code) {
  await redis.set(key(purpose, email), hash(purpose, email, code), { ex: ttlSec() });
  await redis.del(akey(purpose, email));
}

/** Returns 'ok' | 'expired' | 'invalid' | 'locked' */
export async function checkOtp(purpose, email, code) {
  const stored = await redis.get(key(purpose, email));
  if (!stored) return 'expired';
  const attempts = await redis.incr(akey(purpose, email));
  if (attempts === 1) await redis.expire(akey(purpose, email), ttlSec());
  if (attempts > MAX_ATTEMPTS) {
    await redis.del(key(purpose, email));
    return 'locked';
  }
  if (!/^\d{6}$/.test(code)) return 'invalid';
  const a = Buffer.from(String(stored), 'hex');
  const b = Buffer.from(hash(purpose, email, code), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return attempts >= MAX_ATTEMPTS ? 'locked' : 'invalid';
  }
  await redis.del(key(purpose, email), akey(purpose, email));
  return 'ok';
}

export const OTP_MESSAGES = {
  expired: 'รหัสหมดอายุหรือไม่ถูกต้อง กรุณาขอรหัสใหม่',
  invalid: 'รหัสไม่ถูกต้อง ตรวจสอบรหัสในอีเมลแล้วลองอีกครั้ง',
  locked: 'กรอกรหัสผิดหลายครั้ง กรุณาขอรหัสใหม่',
};

export function otpEmailHtml(code, purposeText) {
  const mins = env('OTP_TTL_MINUTES', '10');
  return `<p>รหัสสำหรับ${purposeText}ของคุณคือ</p>
  <p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>
  <p>รหัสนี้ใช้ได้ครั้งเดียว และหมดอายุใน ${mins} นาที</p>
  <p style="color:#5b6672">ห้ามบอกรหัสนี้กับผู้อื่น เจ้าหน้าที่จะไม่ขอรหัสนี้จากคุณ<br>
  ถ้าคุณไม่ได้ทำรายการนี้ ให้เพิกเฉยต่ออีเมลนี้</p>`;
}
