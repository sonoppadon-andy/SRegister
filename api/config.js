import { handle, json } from '../lib/http.js';
import { appName } from '../lib/config.js';
import { captchaEnabled } from '../lib/captcha.js';

export default handle(async (req, res) => {
  json(res, 200, {
    appName: appName(),
    turnstileSiteKey: captchaEnabled() ? process.env.TURNSTILE_SITE_KEY : '',
  });
});
