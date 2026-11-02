'use strict';
// All data is rendered with textContent (never innerHTML) to prevent XSS.

const state = { config: { appName: 'ระบบแจ้งเคลมประกัน', claimForm: [], statuses: [], privacyNoticeUrl: '', turnstileSiteKey: '' }, me: null, view: null };
const root = document.getElementById('app');

/* ================= helpers ================= */

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
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

async function api(path, { body } = {}) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await r.json(); } catch { /* empty */ }
  if (r.status === 401 && !path.startsWith('/api/auth')) {
    showLogin(state.me ? data.error : undefined);
    throw Object.assign(new Error('unauthorized'), { silent: true });
  }
  if (r.status === 403 && data.status && state.me) {
    // approval was withdrawn while the page was open
    startApp().catch(() => {});
    throw Object.assign(new Error(data.error), { silent: true });
  }
  if (!r.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
  return data;
}

const setMsg = (node, text, isError) => { node.textContent = text || ''; node.classList.toggle('error', !!isError); };
const busy = (btn, on, label) => { btn.disabled = on; if (label) btn.textContent = label; };
const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('th-TH', { maximumFractionDigits: 2 }) : v === '' || v == null ? '–' : String(v));
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }) : '–');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());

const STATUS_TH = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', suspended: 'ระงับ', expired: 'หมดอายุ' };
const badge = (status, label) => el('span', { class: `status s-${String(status).toLowerCase().replace(/\s+/g, '-')}`, text: label || status });

function field(id, label, control, { required, hint } = {}) {
  return el('div', { class: 'field' },
    el('label', { for: id }, label, required ? el('span', { class: 'req', text: ' *', 'aria-hidden': 'true' }) : null),
    hint ? el('p', { class: 'hint', text: hint }) : null,
    control);
}

/** Shared "enter the 6-digit code" step. onVerify(code) must throw Error(message) on failure. */
function codeStep(panel, msg, { email, info, onVerify, onResend, onBack }) {
  const slot = el('div', { class: 'captcha' });
  const input = el('input', { class: 'input code', id: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', pattern: '[0-9]{6}', required: true });
  const btn = el('button', { class: 'btn full', type: 'submit', text: 'ยืนยันรหัส' });
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
    try { setMsg(msg, await onResend(slot)); left = 60; clearTimeout(timer); tick(); }
    catch (err) { setMsg(msg, err.message, true); resend.disabled = false; }
  });
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); });
  const form = el('form', { novalidate: true },
    field('code', 'รหัส 6 หลักจากอีเมล', input),
    btn,
    el('div', { class: 'row-actions' }, el('button', { class: 'link', type: 'button', text: 'ย้อนกลับ', onclick: () => { clearTimeout(timer); onBack(); } }), resend),
    slot);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(input.value)) return setMsg(msg, 'กรุณากรอกรหัส 6 หลัก', true);
    busy(btn, true, 'กำลังตรวจสอบ…');
    try { await onVerify(input.value); clearTimeout(timer); }
    catch (err) { if (!err.silent) { setMsg(msg, err.message, true); busy(btn, false, 'ยืนยันรหัส'); input.select(); } }
  });
  panel.replaceChildren(
    el('h1', { text: state.config.appName }),
    el('p', { class: 'lead' }, info || '', el('br'), el('span', { class: 'muted', text: `อีเมล: ${email}` })),
    form, msg);
  setMsg(msg, '');
  input.focus();
}

/* ================= CAPTCHA (Cloudflare Turnstile) ================= */

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
      s.onerror = () => { this.loading = null; fail(new Error('โหลดระบบตรวจสอบความปลอดภัยไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่')); };
      document.head.append(s);
    });
    return this.loading;
  },
  /** Gets a fresh single-use token. The widget only becomes visible if Cloudflare needs the user to interact. */
  async token(slot, action) {
    if (!(await this.load())) return '';
    if (slot.dataset.widget) { try { window.turnstile.remove(slot.dataset.widget); } catch { /* ignore */ } }
    slot.replaceChildren();
    return new Promise((ok, fail) => {
      const fails = (m) => () => fail(new Error(m));
      slot.dataset.widget = window.turnstile.render(slot, {
        sitekey: state.config.turnstileSiteKey,
        action,
        appearance: 'interaction-only',
        language: 'auto',
        callback: ok,
        'error-callback': fails('การตรวจสอบความปลอดภัยไม่สำเร็จ กรุณาลองใหม่'),
        'timeout-callback': fails('หมดเวลาตรวจสอบความปลอดภัย กรุณาลองใหม่'),
        'expired-callback': () => {},
      });
    });
  },
};

