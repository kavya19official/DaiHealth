'use strict';
/* IVR provider interface for Dai Didi phone mode.
 *
 * A provider turns a telephony webhook into a neutral call event and turns a neutral
 * "directive" back into the provider's reply format. The call logic (language choice,
 * rules, escalation) lives in didiVoice.js and never imports a telephony SDK.
 *
 *   parse(req)       -> { callId, from, digits, speech }
 *   verify(req, env) -> boolean   (webhook authenticity; the stub only runs outside production)
 *   render(directive)-> { type, body }
 *
 * directive = { say: [{ text, lang }], gather: { input: 'dtmf'|'speech', lang, numDigits?, timeout? } | null, hangup: boolean }
 *
 * Implemented: stub (JSON, for the demo and tests) and twilio (TwiML).
 * Exotel: implement the same three functions against its Passthru/ExoML applets.
 */
const crypto = require('node:crypto');

const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const LANG_CODE = { hi: 'hi-IN', en: 'en-IN' };

const stub = {
  name: 'stub',
  verify: (req, env) => env.NODE_ENV !== 'production' || env.DAI_IVR_STUB === 'true',
  parse: (req) => ({ callId: String(req.body?.call_id || '').slice(0, 64), from: String(req.body?.from || '').slice(0, 24), digits: req.body?.digits == null ? '' : String(req.body.digits).slice(0, 4), speech: req.body?.speech == null ? '' : String(req.body.speech).slice(0, 500) }),
  render: (d) => ({ type: 'application/json', body: JSON.stringify({ provider: 'stub', directive: d, spoken: d.say.map((x) => x.text).join('\n') }) })
};

const twilio = {
  name: 'twilio',
  // Twilio signs the full URL + sorted POST params with HMAC-SHA1 using the auth token.
  verify(req, env) {
    const token = env.TWILIO_AUTH_TOKEN, sig = req.get('X-Twilio-Signature');
    if (!token || !sig) return false;
    const base = (env.PUBLIC_BASE_URL || (req.protocol + '://' + req.get('host'))).replace(/\/$/, '') + req.originalUrl;
    const data = Object.keys(req.body || {}).sort().reduce((acc, k) => acc + k + req.body[k], base);
    const expected = crypto.createHmac('sha1', token).update(data).digest('base64');
    const a = Buffer.from(expected), b = Buffer.from(sig);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },
  parse: (req) => ({ callId: String(req.body?.CallSid || '').slice(0, 64), from: String(req.body?.From || '').slice(0, 24), digits: String(req.body?.Digits || '').slice(0, 4), speech: String(req.body?.SpeechResult || '').slice(0, 500) }),
  render(d) {
    const say = d.say.map((x) => `<Say language="${LANG_CODE[x.lang] || 'en-IN'}">${xml(x.text)}</Say>`).join('');
    let gather = '';
    if (d.gather) {
      const g = d.gather;
      gather = g.input === 'dtmf'
        ? `<Gather input="dtmf" numDigits="${g.numDigits || 1}" timeout="${g.timeout || 6}">${say}</Gather>`
        : `<Gather input="speech" language="${LANG_CODE[g.lang] || 'en-IN'}" speechTimeout="auto" timeout="${g.timeout || 8}">${say}</Gather>`;
    }
    return { type: 'text/xml', body: `<?xml version="1.0" encoding="UTF-8"?><Response>${gather || say}${d.hangup ? '<Hangup/>' : ''}</Response>` };
  }
};

const exotel = {
  name: 'exotel',
  verify: () => false,
  parse: () => { throw Object.assign(new Error('Exotel adapter is not implemented'), { status: 501 }); },
  render: () => { throw Object.assign(new Error('Exotel adapter is not implemented'), { status: 501 }); }
};

module.exports = { providers: { stub, twilio, exotel }, xml };
