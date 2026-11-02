# ระบบแจ้งเคลมประกัน — Phase 1 (ยังไม่เชื่อม SharePoint)

ผู้ใช้ลงทะเบียนด้วยอีเมล + One-time code → Admin ตรวจสอบและอนุมัติ → จึงแจ้งเคลมและติดตามสถานะได้
ข้อมูลผู้ใช้และคำขอเคลมเก็บใน Upstash Redis ชั่วคราว (Phase 2 จะย้ายไป SharePoint)

## Flow

```
ลงทะเบียน ─► รหัสยืนยันทางอีเมล ─► บัญชี "รออนุมัติ" ─► Admin อนุมัติ + กำหนดโครงการ ─► แจ้งเคลม / ติดตามสถานะ
  (กรอกข้อมูล + ยินยอม PDPA)   (พิสูจน์ว่าเป็นเจ้าของอีเมล)  (Login ได้ แต่ใช้ฟอร์มไม่ได้)       (แจ้งผู้ใช้ทางอีเมล)
```

| สถานะบัญชี | Login | แจ้งเคลม / ดูคำขอ | เปลี่ยนโดย |
|---|---|---|---|
| `pending` รออนุมัติ | ได้ (เห็นหน้ารออนุมัติ) | ไม่ได้ | ระบบ หลังยืนยันรหัส |
| `approved` อนุมัติแล้ว | ได้ | ได้ เฉพาะโครงการที่กำหนด | Admin |
| `expired` หมดอายุ (เลยวันหมดสิทธิ์) | ไม่ได้ | ไม่ได้ | อัตโนมัติ |
| `suspended` ระงับ | ไม่ได้ (ถูกตัดทันที) | ไม่ได้ | Admin |
| `rejected` ไม่อนุมัติ | ไม่ได้ | ไม่ได้ | Admin |

สิทธิ์ถูกตรวจฝั่ง Server **ทุก Request** — ระงับหรือหมดอายุมีผลทันที

## Admin

- กำหนดใน `ADMIN_EMAILS` (คั่นด้วย ,) — Admin Login ได้เลยโดยไม่ต้องลงทะเบียน
- เมนู Admin → **ผู้ใช้งาน**: อนุมัติ / ไม่อนุมัติ / ระงับ / เปิดใช้อีกครั้ง / แก้โครงการและวันหมดสิทธิ์
- เมนู Admin → **คำขอเคลม**: เปลี่ยนสถานะ + ข้อความถึงผู้แจ้ง (ผู้แจ้งได้อีเมลแจ้ง) และดาวน์โหลด CSV
- **ก่อนอนุมัติ ต้องยืนยันตัวตนผ่านช่องทางอื่น** เช่น โทรกลับเบอร์ที่บริษัทมีอยู่ หรือสอบถามผู้ประสานงานโครงการ
  การยืนยันอีเมลพิสูจน์ได้แค่ว่าเป็นเจ้าของอีเมล ไม่ได้พิสูจน์ว่าเป็นใคร

## Setup: Cloudflare Turnstile (CAPTCHA)

ป้องกัน Bot ลงทะเบียน/ขอรหัสจำนวนมาก (Spam, ยิงอีเมลใส่คนอื่น, เปลืองโควตาอีเมล)
ใช้กับ: ลงทะเบียน, ขอรหัส Login และปุ่ม "ขอรหัสใหม่" — ผู้ใช้ส่วนใหญ่จะไม่เห็นอะไร (ขึ้นกล่องตรวจสอบเฉพาะเมื่อ Cloudflare สงสัย)

1. Cloudflare Dashboard (สมัครฟรีได้) → **Turnstile** → **Add widget**
2. Widget name: `claim-portal-prod` · Hostnames: โดเมนจริง และ `<project>.vercel.app` · Widget mode: **Managed**
3. Create → จด **Site key** และ **Secret key**
4. Production: ใส่คีย์จริง + `TURNSTILE_ALLOWED_HOSTNAMES` = โดเมนเดียวกับข้อ 2
5. Preview/Development: ใช้คีย์ทดสอบของ Cloudflare (ผ่านเสมอ)
   `TURNSTILE_SITE_KEY=1x00000000000000000000AA` · `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA`