/* ================= LOGIN ================= */

function authShell() {
  state.me = null;
  document.title = state.config.appName;
  const panel = el('section', { class: 'login-panel' });
  root.replaceChildren(el('main', { class: 'login' }, panel));
  return { panel, msg: el('p', { class: 'msg', role: 'status' }) };
}

function showLogin(notice, prefill = '') {
  const { panel, msg } = authShell();
  const input = el('input', { class: 'input', id: 'email', type: 'email', autocomplete: 'email', required: true, value: prefill });
  const btn = el('button', { class: 'btn full', type: 'submit', text: 'ส่งรหัสเข้าสู่ระบบ' });
  const slot = el('div', { class: 'captcha' });
  const form = el('form', { novalidate: true }, field('email', 'อีเมล', input), slot, btn);
  const request = async (email, where = slot) => {
    const captchaToken = await captcha.token(where, 'login');
    return (await api('/api/auth/request-otp', { body: { email, captchaToken } })).message;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!email) return setMsg(msg, 'กรุณากรอกอีเมล', true);
    busy(btn, true, 'กำลังตรวจสอบ…');
    try {
      const info = await request(email);
      codeStep(panel, msg, {
        email, info,
        onResend: (where) => request(email, where),
        onBack: () => showLogin('', email),
        onVerify: async (code) => { await api('/api/auth/verify-otp', { body: { email, code } }); await startApp(); },
      });
    } catch (err) { setMsg(msg, err.message, true); busy(btn, false, 'ส่งรหัสเข้าสู่ระบบ'); }
  });

  panel.replaceChildren(
    el('h1', { text: state.config.appName }),
    el('p', { class: 'lead', text: 'เข้าสู่ระบบด้วยอีเมลที่ลงทะเบียนไว้ ระบบจะส่งรหัส 6 หลักไปที่อีเมล' }),
    form, msg,
    el('p', { class: 'foot' }, 'ยังไม่มีบัญชี? ', el('button', { class: 'link', type: 'button', text: 'ลงทะเบียน', onclick: () => showRegister() })));
  if (notice) setMsg(msg, notice, true);
  input.focus();
}

/* ================= REGISTER ================= */

function showRegister(prev = {}) {
  const { panel, msg } = authShell();
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
  const btn = el('button', { class: 'btn full', type: 'submit', text: 'ส่งรหัสยืนยันไปที่อีเมล' });
  const slot = el('div', { class: 'captcha' });

  const form = el('form', { novalidate: true },
    field('r-email', 'อีเมล', c.email, { required: true, hint: 'ใช้อีเมลของคุณเอง ระบบจะส่งรหัสยืนยันไปที่อีเมลนี้' }),
    field('r-name', 'ชื่อ-นามสกุล', c.name, { required: true }),
    field('r-company', 'บริษัท / หน่วยงาน', c.company, { required: true }),
    field('r-phone', 'เบอร์โทรศัพท์', c.phone, { required: true }),
    field('r-projects', 'โครงการที่ต้องการแจ้งเคลม', c.requestedProjects, { required: true, hint: 'ถ้ามีหลายโครงการ คั่นด้วยเครื่องหมายจุลภาค (,)' }),
    field('r-reason', 'ความเกี่ยวข้องกับโครงการ / หมายเหตุ', c.reason),
    el('div', { class: 'check' }, consent, el('label', { for: 'r-consent' }, 'ข้าพเจ้ายินยอมให้บริษัทเก็บและใช้ข้อมูลข้างต้นเพื่อพิจารณาสิทธิ์และดำเนินการเรื่องเคลม ตาม', ' ', privacy)),
    slot,
    btn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(Object.entries(c).map(([k, x]) => [k, x.value.trim()]));
    for (const k of ['email', 'name', 'company', 'phone', 'requestedProjects']) {
      if (!data[k]) { c[k].focus(); return setMsg(msg, 'กรุณากรอกข้อมูลที่มีเครื่องหมาย * ให้ครบ', true); }
    }
    if (!consent.checked) return setMsg(msg, 'กรุณายอมรับการเก็บและใช้ข้อมูลส่วนบุคคล', true);
    busy(btn, true, 'กำลังตรวจสอบ…');
    const send = async (where = slot) => {
      const captchaToken = await captcha.token(where, 'register');
      return (await api('/api/auth/register-start', { body: { ...data, consent: true, captchaToken } })).message;
    };
    try {
      const info = await send();
      codeStep(panel, msg, {
        email: data.email, info,
        onResend: send,
        onBack: () => showRegister(data),
        onVerify: async (code) => { await api('/api/auth/register-verify', { body: { email: data.email, code } }); await startApp(); },
      });
    } catch (err) { setMsg(msg, err.message, true); busy(btn, false, 'ส่งรหัสยืนยันไปที่อีเมล'); }
  });

  panel.replaceChildren(
    el('h1', { text: 'ลงทะเบียน' }),
    el('p', { class: 'lead', text: 'ขั้นตอน: 1) กรอกข้อมูล 2) ยืนยันรหัสจากอีเมล 3) รอ Admin ตรวจสอบและอนุมัติ' }),
    form, msg,
    el('p', { class: 'foot' }, 'มีบัญชีแล้ว? ', el('button', { class: 'link', type: 'button', text: 'เข้าสู่ระบบ', onclick: () => showLogin('', c.email.value.trim()) })));
  c.email.focus();
}

