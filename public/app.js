'use strict';
// Test page: send a one-time code by email and verify it. No database.
// All text is rendered with textContent (never innerHTML).

const state = { config: { appName: 'ทดสอบส่งรหัส OTP', turnstileSiteKey: '' } };
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
  root.replaceChildren(el('main', { class: 'login' }, el('section', { class: 'login-panel' },
    el('h1', { text: state.config.appName }), ...content)));
}

async function requestCode(email, slot) {
  const captchaToken = await captcha.token(slot);
  return api('/api/otp/send', { email, captchaToken });
}

function emailStep(prefill = '') {
  const input = el('input', { class: 'input', id: 'email', type: 'email', autocomplete: 'email', required: true, value: prefill });
  const slot = el('div', { class: 'captcha' });
  const btn = el('button', { class: 'btn full', type: 'submit', text: 'ส่งรหัสไปที่อีเมล' });
  const msg = el('p', { class: 'msg', role: 'status' });
  const form = el('form', { novalidate: true },
    el('div', { class: 'field' }, el('label', { for: 'email', text: 'อีเมล' }), input), slot, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!email) return setMsg(msg, 'กรุณากรอกอีเมล', true);
    busy(btn, true, 'กำลังส่ง…');
    try { codeStep(email, await requestCode(email, slot)); }
    catch (err) { setMsg(msg, err.message, true); busy(btn, false, 'ส่งรหัสไปที่อีเมล'); }
  });
  shell(el('p', { class: 'lead', text: 'กรอกอีเมล ระบบจะส่งรหัส 6 หลักไปให้ยืนยัน' }), form, msg,
    el('p', { class: 'foot', text: 'เวอร์ชันทดสอบการส่งรหัสทางอีเมล ยังไม่มีการลงทะเบียนหรือบันทึกข้อมูล' }));
  input.focus();
}

function codeStep(email, sent) {
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
      const r = await requestCode(email, slot);
      challenge = r.challenge; // the previous code no longer matches
      setMsg(msg, 'ส่งรหัสใหม่แล้ว ใช้รหัสล่าสุดเท่านั้น');
      left = 60; clearTimeout(timer); tick();
    } catch (err) { setMsg(msg, err.message, true); resend.disabled = false; }
  });
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); });

  const form = el('form', { novalidate: true },
    el('div', { class: 'field' }, el('label', { for: 'code', text: 'รหัส 6 หลักจากอีเมล' }), input),
    btn,
    el('div', { class: 'row-actions' },
      el('button', { class: 'link', type: 'button', text: 'เปลี่ยนอีเมล', onclick: () => { clearTimeout(timer); emailStep(email); } }),
      resend),
    slot);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(input.value)) return setMsg(msg, 'กรุณากรอกรหัส 6 หลัก', true);
    busy(btn, true, 'กำลังตรวจสอบ…');
    try {
      const r = await api('/api/otp/verify', { challenge, code: input.value });
      clearTimeout(timer);
      doneStep(r.email);
    } catch (err) { setMsg(msg, err.message, true); busy(btn, false, 'ยืนยันรหัส'); input.select(); }
  });

  shell(el('p', { class: 'lead' }, sent.message, el('br'), el('span', { class: 'muted', text: 'ตรวจกล่องจดหมาย รวมถึง Junk/Spam' })), form, msg);
  input.focus();
}

function doneStep(email) {
  shell(
    el('div', { class: 'card success' },
      el('h2', { text: 'ยืนยันอีเมลสำเร็จ' }),
      el('p', { text: email })),
    el('button', { class: 'btn ghost', type: 'button', text: 'ทดสอบอีกครั้ง', onclick: () => emailStep() }));
}

(async () => {
  try { state.config = { ...state.config, ...(await api('/api/config')) }; } catch { /* defaults */ }
  emailStep();
})();
