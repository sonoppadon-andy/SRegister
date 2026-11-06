# ทดสอบส่งรหัส OTP ทางอีเมล (ไม่มี Database)

เวอร์ชันนี้ทำ 2 อย่าง: **ส่งรหัส 6 หลักไปที่อีเมล** และ **ตรวจรหัส** — ยังไม่มีการลงทะเบียน การอนุมัติ หรือการบันทึกข้อมูล
ใช้ทดสอบว่า Microsoft 365, Turnstile และ Vercel ตั้งค่าถูกต้องก่อนต่อ Database

## วิธีทำงานโดยไม่มี Database

1. `POST /api/otp/send` สร้างรหัส ส่งอีเมล และคืน **challenge** ที่ Server เซ็นด้วย `OTP_PEPPER`
   (มีอีเมล, เวลาหมดอายุ, และ Hash ของรหัส — **ไม่มีตัวรหัส**)
2. ผู้ใช้กรอกรหัส → `POST /api/otp/verify` ส่ง challenge + รหัสกลับมา → Server ตรวจลายเซ็น เวลา และรหัส

## Environment Variables (Vercel)

| ตัวแปร | ค่า |
|---|---|
| `MAIL_PROVIDER` | `graph` (Production) / `console` (Preview) |
| `MAIL_SENDER` | `s.noreply@singhaestate.co.th` |
| `TENANT_ID`, `CLIENT_ID` | จาก App registration |
| `ALLOWED_EMAIL_DOMAINS` | แนะนำ `singhaestate.co.th` ช่วงทดสอบ |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` 🔒, `TURNSTILE_ALLOWED_HOSTNAMES` | จาก Cloudflare |
| `OTP_PEPPER` 🔒 | อย่างน้อย 32 ตัวอักษร (`openssl rand -base64 48`) |

**ไม่ต้องมี** Upstash/Redis และตัวแปร `UPSTASH_*`, `ADMIN_EMAILS`, `CLAIM_NOTIFY_EMAIL`, `PRIVACY_NOTICE_URL` (ลบออกได้)

## ทดสอบ

1. Redeploy → เปิด `/api/config` ต้องเห็น `turnstileSiteKey`
2. เปิดหน้าเว็บ → กรอกอีเมล → ได้อีเมลรหัส → กรอกรหัส → "ยืนยันอีเมลสำเร็จ"
3. Vercel Logs: `otp_sent`, `otp_verified` (หรือดูสาเหตุที่ `captcha_failed`, `otp_failed`, `error`)

## ⚠️ ข้อจำกัดของเวอร์ชันไม่มี Database (ห้ามใช้เป็นระบบ Login จริง)

- **Rate limit และการล็อกเมื่อกรอกผิด 5 ครั้งเป็นแบบ "พยายามดีที่สุด"** — นับในหน่วยความจำของแต่ละ Instance
  ถ้า Vercel รันหลาย Instance ตัวนับจะไม่รวมกัน → ผู้โจมตีอาจลองรหัสได้มากกว่า 5 ครั้ง
- **รหัสใช้ซ้ำได้ในบาง Instance** ภายในเวลาที่ยังไม่หมดอายุ
- สิ่งที่ช่วยลดความเสี่ยงตอนนี้: CAPTCHA ทุกครั้งที่ขอรหัส, รหัสหมดอายุ 10 นาที, `ALLOWED_EMAIL_DOMAINS`
  และ (ถ้าแผนรองรับ) ตั้ง Vercel Firewall Rate limit ที่ `/api/otp/*`
- เมื่อต่อ Database (Phase ถัดไป) จะได้ Rate limit/ล็อก/ใช้ครั้งเดียวที่แม่นยำ แล้วจึงใช้กับการลงทะเบียนจริง