/* ================= APP SHELL ================= */

async function startApp() {
  state.me = await api('/api/me');
  if (state.me.canClaim) return renderShell('claim');
  if (state.me.isAdmin) return renderShell('admin');
  return renderPending();
}

async function logout() {
  try { await api('/api/auth/logout', { body: {} }); } catch { /* ignore */ }
  showLogin();
}

function topbar(nav) {
  return el('header', { class: 'topbar' },
    el('div', { class: 'brand', text: state.config.appName }),
    nav || el('span', { class: 'spacer' }),
    el('div', { class: 'user' }, el('span', { text: state.me.name || state.me.email }),
      el('button', { class: 'btn ghost small', type: 'button', text: 'ออกจากระบบ', onclick: logout })));
}

function renderPending() {
  const me = state.me;
  const refresh = el('button', { class: 'btn', type: 'button', text: 'ตรวจสอบสถานะอีกครั้ง' });
  const msg = el('p', { class: 'msg', role: 'status' });
  refresh.addEventListener('click', async () => {
    busy(refresh, true, 'กำลังตรวจสอบ…');
    try { await startApp(); if (!state.me.canClaim) setMsg(msg, 'ยังรอการอนุมัติ'); }
    catch (err) { if (!err.silent) setMsg(msg, err.message, true); }
    finally { busy(refresh, false, 'ตรวจสอบสถานะอีกครั้ง'); }
  });
  const approvedNoProject = me.status === 'approved';
  root.replaceChildren(topbar(), el('section', { class: 'page narrow' },
    el('div', { class: 'card' },
      badge(me.status, STATUS_TH[me.status] || me.status),
      el('h2', { text: approvedNoProject ? 'ยังไม่มีโครงการที่ได้รับสิทธิ์' : 'ยืนยันอีเมลแล้ว รอการอนุมัติ' }),
      el('p', { text: approvedNoProject
        ? 'บัญชีได้รับการอนุมัติ แต่ยังไม่ได้กำหนดโครงการ กรุณาติดต่อ Admin'
        : 'Admin จะตรวจสอบข้อมูลของคุณ เมื่ออนุมัติแล้วระบบจะแจ้งทางอีเมล จากนั้นจึงแจ้งเคลมและติดตามสถานะได้' }),
      el('dl', { class: 'facts compact' },
        el('div', {}, el('dt', { text: 'อีเมล' }), el('dd', { text: me.email })),
        el('div', {}, el('dt', { text: 'ชื่อ' }), el('dd', { text: fmt(me.name) })),
        el('div', {}, el('dt', { text: 'บริษัท' }), el('dd', { text: fmt(me.company) })),
        el('div', {}, el('dt', { text: 'โครงการที่ขอ' }), el('dd', { text: fmt(me.requestedProjects) }))),
      el('div', { class: 'form-actions' }, refresh, msg))));
}

