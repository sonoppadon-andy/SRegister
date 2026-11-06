export function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

export function normEmail(v) {
  const s = String(v || '').trim().toLowerCase();
  return s.length <= 254 && /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : null;
}

export function requirePostJson(req, res) {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return false;
  }
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    json(res, 415, { error: 'Unsupported content type' });
    return false;
  }
  return true;
}

export function log(event, data = {}) {
  console.log(JSON.stringify({ audit: { ts: new Date().toISOString(), event, ...data } }));
}

export function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(JSON.stringify({ error: e.message, path: req.url }));
      if (!res.headersSent) json(res, 500, { error: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่ หากยังไม่ได้ให้แจ้ง IT' });
    }
  };
}
