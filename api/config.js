import { handle, json } from '../lib/http.js';
import { appName, env } from '../lib/config.js';
import { CLAIM } from '../config/claim.js';
import { captchaEnabled } from '../lib/captcha.js';

export default handle(async (req, res) => {
  json(res, 200, {
    appName: appName(),
    privacyNoticeUrl: env('PRIVACY_NOTICE_URL', ''),
    claimForm: CLAIM.form.map(({ name, label, type, max, required }) => ({ name, label, type, max, required })),
    statuses: CLAIM.statuses,
    turnstileSiteKey: captchaEnabled() ? process.env.TURNSTILE_SITE_KEY : '',
  });
});