function renderShell(view, opts = {}) {
  state.view = view;
  document.title = state.config.appName;
  const views = [
    state.me.canClaim && { id: 'claim', label: 'แจ้งเคลม' },
    state.me.canClaim && { id: 'myclaims', label: 'คำขอของฉัน' },
    state.me.isAdmin && { id: 'admin', label: 'Admin' },
  ].filter(Boolean);
  const nav = el('nav', { class: 'tabs', 'aria-label': 'เมนูหลัก' },
    views.map((v) => el('button', { type: 'button', class: 'tab', 'aria-current': v.id === view ? 'page' : 'false', text: v.label, onclick: () => renderShell(v.id) })));
  const body = el('div', { class: 'view' });
  root.replaceChildren(topbar(nav), body);
  if (view === 'claim') renderClaimForm(body, opts);
  else if (view === 'myclaims') renderMyClaims(body);
  else renderAdmin(body, opts.tab || 'users');
}

/* ================= CLAIM FORM ================= */

function renderClaimForm(body) {
  const msg = el('p', { class: 'msg', role: 'status' });
  const projectSel = el('select', { class: 'input', id: 'c-project', required: true },
    state.me.projects.length > 1 ? el('option', { value: '', text: '— เลือกโครงการ —' }) : null,
    state.me.projects.map((p) => el('option', { value: p, text: p })));

  const inputs = {};
  const dynamic = state.config.claimForm.map((f) => {
    const id = `c-${f.name}`;
    const attrs = { class: 'input', id, required: !!f.required, maxlength: f.max ? String(f.max) : null };
    let control;
    if (f.type === 'textarea') control = el('textarea', { ...attrs, rows: '5' });
    else if (f.type === 'date') control = el('input', { ...attrs, type: 'date', max: today() });
    else if (f.type === 'number') control = el('input', { ...attrs, type: 'number', min: '0', step: '0.01', inputmode: 'decimal' });
    else if (f.type === 'tel') control = el('input', { ...attrs, type: 'tel', autocomplete: 'tel' });
    else control = el('input', { ...attrs, type: 'text' });
    inputs[f.name] = control;
    return el('div', { class: f.type === 'textarea' ? 'span-2' : null }, field(id, f.label, control, { required: f.required }));
  });
  if (inputs.contactName && !inputs.contactName.value) inputs.contactName.value = state.me.name || '';

  const btn = el('button', { class: 'btn', type: 'submit', text: 'ส่งคำขอแจ้งเคลม' });
  const form = el('form', { class: 'claim-form', novalidate: true },
    el('div', { class: 'form-grid' }, el('div', {}, field('c-project', 'โครงการ', projectSel, { required: true })), dynamic),
    el('p', { class: 'note', text: 'ห้ามใส่รหัสผ่าน เลขบัตรประชาชน หรือข้อมูลบัตรเครดิตในแบบฟอร์ม' }),
    el('div', { class: 'form-actions' }, btn, msg));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!projectSel.value) return setMsg(msg, 'กรุณาเลือกโครงการ', true);
    for (const f of state.config.claimForm) {
      if (f.required && !inputs[f.name].value.trim()) { inputs[f.name].focus(); return setMsg(msg, `กรุณากรอก "${f.label}"`, true); }
    }
    const payload = { project: projectSel.value };
    for (const [k, x] of Object.entries(inputs)) payload[k] = x.value;
    busy(btn, true, 'กำลังส่ง…');
    setMsg(msg, '');
    try {
      const r = await api('/api/claims', { body: payload });
      body.replaceChildren(el('section', { class: 'page narrow' }, el('div', { class: 'card success' },
        el('h2', { text: 'ส่งคำขอแจ้งเคลมแล้ว' }),
        el('p', {}, 'เลขที่คำขอ ', el('strong', { class: 'ref', text: r.ref })),
        el('p', { class: 'muted', text: 'ระบบส่งอีเมลยืนยันไปที่อีเมลของคุณแล้ว ทีมงานจะตรวจสอบและติดต่อกลับ' }),
        el('div', { class: 'form-actions' },
          el('button', { class: 'btn', type: 'button', text: 'ดูคำขอของฉัน', onclick: () => renderShell('myclaims') }),
          el('button', { class: 'btn ghost', type: 'button', text: 'แจ้งเคลมรายการใหม่', onclick: () => renderShell('claim') })))));
    } catch (err) {
      if (err.silent) return;
      setMsg(msg, err.message, true);
      busy(btn, false, 'ส่งคำขอแจ้งเคลม');
    }
  });

  body.replaceChildren(el('section', { class: 'page' },
    el('h2', { text: 'แจ้งเคลม' }),
    el('p', { class: 'sub', text: `โครงการที่คุณแจ้งเคลมได้: ${state.me.projects.join(', ')}${state.me.expiry ? ` · สิทธิ์ถึง ${state.me.expiry}` : ''}` }),
    form));
}

