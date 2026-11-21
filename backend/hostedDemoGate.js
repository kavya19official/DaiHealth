'use strict';
const { createHmac, timingSafeEqual } = require('node:crypto');

function hostedDemoGate(env = process.env) {
  if (env.DAI_HOSTED_DEMO !== 'true') return null;
  const secret = env.DAI_DEMO_ACCESS_KEY;
  if (!secret || secret.length < 32) throw new Error('Hosted demo access key is missing');
  const cookie = 'dai_demo_access';
  const sign = value => createHmac('sha256', secret).update(value).digest();
  const credentials = sign('demo:' + secret);
  const lifetime = 8 * 60 * 60 * 1000;
  const makeSession = expiry => expiry + '.' + sign('dai-demo:' + expiry).toString('hex');
  const hasSession = req => (req.headers.cookie || '').split(/;\s*/).some(pair => {
    if (!pair.startsWith(cookie + '=')) return false;
    const value = pair.slice(cookie.length + 1);
    if (!/^\d{13}\.[a-f0-9]{64}$/.test(value)) return false;
    const expiry = Number(value.slice(0, 13));
    return expiry > Date.now() && timingSafeEqual(Buffer.from(value), Buffer.from(makeSession(expiry)));
  });
  function middleware(req, res, next) {
    if (req.method === 'GET' && req.path === '/api/health') return next();
    res.set('Cache-Control', 'private, no-store');
    const basic = (req.headers.authorization || '').match(/^Basic ([A-Za-z0-9+/=]+)$/i);
    if (basic && timingSafeEqual(sign(Buffer.from(basic[1], 'base64')), credentials)) {
      // FastAPI still receives its ordinary Bearer token on subsequent requests.
      delete req.headers.authorization;
      res.cookie(cookie, makeSession(Date.now() + lifetime), { secure: true, httpOnly: true, sameSite: 'strict', maxAge: lifetime });
      return next();
    }
    if (hasSession(req)) {
      if (basic) delete req.headers.authorization;
      return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="DAI synthetic demo", charset="UTF-8"');
    return res.status(401).send('Enter the demo access credentials provided by the DAI team.');
  }
  return { middleware };
}
module.exports = { hostedDemoGate };
