import { handle, json } from '../lib/http.js';
import { appName } from '../lib/config.js';
import { captchaEnabled } from '../lib/captcha.js';
import { CLAIM_FORM } from '../config/claim.js';

export default handle(async (req, res) => {
  json(res, 200, {
    appName: appName(),
    turnstileSiteKey: captchaEnabled() ? process.env.TURNSTILE_SITE_KEY : '',
    claimForm: CLAIM_FORM,
    privacyNoticeUrl: process.env.PRIVACY_NOTICE_URL || '',
  });
});