/* ================= MY CLAIMS ================= */

async function renderMyClaims(body) {
  const page = el('section', { class: 'page' },
    el('h2', { text: 'คำขอของฉัน' }),
    el('p', { class: 'sub', text: 'คำขอแจ้งเคลมที่คุณส่ง และสถานะล่าสุด' }),
    el('p', { class: 'muted', text: 'กำลังโหลด…' }));
  body.replaceChildren(page);
  try {
    const { claims } = await api('/api/claims');
    if (state.view !== 'myclaims') return;
    if (!claims.length) {
      page.lastChild.replaceWith(el('div', { class: 'placeholder' },
        el('p', { text: 'คุณยังไม่มีคำขอแจ้งเคลม' }),
        el('button', { class: 'btn', type: 'button', text: 'แจ้งเคลม', onclick: () => renderShell('claim') })));
      return;
    }
    page.lastChild.replaceWith(el('div', { class: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, ['เลขที่คำขอ', 'วันที่ส่ง', 'โครงการ', 'กรมธรรม์', 'วันที่เกิดเหตุ', 'สถานะ', 'ข้อความจากทีมงาน'].map((h) => el('th', { scope: 'col', text: h })))),
      el('tbody', {}, claims.map((c) => el('tr', {},
        el('td', {}, el('strong', { text: c.ref })),
        el('td', { text: fmtDateTime(c.submittedAt) }),
        el('td', { text: fmt(c.project) }),
        el('td', { text: fmt(c.policy) }),
        el('td', { text: fmt(c.incidentDate) }),
        el('td', {}, badge(c.status)),
        el('td', { class: 'wrap', text: fmt(c.message) })))))));
  } catch (err) {
    if (!err.silent) page.lastChild.replaceWith(el('p', { class: 'msg error', text: err.message }));
  }
}

/* ================= ADMIN ================= */

function renderAdmin(body, tab) {
  const sub = el('nav', { class: 'subtabs', 'aria-label': 'Admin' },
    [['users', 'ผู้ใช้งาน'], ['claims', 'คำขอเคลม']].map(([id, label]) =>
      el('button', { type: 'button', class: 'tab', 'aria-current': id === tab ? 'page' : 'false', text: label, onclick: () => renderShell('admin', { tab: id }) })));
  const content = el('div', {}, el('p', { class: 'muted', text: 'กำลังโหลด…' }));
  body.replaceChildren(el('section', { class: 'page wide' }, el('h2', { text: 'Admin' }), sub, content));
  (tab === 'users' ? adminUsers : adminClaims)(content).catch((err) => {
    if (!err.silent) content.replaceChildren(el('p', { class: 'msg error', text: err.message }));
  });
}

