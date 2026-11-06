'use strict';
// Test page: send a one-time code by email and verify it. No database.
// All text is rendered with textContent (never innerHTML).

const state = { config: { appName: 'ระบบแจ้งเคลมประกัน', turnstileSiteKey: '', claimForm: [], privacyNoticeUrl: '' }, me: null };
const root = document.getElementById('app');

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'value') n.value = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

async function api(path, body) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await r.json(); } catch { /* empty */ }
  if (!r.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
  return data;
}

const setMsg = (node, text, isError) => { node.textContent = text || ''; node.classList.toggle('error', !!isError); };
const busy = (btn, on, label) => { btn.disabled = on; if (label) btn.textContent = label; };

/* ---------- Cloudflare Turnstile ---------- */
const captcha = {
  loading: null,
  load() {
    if (!state.config.turnstileSiteKey) return Promise.resolve(false);
    if (window.turnstile) return Promise.resolve(true);
    this.loading ||= new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => ok(true);
      s.onerror = () => { this.loading = null; fail(new Error('โหลดระบบตรวจสอบความปลอดภัยไม่สำเร็จ')); };
      document.head.append(s);
    });
    return this.loading;
  },
  async token(slot) {
    if (!(await this.load())) return '';
    if (slot.dataset.widget) { try { window.turnstile.remove(slot.dataset.widget); } catch { /* ignore */ } }
    slot.replaceChildren();
    return new Promise((ok, fail) => {
      slot.dataset.widget = window.turnstile.render(slot, {
        sitekey: state.config.turnstileSiteKey,
        action: 'otp',
        appearance: 'interaction-only',
        language: 'auto',
        callback: ok,
        'error-callback': () => fail(new Error('การตรวจสอบความปลอดภัยไม่สำเร็จ กรุณาลองใหม่')),
        'timeout-callback': () => fail(new Error('หมดเวลาตรวจสอบความปลอดภัย กรุณาลองใหม่')),
      });
    });
  },
};

/* ---------- screens ---------- */
function shell(...content) {
  root.replaceChildren(el('main', { class: 'login' }, el('section', { class: 'login-panel' }, ...content)));
}

async function requestCode(email, slot, purpose) {
  const captchaToken = await captcha.token(slot);
  return api('/api/otp/send', { email, captchaToken, purpose });
}

const field = (id, label, control, { required, hint } = {}) =>
  el('div', { class: 'field' },
    el('label', { for: id }, label, required ? el('span', { class: 'req', text: ' *', 'aria-hidden': 'true' }) : null),
    hint ? el('p', { class: 'hint', text: hint }) : null,
    control);

/** Login: email -> code */
function emailStep(prefill = '') {
  const input = el('input', { class: 'input', id: 'email', type: 'email', autocomplete: 'email', required: true, value: prefill });
  const slot = el('div', { class: 'captcha' });
  const btn = el('button', { class: 'btn full', type: 'submit', text: 'ส่งรหัสเข้าสู่ระบบ' });
  const msg = el('p', { class: 'msg', role: 'status' });
  const form = el('form', { novalidate: true }, field('email', 'อีเมล', input), slot, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!email) return setMsg(msg, 'กรุณากรอกอีเมล', true);
    busy(btn, true, 'กำลังส่ง…');
    try {
      const sent = await requestCode(email, slot, 'login');
      codeStep(email, sent, {
        purpose: 'login',
        onBack: () => emailStep(email),
        onVerify: async (challenge, code) => { await api('/api/otp/verify', { challenge, code }); await startApp(); },
      });
    } catch (err) { setMsg(msg, err.message, true); busy(btn, false, 'ส่งรหัสเข้าสู่ระบบ'); }
  });
  shell(
    el('h1', { text: state.config.appName }),
    el('p', { class: 'lead', text: 'เข้าสู่ระบบด้วยอีเมลที่ลงทะเบียนไว้ ระบบจะส่งรหัส 6 หลักไปที่อีเมล' }),
    form, msg,
    el('p', { class: 'foot' }, 'ยังไม่มีบัญชี? ', el('button', { class: 'link', type: 'button', text: 'ลงทะเบียน', onclick: () => registerStep({ email: input.value.trim() }) })));
  input.focus();
}