พฤติกรรมฝั่ง Server:
- ตรวจ Token กับ Cloudflare ทุกครั้ง (Token ใช้ได้ครั้งเดียว), ตรวจ `action` (register/login แยกกัน) และ `hostname`
- Cloudflare ล่มหรือตอบผิดปกติ → **ปฏิเสธ** (Fail closed)
- Production ที่ไม่ได้ใส่คีย์ → ระบบ **ไม่ส่งรหัส** และขึ้น Error ใน Log (กันลืมตั้งค่า) — ปิดได้ด้วย `CAPTCHA_REQUIRED=false` เท่านั้น
- ⚠️ Turnstile ประมวลผล IP/ข้อมูล Browser ของผู้ใช้ — ให้ Legal ระบุใน Privacy notice และ Security review

## Setup: Vercel (ละเอียด)

### 1. Plan และ Team
- งานบริษัทต้องใช้ **Pro** ขึ้นไป (Hobby ห้ามใช้เชิงพาณิชย์ และเงื่อนไขการใช้ Content ต่างกัน) — ขออนุมัติ Procurement + Legal review ToS/DPA
- สร้าง **Team ในนามบริษัท** · เชิญเฉพาะผู้ดูแล · ทุกคนเปิด **2FA**
- ผู้ที่ Deploy ได้ = ผู้ที่ใช้สิทธิ์ส่งอีเมลของ App ได้ (ผ่าน OIDC) → จำกัดคนให้น้อยที่สุด

### 2. Import Project
Add New → Project → ติดตั้ง Vercel GitHub App แบบ **Only select repositories** → Import

| ช่อง | ค่า |
|---|---|
| Framework Preset | Other |
| Root Directory | `./` |
| Build Command / Output Directory | ว่าง |
| Node.js Version (Settings → Build & Deployment) | 22.x |

Region ของ Function = `sin1` (Singapore) กำหนดใน `vercel.json` แล้ว

### 3. แยกข้อมูล Production / Preview (สำคัญ)
| | Production | Preview / Development |
|---|---|---|
| Upstash Redis | **DB จริง** | **DB แยกสำหรับทดสอบ** (ห้ามใช้ DB จริง) |
| `MAIL_PROVIDER` | `graph` | `console` (รหัสแสดงใน Logs) |
| Turnstile | คีย์จริง | คีย์ทดสอบ |
| `OTP_PEPPER` | ค่าสุ่มชุดหนึ่ง | ค่าสุ่มอีกชุด |
| `ADMIN_EMAILS` | Admin จริง | อีเมลทีมทดสอบ |
| Federated credential (Entra) | มี (`environment:production`) | **ไม่มี** → Preview ส่งอีเมลจริงไม่ได้ |

สร้าง Upstash 2 DB (เช่น `claim-prod`, `claim-test`) แล้วตอน Connect เลือก Environment ให้ตรง
ตรวจที่ Settings → Environment Variables ว่าแต่ละค่าติ๊ก Environment ถูกต้อง

### 4. Environment Variables (Settings → Environment Variables)
| ตัวแปร | Production | หมายเหตุ |
|---|---|---|
| `APP_NAME` | ชื่อระบบ | |
| `APP_URL` | `https://<โดเมน>` | ใช้ในอีเมล |
| `ADMIN_EMAILS` | `a@...,b@...` | Admin เท่านั้นที่อนุมัติผู้ใช้/จัดการเคลมได้ |
| `MAIL_PROVIDER` | `graph` | |
| `MAIL_SENDER` | Shared mailbox | ต้องอยู่ใน Application Access Policy |
| `TENANT_ID`, `CLIENT_ID` | จาก App registration | |
| `CLIENT_SECRET` | **ว่าง** | ใช้ OIDC (ข้อ 5) |
| `CLAIM_NOTIFY_EMAIL` | อีเมลทีม Claim | ว่าง = ส่งหา Admin |
| `PRIVACY_NOTICE_URL` | ลิงก์จาก Legal/DPO | |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` 🔒 | คีย์จริง | |
| `TURNSTILE_ALLOWED_HOSTNAMES` | `<โดเมน>,<project>.vercel.app` | |
| `OTP_PEPPER` 🔒 | `openssl rand -base64 48` | |
| `OTP_TTL_MINUTES` / `SESSION_HOURS` | `10` / `8` | |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` 🔒 | ใส่อัตโนมัติจาก Integration | ตรวจว่าเป็น DB จริง |