async function adminUsers(content) {
  const { users } = await api('/api/admin/users');
  const known = [...new Set(users.flatMap((u) => u.projects || []))].sort();
  const datalist = el('datalist', { id: 'known-projects' }, known.map((p) => el('option', { value: p })));
  let filter = users.some((u) => u.status === 'pending') ? 'pending' : 'all';
  const list = el('div', { class: 'user-list' });
  const chips = el('div', { class: 'chips' });

  const drawChips = () => chips.replaceChildren(...[['pending', 'รออนุมัติ'], ['approved', 'อนุมัติแล้ว'], ['suspended', 'ระงับ'], ['rejected', 'ไม่อนุมัติ'], ['all', 'ทั้งหมด']].map(([id, label]) => {
    const n = id === 'all' ? users.length : users.filter((u) => u.status === id).length;
    return el('button', { type: 'button', class: 'chip', 'aria-pressed': String(filter === id), text: `${label} (${n})`, onclick: () => { filter = id; drawChips(); draw(); } });
  }));

  const userCard = (u) => {
    const msg = el('p', { class: 'msg', role: 'status' });
    const projects = el('input', { class: 'input', list: 'known-projects', value: (u.projects?.length ? u.projects : [u.requestedProjects || '']).join(', '), 'aria-label': `โครงการที่อนุญาตของ ${u.email}` });
    const expiry = el('input', { class: 'input', type: 'date', min: today(), value: u.expiry || '', 'aria-label': `วันหมดสิทธิ์ของ ${u.email}` });
    const act = (action, label, cls = 'btn small') => el('button', { class: cls, type: 'button', text: label, onclick: async (e) => {
      if ((action === 'reject' || action === 'suspend') && !confirm(`${label} ${u.email}?`)) return;
      busy(e.target, true);
      try {
        const r = await api('/api/admin/users', { body: { action, email: u.email, projects: projects.value, expiry: expiry.value } });
        Object.assign(u, r.user); drawChips(); draw();
      } catch (err) { if (!err.silent) { setMsg(msg, err.message, true); busy(e.target, false); } }
    } });

    const actions = {
      pending: [act('approve', 'อนุมัติ'), act('reject', 'ไม่อนุมัติ', 'btn ghost small danger')],
      approved: [act('update', 'บันทึกสิทธิ์', 'btn ghost small'), act('suspend', 'ระงับ', 'btn ghost small danger')],
      suspended: [act('reactivate', 'เปิดใช้งานอีกครั้ง', 'btn ghost small')],
      rejected: [act('reactivate', 'อนุมัติภายหลัง', 'btn ghost small')],
    }[u.status] || [];

    return el('article', { class: 'card user' },
      el('header', {}, el('div', {}, el('strong', { text: u.name || u.email }), el('span', { class: 'muted', text: ` · ${u.company || ''}` })), badge(u.status, STATUS_TH[u.status] || u.status)),
      el('dl', { class: 'facts compact' },
        el('div', {}, el('dt', { text: 'อีเมล' }), el('dd', { text: u.email })),
        el('div', {}, el('dt', { text: 'โทร' }), el('dd', { text: fmt(u.phone) })),
        el('div', {}, el('dt', { text: 'โครงการที่ขอ' }), el('dd', { text: fmt(u.requestedProjects) })),
        el('div', {}, el('dt', { text: 'ลงทะเบียน' }), el('dd', { text: fmtDateTime(u.createdAt) })),
        u.reason ? el('div', { class: 'span-all' }, el('dt', { text: 'หมายเหตุจากผู้ลงทะเบียน' }), el('dd', { text: u.reason })) : null,
        u.approvedBy ? el('div', {}, el('dt', { text: 'อนุมัติโดย' }), el('dd', { text: `${u.approvedBy} (${fmtDateTime(u.approvedAt)})` })) : null),
      el('div', { class: 'access' },
        field(`p-${u.email}`, 'โครงการที่อนุญาต (คั่นด้วย ,)', projects, { required: true }),
        field(`x-${u.email}`, 'วันหมดสิทธิ์ (แนะนำสำหรับผู้ใช้ภายนอก)', expiry)),
      el('div', { class: 'form-actions' }, actions, msg));
  };

  const draw = () => {
    const shown = users.filter((u) => filter === 'all' || u.status === filter);
    list.replaceChildren(...(shown.length ? shown.map(userCard) : [el('p', { class: 'placeholder', text: 'ไม่มีรายการ' })]));
  };

  content.replaceChildren(
    el('p', { class: 'hint', text: 'ก่อนอนุมัติ ให้ยืนยันตัวตนผู้ลงทะเบียนผ่านช่องทางอื่น (เช่น โทรกลับเบอร์ที่บริษัทมีอยู่ หรือสอบถามผู้ประสานงาน) เพราะการยืนยันอีเมลพิสูจน์ได้แค่ว่าเป็นเจ้าของอีเมล' }),
    chips, datalist, list);
  drawChips(); draw();
}