/** Register: details -> code -> request emailed to Admin */
function registerStep(prev = {}) {
  const inp = (id, attrs) => el('input', { class: 'input', id, ...attrs });
  const c = {
    email: inp('r-email', { type: 'email', autocomplete: 'email', maxlength: '254', value: prev.email }),
    name: inp('r-name', { autocomplete: 'name', maxlength: '100', value: prev.name }),
    company: inp('r-company', { autocomplete: 'organization', maxlength: '150', value: prev.company }),
    phone: inp('r-phone', { type: 'tel', autocomplete: 'tel', maxlength: '30', value: prev.phone }),
    requestedProjects: inp('r-projects', { maxlength: '300', value: prev.requestedProjects }),
    reason: el('textarea', { class: 'input', id: 'r-reason', rows: '3', maxlength: '500', value: prev.reason }),
  };
  const consent = el('input', { type: 'checkbox', id: 'r-consent' });
  const privacy = state.config.privacyNoticeUrl
    ? el('a', { href: state.config.privacyNoticeUrl, target: '_blank', rel: 'noopener', text: 'ประกาศความเป็นส่วนตัว' })
    : 'ประกาศความเป็นส่วนตัวของบริษัท';
  const slot = el('div', { class: 'captcha' });
  const btn = el('button', { class: 'btn full', type: 'submit', text: 'ส่งรหัสยืนยันไปที่อีเมล' });
  const msg = el('p', { class: 'msg', role: 'status' });

  const form = el('form', { novalidate: true },
    field('r-email', 'อีเมล', c.email, { required: true, hint: 'ใช้อีเมลของคุณเอง ระบบจะส่งรหัสยืนยันไปที่อีเมลนี้' }),
    field('r-name', 'ชื่อ-นามสกุล', c.name, { required: true }),
    field('r-company', 'บริษัท / หน่วยงาน', c.company, { required: true }),
    field('r-phone', 'เบอร์โทรศัพท์', c.phone, { required: true }),
    field('r-projects', 'โครงการที่ต้องการแจ้งเคลม', c.requestedProjects, { required: true, hint: 'ถ้ามีหลายโครงการ คั่นด้วยเครื่องหมายจุลภาค (,)' }),
    field('r-reason', 'ความเกี่ยวข้องกับโครงการ / หมายเหตุ', c.reason),
    el('div', { class: 'check' }, consent, el('label', { for: 'r-consent' }, 'ข้าพเจ้ายินยอมให้บริษัทเก็บและใช้ข้อมูลข้างต้นเพื่อพิจารณาสิทธิ์และดำเนินการเรื่องเคลม ตาม', ' ', privacy)),
    slot, btn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(Object.entries(c).map(([k, x]) => [k, x.value.trim()]));
    for (const k of ['email', 'name', 'company', 'phone', 'requestedProjects']) {
      if (!data[k]) { c[k].focus(); return setMsg(msg, 'กรุณากรอกข้อมูลที่มีเครื่องหมาย * ให้ครบ', true); }
    }
    if (!consent.checked) return setMsg(msg, 'กรุณายอมรับการเก็บและใช้ข้อมูลส่วนบุคคล', true);
    busy(btn, true, 'กำลังส่ง…');
    try {
      const sent = await requestCode(data.email, slot, 'register');
      codeStep(data.email, sent, {
        purpose: 'register',
        onBack: () => registerStep(data),
        onVerify: async (challenge, code) => {
          await api('/api/register', { ...data, consent: true, challenge, code });
          await startApp();
        },
      });
    } catch (err) { setMsg(msg, err.message, true); busy(btn, false, 'ส่งรหัสยืนยันไปที่อีเมล'); }
  });

  shell(
    el('h1', { text: 'ลงทะเบียน' }),
    el('p', { class: 'lead', text: 'ขั้นตอน: 1) กรอกข้อมูล 2) ยืนยันรหัสจากอีเมล 3) รอ Admin ตรวจสอบและอนุมัติ' }),
    form, msg,
    el('p', { class: 'foot' }, 'มีบัญชีแล้ว? ', el('button', { class: 'link', type: 'button', text: 'เข้าสู่ระบบ', onclick: () => emailStep(c.email.value.trim()) })));
  c.email.focus();
}