🔒 = เปิด **Sensitive** · แก้ค่าแล้วต้อง **Redeploy**

### 5. OIDC Federation (ส่งอีเมลโดยไม่เก็บ Secret)
1. Vercel: Settings → **Security** → Secure backend access with OIDC federation → **Team** → Save
2. Entra: App registration (มีเฉพาะ `Mail.Send` + Admin consent) → Certificates & secrets → Federated credentials → Add → **Other**
   - Issuer `https://oidc.vercel.com/<TEAM_SLUG>`
   - Subject `owner:<TEAM_SLUG>:project:<PROJECT_NAME>:environment:production`
   - Audience `https://vercel.com/<TEAM_SLUG>`
3. Exchange Admin: จำกัด `Mail.Send` ให้ส่งจาก `MAIL_SENDER` เท่านั้น

### 6. Deployment Protection
Settings → Deployment Protection → **Vercel Authentication** สำหรับ Preview (Standard Protection)
Production เปิดสาธารณะ (มีระบบ Login ของเราเอง)

### 7. Domain (ถ้าใช้โดเมนบริษัท)
Settings → Domains → Add → ส่งค่า DNS ให้ Network Admin (ผ่าน Change Management)
แล้วเพิ่มโดเมนใน Turnstile widget และ `TURNSTILE_ALLOWED_HOSTNAMES` → Redeploy

### 8. Git
Settings → Git → Production Branch = `main` · เปิด Branch protection บน GitHub

### 9. Logs และ Audit
- ดูที่ Project → **Logs** (ค้น `audit`, `error`, `captcha_failed`)
- Log ของ Vercel เก็บจำกัดเวลา — ถ้าต้องเก็บ Audit ตามนโยบายบริษัท ใช้ **Log Drains** ส่งเข้า SIEM/ระบบ Log กลาง
- Audit ล่าสุด 10,000 รายการเก็บใน Redis key `audit` ด้วย

### 10. Firewall / ค่าใช้จ่าย (ถ้าแผนรองรับ)
- Firewall: ตั้ง Rate limit rule เพิ่มที่ `/api/auth/*` และใช้ Attack Challenge Mode เมื่อถูกโจมตี
- Spend Management: ตั้งงบและการแจ้งเตือน กันค่าใช้จ่ายพุ่งจากการโจมตี

### 11. ตรวจหลัง Deploy
1. `https://<โดเมน>/api/config` → มี `turnstileSiteKey` (คีย์จริง ไม่ใช่ `1x000...`)
2. ลงทะเบียนด้วยอีเมลทดสอบ → ได้รหัส → หน้า "รออนุมัติ" → Admin ได้อีเมล
3. Admin อนุมัติ → ผู้ใช้แจ้งเคลมได้ → Admin เปลี่ยนสถานะ → ผู้ใช้ได้อีเมล
4. ทำ Test checklist ด้านล่างให้ครบ

| ข้อความใน Log | สาเหตุ / วิธีแก้ |
|---|---|
| `Missing environment variable: X` | ไม่ได้ใส่ตัวแปร → ใส่แล้ว Redeploy |
| `CAPTCHA is required but ...` | Production ยังไม่ใส่คีย์ Turnstile |
| `captcha_failed ... invalid-input-secret` | Secret key ผิด |
| `captcha_failed ... hostname-mismatch` | โดเมนไม่อยู่ใน `TURNSTILE_ALLOWED_HOSTNAMES` |
| `captcha_failed ... siteverify-unreachable` | ติดต่อ Cloudflare ไม่ได้ (ระบบปฏิเสธเพื่อความปลอดภัย) |
| `No Vercel OIDC token` | ยังไม่เปิด OIDC (ข้อ 5.1) |
| `Token request failed: 400/401` | Federated credential ไม่ตรง (Team/Project/Environment) |
| `sendMail failed: 403` | `MAIL_SENDER` ไม่อยู่ใน Application Access Policy |
| `MAIL_PROVIDER=console is not allowed in production` | Production ต้องใช้ `graph` |
| Login แล้วเด้งกลับ | Upstash ไม่ทำงาน หรือเปิดผ่าน http |