async function adminClaims(content) {
  const { claims } = await api('/api/admin/claims');
  const search = el('input', { class: 'input', type: 'search', placeholder: 'ค้นหาเลขที่คำขอ โครงการ ผู้แจ้ง', 'aria-label': 'ค้นหาคำขอ' });
  const statusFilter = el('select', { class: 'input', 'aria-label': 'กรองสถานะ' }, el('option', { value: '', text: 'ทุกสถานะ' }), state.config.statuses.map((s) => el('option', { value: s, text: s })));
  const list = el('div', { class: 'claim-list' });

  const claimCard = (c) => {
    const msg = el('p', { class: 'msg', role: 'status' });
    const status = el('select', { class: 'input', 'aria-label': `สถานะ ${c.ref}` }, state.config.statuses.map((s) => el('option', { value: s, text: s, selected: s === c.status })));
    const message = el('textarea', { class: 'input', rows: '2', maxlength: '1000', value: c.message || '', 'aria-label': `ข้อความถึงผู้แจ้ง ${c.ref}` });
    const save = el('button', { class: 'btn small', type: 'button', text: 'บันทึกและแจ้งผู้แจ้ง' });
    save.addEventListener('click', async () => {
      busy(save, true, 'กำลังบันทึก…');
      try {
        const r = await api('/api/admin/claims', { body: { ref: c.ref, status: status.value, message: message.value } });
        Object.assign(c, r.claim); setMsg(msg, 'บันทึกแล้ว'); badgeSlot.replaceChildren(badge(c.status));
      } catch (err) { if (!err.silent) setMsg(msg, err.message, true); }
      finally { busy(save, false, 'บันทึกและแจ้งผู้แจ้ง'); }
    });
    const badgeSlot = el('span', {}, badge(c.status));
    return el('details', { class: 'card claim' },
      el('summary', {},
        el('strong', { text: c.ref }), ' ',
        el('span', { class: 'muted', text: `${fmtDateTime(c.submittedAt)} · ${c.project} · ${c.values?.policy || ''} · ${c.submittedName || c.submittedBy}` }), ' ',
        badgeSlot),
      el('dl', { class: 'facts compact' },
        el('div', {}, el('dt', { text: 'ผู้แจ้ง' }), el('dd', { text: `${c.submittedName || ''} (${c.submittedBy})` })),
        el('div', {}, el('dt', { text: 'บริษัท' }), el('dd', { text: fmt(c.submittedCompany) })),
        state.config.claimForm.map((f) => el('div', { class: f.type === 'textarea' ? 'span-all' : null }, el('dt', { text: f.label }), el('dd', { text: fmt(c.values?.[f.name]) })))),
      el('div', { class: 'access' },
        field(`s-${c.ref}`, 'สถานะ', status),
        el('div', { class: 'span-2' }, field(`m-${c.ref}`, 'ข้อความถึงผู้แจ้ง (ผู้แจ้งจะเห็นข้อความนี้)', message))),
      el('div', { class: 'form-actions' }, save, msg),
      c.history?.length ? el('details', { class: 'history' }, el('summary', { text: `ประวัติ (${c.history.length})` }),
        el('ul', {}, c.history.map((h) => el('li', { text: `${fmtDateTime(h.at)} · ${h.by} · ${h.status}${h.message ? ` · ${h.message}` : ''}` })))) : null);
  };

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = claims.filter((c) => (!statusFilter.value || c.status === statusFilter.value) &&
      (!q || [c.ref, c.project, c.submittedBy, c.submittedName, c.values?.policy].some((x) => String(x || '').toLowerCase().includes(q))));
    list.replaceChildren(...(shown.length ? shown.map(claimCard) : [el('p', { class: 'placeholder', text: 'ไม่มีรายการ' })]));
  };
  search.addEventListener('input', draw);
  statusFilter.addEventListener('change', draw);

  content.replaceChildren(
    el('div', { class: 'toolbar' }, search, statusFilter,
      el('a', { class: 'btn ghost small', href: '/api/admin/claims?format=csv', text: 'ดาวน์โหลด CSV' })),
    list);
  draw();
}

/* ================= BOOT ================= */

(async () => {
  try { state.config = { ...state.config, ...(await api('/api/config')) }; } catch { /* keep defaults */ }
  try { await startApp(); } catch (err) { if (!err.silent) showLogin(); }
})();