/** Shared "enter the 6-digit code" step. */
function codeStep(email, sent, { purpose, onVerify, onBack }) {
  let challenge = sent.challenge;
  const input = el('input', { class: 'input code', id: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', required: true });
  const btn = el('button', { class: 'btn full', type: 'submit', text: 'ยืนยันรหัส' });
  const msg = el('p', { class: 'msg', role: 'status' });
  const slot = el('div', { class: 'captcha' });
  const resend = el('button', { class: 'link', type: 'button' });
  let left = 60, timer;
  const tick = () => {
    resend.textContent = left > 0 ? `ขอรหัสใหม่ได้ใน ${left} วินาที` : 'ขอรหัสใหม่';
    resend.disabled = left > 0;
    if (left-- > 0) timer = setTimeout(tick, 1000);
  };
  tick();
  resend.addEventListener('click', async () => {
    resend.disabled = true;
    try {
      challenge = (await requestCode(email, slot, purpose)).challenge; // older codes stop working
      setMsg(msg, 'ส่งรหัสใหม่แล้ว ใช้รหัสล่าสุดเท่านั้น');
      left = 60; clearTimeout(timer); tick();
    } catch (err) { setMsg(msg, err.message, true); resend.disabled = false; }
  });
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); });

  const form = el('form', { novalidate: true },
    field('code', 'รหัส 6 หลักจากอีเมล', input),
    btn,
    el('div', { class: 'row-actions' },
      el('button', { class: 'link', type: 'button', text: 'ย้อนกลับ', onclick: () => { clearTimeout(timer); onBack(); } }),
      resend),
    slot);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(input.value)) return setMsg(msg, 'กรุณากรอกรหัส 6 หลัก', true);
    busy(btn, true, 'กำลังตรวจสอบ…');
    try { await onVerify(challenge, input.value); clearTimeout(timer); }
    catch (err) { setMsg(msg, err.message, true); busy(btn, false, 'ยืนยันรหัส'); input.select(); }
  });

  shell(
    el('h1', { text: purpose === 'register' ? 'ยืนยันอีเมล' : state.config.appName }),
    el('p', { class: 'lead' }, sent.message, el('br'), el('span', { class: 'muted', text: 'ตรวจกล่องจดหมาย รวมถึง Junk/Spam' })),
    form, msg);
  input.focus();
}

/** Logged in but not approved yet */
function pendingView() {
  const refresh = el('button', { class: 'btn', type: 'button', text: 'ตรวจสอบสถานะอีกครั้ง' });
  const msg = el('p', { class: 'msg', role: 'status' });
  refresh.addEventListener('click', async () => {
    busy(refresh, true, 'กำลังตรวจสอบ…');
    try { await startApp(); if (!state.me.approved) setMsg(msg, 'ยังรอการอนุมัติ'); }
    catch (err) { setMsg(msg, err.message, true); }
    finally { busy(refresh, false, 'ตรวจสอบสถานะอีกครั้ง'); }
  });
  shell(
    el('h1', { text: 'รอการอนุมัติ' }),
    el('p', { class: 'lead', text: `ยืนยันอีเมล ${state.me.email} แล้ว` }),
    el('p', { text: 'Admin จะตรวจสอบข้อมูลของคุณ เมื่ออนุมัติแล้วจึงจะแจ้งเคลมและติดตามสถานะได้' }),
    el('p', { class: 'muted', text: 'ถ้ายังไม่ได้ลงทะเบียน ให้ออกจากระบบแล้วเลือก "ลงทะเบียน"' }),
    el('div', { class: 'form-actions' }, refresh,
      el('button', { class: 'btn ghost', type: 'button', text: 'ออกจากระบบ', onclick: logout })),
    msg);
}

/* ================= APP (preview, no database) ================= */

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());

async function startApp() {
  state.me = await api('/api/me');
  if (!state.me.approved) return pendingView();
  renderShell('policies');
}

async function logout() {
  try { await api('/api/auth/logout', {}); } catch { /* ignore */ }
  state.me = null;
  emailStep();
}

function previewBanner() {
  return el('p', { class: 'banner', role: 'note', text: 'โหมดทดลอง: ยังไม่เชื่อมต่อฐานข้อมูล ข้อมูลที่กรอกจะไม่ถูกบันทึกหรือส่งไปที่ใด' });
}

function renderShell(view) {
  const views = [
    { id: 'policies', label: 'กรมธรรม์' },
    { id: 'claim', label: 'แจ้งเคลม' },
    { id: 'myclaims', label: 'คำขอของฉัน' },
    state.me.isAdmin && { id: 'admin', label: 'Admin' },
  ].filter(Boolean);
  if (!views.some((v) => v.id === view)) view = 'policies';

  const nav = el('nav', { class: 'tabs', 'aria-label': 'เมนูหลัก' },
    views.map((v) => el('button', { type: 'button', class: 'tab', 'aria-current': v.id === view ? 'page' : 'false', text: v.label, onclick: () => renderShell(v.id) })));
  const body = el('section', { class: 'page' }, previewBanner());

  root.replaceChildren(
    el('header', { class: 'topbar' },
      el('div', { class: 'brand', text: state.config.appName }),
      nav,
      el('div', { class: 'user' }, el('span', { text: state.me.email }),
        el('button', { class: 'btn ghost small', type: 'button', text: 'ออกจากระบบ', onclick: logout }))),
    el('div', { class: 'view' }, body));

  ({ policies: viewPolicies, claim: viewClaim, myclaims: viewMyClaims, admin: viewAdmin })[view](body);
}

function placeholder(body, title, sub, lines) {
  body.append(
    el('h2', { text: title }),
    el('p', { class: 'sub', text: sub }),
    el('div', { class: 'card' },
      el('p', { class: 'muted', text: 'ส่วนนี้จะใช้งานได้เมื่อเชื่อมต่อระบบ:' }),
      el('ul', { class: 'plain' }, lines.map((t) => el('li', { text: t })))));
}