## Test checklist

- [ ] ลงทะเบียน → ได้รหัส → ยืนยัน → เห็นหน้า "รออนุมัติ" และ Admin ได้อีเมลแจ้ง
- [ ] ผู้ใช้ pending เรียก `/api/claims` ตรง ๆ → 403
- [ ] ลงทะเบียนซ้ำด้วยอีเมลเดิม → ได้ข้อความเหมือนกัน (ไม่บอกว่ามีบัญชีแล้ว) และอีเมลเจ้าของได้รับแจ้ง
- [ ] รหัสลงทะเบียนใช้ Login ไม่ได้ และกลับกัน
- [ ] Admin อนุมัติพร้อมโครงการ → ผู้ใช้ได้อีเมล → แจ้งเคลมได้เฉพาะโครงการนั้น
- [ ] ส่งโครงการอื่น (แก้ Request เอง) → 403
- [ ] Admin ระงับ → ผู้ใช้ที่ Login อยู่ถูกตัดทันที
- [ ] วันหมดสิทธิ์ผ่านไปแล้ว → Login ไม่ได้
- [ ] Admin เปลี่ยนสถานะเคลม → ผู้แจ้งเห็นใน "คำขอของฉัน" และได้อีเมล
- [ ] ผู้ใช้ทั่วไปเรียก `/api/admin/*` → 403
- [ ] CSV เปิดใน Excel ภาษาไทยถูกต้อง และค่าที่ขึ้นต้นด้วย `=` ไม่ถูกคำนวณ
- [ ] เรียก `/api/auth/register-start` หรือ `/api/auth/request-otp` โดยไม่มี `captchaToken` → 400 และไม่มีอีเมลออก
- [ ] Production `/api/config` ไม่ใช่คีย์ทดสอบ `1x000...`

## Security controls

- OTP แยกตามวัตถุประสงค์ (ลงทะเบียน/Login), เก็บเฉพาะ HMAC, หมดอายุ, ใช้ครั้งเดียว, ผิด 5 ครั้งล็อก, Rate limit
- ไม่เปิดเผยว่าอีเมลใดลงทะเบียนแล้ว (ทั้งตอนลงทะเบียนและ Login)
- Session Cookie `__Host-` HttpOnly/Secure/SameSite=Strict; ตรวจสถานะบัญชีทุก Request
- แจ้งเคลมได้เฉพาะโครงการที่ Admin กำหนด; `submittedBy` มาจาก Session
- Admin เปลี่ยนสถานะบัญชีตัวเองไม่ได้; ทุก Action ของ Admin มี Audit log และประวัติในข้อมูล
- CSV ป้องกัน Formula injection
- CAPTCHA (Turnstile) บนทุก Endpoint ที่ส่งอีเมล; ตรวจ action/hostname; Fail closed
- เก็บเวลาที่ผู้ใช้ให้ความยินยอม (`consentAt`)

## ข้อจำกัด Phase 1 / สิ่งที่ต้องทำใน Phase 2

- ข้อมูลอยู่ใน Upstash (SaaS นอก Tenant) — ต้องผ่าน Security/PDPA review; ควรกำหนดระยะเวลาเก็บข้อมูล
- ยังไม่มีการดูกรมธรรม์/PDF และการแนบรูป (ต้องใช้ SharePoint)
- โครงการพิมพ์เองโดย Admin (Phase 2 ดึงจาก Sheet Entity)
- Phase 2: เปลี่ยน `lib/users.js` และ `lib/claims.js` ให้อ่าน/เขียน SharePoint และย้ายข้อมูลเดิมจาก Redis
