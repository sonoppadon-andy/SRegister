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

## Setup

1. **อีเมล** (เลือกอย่างใดอย่างหนึ่ง)
   - ใช้งานจริง: `MAIL_PROVIDER=graph` — App registration ที่มีเฉพาะ `Mail.Send` (Application) + Admin consent
     จำกัดให้ส่งได้จาก Shared Mailbox เดียว (Application Access Policy / RBAC for Applications)
     ใช้ Vercel OIDC federation แทน Client secret (Federated credential: Issuer `https://oidc.vercel.com/<TEAM_SLUG>`,
     Subject `owner:<TEAM_SLUG>:project:<PROJECT>:environment:production`, Audience `https://vercel.com/<TEAM_SLUG>`)
   - ทดสอบ: `MAIL_PROVIDER=console` — รหัสจะแสดงใน Vercel Logs (ระบบไม่ยอมให้ใช้ใน Production)
2. **Upstash Redis**: Vercel → Storage / Marketplace → Upstash → Region ใกล้ Singapore → Connect
3. **Environment Variables** ตาม `.env.example` — `OTP_PEPPER`: `openssl rand -base64 48`
4. **PRIVACY_NOTICE_URL**: ลิงก์ประกาศความเป็นส่วนตัวจาก Legal/DPO (ข้อความยินยอมในฟอร์มต้องให้ Legal ตรวจ)
5. Push ไป GitHub (Private) → Import ใน Vercel (Framework: Other) → Deploy

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

## Security controls

- OTP แยกตามวัตถุประสงค์ (ลงทะเบียน/Login), เก็บเฉพาะ HMAC, หมดอายุ, ใช้ครั้งเดียว, ผิด 5 ครั้งล็อก, Rate limit
- ไม่เปิดเผยว่าอีเมลใดลงทะเบียนแล้ว (ทั้งตอนลงทะเบียนและ Login)
- Session Cookie `__Host-` HttpOnly/Secure/SameSite=Strict; ตรวจสถานะบัญชีทุก Request
- แจ้งเคลมได้เฉพาะโครงการที่ Admin กำหนด; `submittedBy` มาจาก Session
- Admin เปลี่ยนสถานะบัญชีตัวเองไม่ได้; ทุก Action ของ Admin มี Audit log และประวัติในข้อมูล
- CSV ป้องกัน Formula injection
- เก็บเวลาที่ผู้ใช้ให้ความยินยอม (`consentAt`)

## ข้อจำกัด Phase 1 / สิ่งที่ต้องทำใน Phase 2

- ข้อมูลอยู่ใน Upstash (SaaS นอก Tenant) — ต้องผ่าน Security/PDPA review; ควรกำหนดระยะเวลาเก็บข้อมูล
- ยังไม่มีการดูกรมธรรม์/PDF และการแนบรูป (ต้องใช้ SharePoint)
- โครงการพิมพ์เองโดย Admin (Phase 2 ดึงจาก Sheet Entity)
- Phase 2: เปลี่ยน `lib/users.js` และ `lib/claims.js` ให้อ่าน/เขียน SharePoint และย้ายข้อมูลเดิมจาก Redis
- ถ้าเปิดลงทะเบียนบน Internet ควรเพิ่ม CAPTCHA (เช่น Cloudflare Turnstile) เพื่อลด Spam
