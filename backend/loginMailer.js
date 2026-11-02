'use strict';
// Minimal SMTP client (AUTH LOGIN over implicit TLS, e.g. Gmail with an app password)
// so login notices need no new npm dependency. Credentials never appear in errors or logs.
const tls = require('node:tls');
const net = require('node:net');

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const clean = v => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim();

function mailConfig(env = process.env) {
  if (!env.SMTP_USER || !env.SMTP_PASS) return null;
  return {
    host: env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(env.SMTP_PORT || 465),
    secure: env.SMTP_SECURE !== 'false',
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.MAIL_FROM || env.SMTP_USER,
  };
}

function buildMessage({ from, to, subject, text, date = new Date() }) {
  const body = String(text).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
  return [
    `From: DAI <${clean(from)}>`, `To: <${clean(to)}>`, `Subject: ${clean(subject)}`,
    `Date: ${date.toUTCString()}`, 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', body,
  ].join('\r\n');
}

function sendMail(cfg, { to, subject, text }, timeoutMs = 15000) {
  to = clean(to);
  if (!EMAIL.test(to) || !EMAIL.test(clean(cfg.from))) return Promise.reject(new Error('Invalid email address'));
  return new Promise((resolve, reject) => {
    const opts = { host: cfg.host, port: cfg.port };
    const sock = cfg.secure ? tls.connect({ ...opts, servername: cfg.host }) : net.connect(opts);
    const fail = err => { sock.destroy(); reject(err); };
    sock.setEncoding('utf8');
    sock.setTimeout(timeoutMs, () => fail(new Error('SMTP timeout')));
    sock.on('error', e => fail(new Error('SMTP connection failed: ' + (e.code || 'error'))));
    let buf = ''; const waiting = []; const early = [];
    sock.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        if (/^\d{3}( |$)/.test(line)) { const code = Number(line.slice(0, 3)); const w = waiting.shift(); w ? w(code) : early.push(code); }
      }
    });
    const reply = () => new Promise(r => early.length ? r(early.shift()) : waiting.push(r));
    const step = async (label, line, ok) => {
      if (line != null) sock.write(line + '\r\n');
      const code = await reply();
      if (!ok.includes(code)) throw new Error(`SMTP ${code} after ${label}`);
    };
    const b64 = s => Buffer.from(String(s)).toString('base64');
    (async () => {
      await step('greeting', null, [220]);
      await step('EHLO', 'EHLO dai.local', [250]);
      await step('AUTH', 'AUTH LOGIN', [334]);
      await step('username', b64(cfg.user), [334]);
      await step('password', b64(cfg.pass), [235]);
      await step('MAIL FROM', `MAIL FROM:<${clean(cfg.from)}>`, [250]);
      await step('RCPT TO', `RCPT TO:<${to}>`, [250, 251]);
      await step('DATA', 'DATA', [354]);
      await step('message', buildMessage({ from: cfg.from, to, subject, text }) + '\r\n.', [250]);
      sock.end('QUIT\r\n');
    })().then(resolve, fail);
  });
}

// Returns 'sent' | 'not_configured' | 'skipped' | 'failed'; a notice never blocks sign-in.
async function sendLoginNotice(user, { method = 'Google', when = new Date(), env = process.env, send = sendMail } = {}) {
  const cfg = mailConfig(env);
  if (!cfg) return 'not_configured';
  if (!user?.email || /\.invalid$/i.test(user.email)) return 'skipped';
  const name = clean(user.full_name) || 'there';
  const text = `Hi ${name},\n\nYou have successfully logged in to DAI with ${method} on ${when.toUTCString()}.\n\n` +
    'If this was you, no action is needed. If it was not, sign out of your Google account on shared devices and contact your care team.\n\n— DAI';
  try { await send(cfg, { to: user.email, subject: 'You have successfully logged in to DAI', text }); return 'sent'; }
  catch (e) { console.error('Login notice not sent:', e.message); return 'failed'; }
}

module.exports = { mailConfig, buildMessage, sendMail, sendLoginNotice };