function viewPolicies(body) {
  placeholder(body, 'กรมธรรม์', 'ข้อมูลกรมธรรม์ของโครงการที่คุณได้รับสิทธิ์', [
    'รายชื่อโครงการและกรมธรรม์จาก SharePoint (Master.xlsx → Sheet Entity)',
    'เปิดเอกสาร PDF กรมธรรม์',
    'แสดงเฉพาะโครงการที่ Admin อนุญาต',
  ]);
}

function viewMyClaims(body) {
  body.append(
    el('h2', { text: 'คำขอของฉัน' }),
    el('p', { class: 'sub', text: 'คำขอแจ้งเคลมที่คุณส่ง และสถานะล่าสุด' }),
    el('div', { class: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, ['เลขที่คำขอ', 'วันที่ส่ง', 'โครงการ', 'กรมธรรม์', 'สถานะ', 'ข้อความจากทีมงาน'].map((h) => el('th', { scope: 'col', text: h })))),
      el('tbody', {}, el('tr', {}, el('td', { colspan: '6', class: 'muted', text: 'ยังไม่มีข้อมูล (จะแสดงเมื่อเชื่อมต่อฐานข้อมูล)' }))))));
}

function viewAdmin(body) {
  placeholder(body, 'Admin', 'สำหรับผู้ดูแลระบบเท่านั้น', [
    'อนุมัติ / ไม่อนุมัติ / ระงับผู้ลงทะเบียน และกำหนดโครงการที่อนุญาต',
    'ดูคำขอเคลมทั้งหมด เปลี่ยนสถานะ และส่งข้อความถึงผู้แจ้ง',
    'ดาวน์โหลดรายงาน CSV',
  ]);
}

function viewClaim(body) {
  const msg = el('p', { class: 'msg', role: 'status' });
  const inputs = {};
  const fields = state.config.claimForm.map((f) => {
    const id = `c-${f.name}`;
    const attrs = { class: 'input', id, required: !!f.required, maxlength: f.max ? String(f.max) : null };
    let control;
    if (f.type === 'textarea') control = el('textarea', { ...attrs, rows: '5' });
    else if (f.type === 'date') control = el('input', { ...attrs, type: 'date', max: today() });
    else if (f.type === 'number') control = el('input', { ...attrs, type: 'number', min: '0', step: '0.01', inputmode: 'decimal' });
    else if (f.type === 'tel') control = el('input', { ...attrs, type: 'tel', autocomplete: 'tel' });
    else control = el('input', { ...attrs, type: 'text' });
    inputs[f.name] = control;
    return el('div', { class: f.type === 'textarea' ? 'span-2' : null },
      el('div', { class: 'field' },
        el('label', { for: id }, f.label, f.required ? el('span', { class: 'req', text: ' *', 'aria-hidden': 'true' }) : null),
        control));
  });

  const btn = el('button', { class: 'btn', type: 'submit', text: 'ตรวจสอบแบบฟอร์ม' });
  const form = el('form', { class: 'claim-form', novalidate: true },
    el('div', { class: 'form-grid' }, fields),
    el('p', { class: 'note', text: 'ห้ามใส่รหัสผ่าน เลขบัตรประชาชน หรือข้อมูลบัตรเครดิตในแบบฟอร์ม' }),
    el('div', { class: 'form-actions' }, btn, msg));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    for (const f of state.config.claimForm) {
      const v = inputs[f.name].value.trim();
      if (f.required && !v) { inputs[f.name].focus(); return setMsg(msg, `กรุณากรอก "${f.label}"`, true); }
      if (f.type === 'date' && v && v > today()) { inputs[f.name].focus(); return setMsg(msg, `"${f.label}" ต้องไม่เป็นวันในอนาคต`, true); }
      if (f.type === 'number' && v && Number(v) < 0) { inputs[f.name].focus(); return setMsg(msg, `"${f.label}" ต้องไม่ติดลบ`, true); }
    }
    // Preview only: nothing is sent to the server.
    setMsg(msg, 'แบบฟอร์มถูกต้อง (โหมดทดลอง: ยังไม่ส่งและไม่บันทึกข้อมูล)');
  });

  body.append(
    el('h2', { text: 'แจ้งเคลม' }),
    el('p', { class: 'sub', text: 'ตัวอย่างแบบฟอร์ม เพื่อให้ทีม Claim ตรวจสอบช่องข้อมูลก่อนเปิดใช้งานจริง' }),
    form);
}

(async () => {
  try { state.config = { ...state.config, ...(await api('/api/config')) }; } catch { /* defaults */ }
  try { await startApp(); } catch { emailStep(); }
})();
