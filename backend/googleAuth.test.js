'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { verifyGoogleCredential } = require('./googleAuth');
const { sendMail, sendLoginNotice, buildMessage } = require('./loginMailer');
const { createLocalPool } = require('./localPool');
const { migrations } = require('../scripts/seed-local.cjs');

const CLIENT = 'synthetic-client.apps.googleusercontent.com';
const CRED = 'synthetic-google-id-token-0123456789';
const claims = over => ({ aud: CLIENT, iss: 'https://accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 600), email: 'New.Patient@Example.com', email_verified: 'true', name: 'Synthetic Google Patient', ...over });
const fakeFetch = (body, ok = true) => async () => ({ ok, json: async () => body });

// Fake SMTP server: records commands and the DATA body; optionally rejects the password.
function smtpServer({ rejectAuth = false } = {}) {
  const mails = [];
  const server = net.createServer(sock => {
    let buf = '', inData = false, data = '', state = 'cmd', mail = { lines: [] };
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', chunk => {
      buf += chunk; let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) { if (line === '.') { inData = false; mail.data = data; mails.push(mail); sock.write('250 queued\r\n'); } else data += line + '\n'; continue; }
        mail.lines.push(line);
        if (state === 'user') { mail.user = Buffer.from(line, 'base64').toString(); state = 'pass'; sock.write('334 UGFzc3dvcmQ6\r\n'); continue; }
        if (state === 'pass') { mail.pass = Buffer.from(line, 'base64').toString(); state = 'cmd'; sock.write(rejectAuth ? '535 bad credentials\r\n' : '235 ok\r\n'); continue; }
        if (/^EHLO/.test(line)) sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (line === 'AUTH LOGIN') { state = 'user'; sock.write('334 VXNlcm5hbWU6\r\n'); }
        else if (/^MAIL FROM|^RCPT TO/.test(line)) sock.write('250 ok\r\n');
        else if (line === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') sock.end('221 bye\r\n');
      }
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, mails, port: server.address().port })));
}

test('Google ID tokens are accepted only for this client, a Google issuer, unexpired and verified email', async () => {
  const ok = await verifyGoogleCredential(CRED, { clientId: CLIENT, fetchImpl: fakeFetch(claims()) });
  assert.deepEqual(ok, { email: 'new.patient@example.com', name: 'Synthetic Google Patient' });
  for (const [over, status] of [[{ aud: 'other-client' }, 401], [{ iss: 'evil.example' }, 401], [{ exp: '1' }, 401], [{ email_verified: 'false' }, 401]]) {
    await assert.rejects(verifyGoogleCredential(CRED, { clientId: CLIENT, fetchImpl: fakeFetch(claims(over)) }), e => e.status === status);
  }
  await assert.rejects(verifyGoogleCredential(CRED, { clientId: CLIENT, fetchImpl: fakeFetch({}, false) }), e => e.status === 401);
  await assert.rejects(verifyGoogleCredential(CRED, { clientId: '', fetchImpl: fakeFetch(claims()) }), e => e.status === 503);
  await assert.rejects(verifyGoogleCredential('short', { clientId: CLIENT, fetchImpl: fakeFetch(claims()) }), e => e.status === 400);
});

test('login notice is sent over SMTP without header injection and never leaks credentials', async () => {
  const { server, mails, port } = await smtpServer();
  const env = { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_SECURE: 'false', SMTP_USER: 'sender@example.com', SMTP_PASS: 'app-password-123' };
  try {
    assert.equal(await sendLoginNotice({ email: 'mum@example.com', full_name: 'Asha\r\nBcc: x@evil.example' }, { env }), 'sent');
    assert.equal(mails.length, 1);
    assert.equal(mails[0].user, 'sender@example.com');
    assert.equal(mails[0].pass, 'app-password-123');
    assert.ok(mails[0].lines.includes('RCPT TO:<mum@example.com>'));
    assert.match(mails[0].data, /Subject: You have successfully logged in to DAI/);
    assert.match(mails[0].data, /You have successfully logged in to DAI with Google/);
    assert.doesNotMatch(mails[0].data, /^Bcc:/m);
    assert.equal(await sendLoginNotice({ email: 'mother@dai-synthetic.invalid' }, { env }), 'skipped');
    assert.equal(await sendLoginNotice({ email: 'mum@example.com' }, { env: {} }), 'not_configured');
    await assert.rejects(sendMail({ host: '127.0.0.1', port, secure: false, user: 'a@example.com', pass: 'x', from: 'a@example.com' }, { to: 'bad\r\naddress', subject: 's', text: 't' }), /Invalid email/);
    assert.match(buildMessage({ from: 'a@example.com', to: 'b@example.com', subject: 's', text: '.hidden' }), /\r\n\.\.hidden$/);
  } finally { server.close(); }
  const bad = await smtpServer({ rejectAuth: true });
  try {
    const err = await sendMail({ host: '127.0.0.1', port: bad.port, secure: false, user: 'a@example.com', pass: 'secret-pass', from: 'a@example.com' }, { to: 'b@example.com', subject: 's', text: 't' }).catch(e => e);
    assert.match(err.message, /SMTP 535 after password/);
    assert.doesNotMatch(err.message, /secret-pass|c2VjcmV0LXBhc3M/);
    const errors = []; const orig = console.error; console.error = (...a) => errors.push(a.join(' '));
    try { assert.equal(await sendLoginNotice({ email: 'b@example.com' }, { env: { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(bad.port), SMTP_SECURE: 'false', SMTP_USER: 'a@example.com', SMTP_PASS: 'secret-pass' } }), 'failed'); }
    finally { console.error = orig; }
    assert.doesNotMatch(errors.join(' '), /secret-pass/);
  } finally { bad.server.close(); }
});

test('POST /api/auth/google signs in or creates a patient, sets the session cookie and emails a login notice', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dai-google-auth-'));
  const pool = createLocalPool(directory);
  for (const name of migrations) await pool.query(await fs.readFile(path.join(__dirname, 'db', name), 'utf8'));
  await pool.end();
  let current = claims();
  const tokeninfo = http.createServer((req, res) => {
    const ok = new URL(req.url, 'http://x').searchParams.get('id_token') === CRED;
    res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' }); res.end(JSON.stringify(ok ? current : { error: 'invalid_token' }));
  });
  await new Promise(r => tokeninfo.listen(0, '127.0.0.1', r));
  const smtp = await smtpServer();
  let child;
  const base = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { cwd: __dirname, env: { ...process.env, DAI_LOCAL: 'true', DAI_LOCAL_DB_DIR: directory, DATABASE_URL: '', NODE_ENV: 'development', JWT_SECRET: 'synthetic-test-secret-with-at-least-32-characters', PORT: '0',
      GOOGLE_CLIENT_ID: CLIENT, GOOGLE_TOKENINFO_URL: `http://127.0.0.1:${tokeninfo.address().port}/tokeninfo`,
      SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_SECURE: 'false', SMTP_USER: 'sender@example.com', SMTP_PASS: 'app-password-123' } });
    let out = ''; const timer = setTimeout(() => reject(new Error('server did not start: ' + out)), 30000);
    child.stdout.on('data', c => { out += c; const m = out.match(/DAI backend server running on port (\d+)/); if (m) { clearTimeout(timer); resolve('http://127.0.0.1:' + m[1]); } });
    child.stderr.on('data', c => { out += c; });
    child.once('exit', code => { clearTimeout(timer); if (code) reject(new Error(out)); });
  });
  const post = async body => { const r = await fetch(base + '/api/auth/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] }; };
  try {
    const config = await (await fetch(base + '/api/auth/google/config')).json();
    assert.deepEqual(config, { enabled: true, client_id: CLIENT, login_email: true });
    assert.equal((await post({ credential: 'synthetic-forged-token-000000000' })).status, 401);
    assert.equal(smtp.mails.length, 0);

    const first = await post({ credential: CRED });
    assert.equal(first.status, 201);
    assert.equal(first.body.created, true);
    assert.equal(first.body.user.role, 'mother');
    assert.equal(first.body.user.email, 'new.patient@example.com');
    assert.equal(first.body.login_email, 'sent');
    assert.ok(first.cookie?.startsWith('token='));
    const me = await fetch(base + '/api/auth/me', { headers: { cookie: first.cookie } });
    assert.equal(me.status, 200);
    assert.equal(smtp.mails.length, 1);
    assert.ok(smtp.mails[0].lines.includes('RCPT TO:<new.patient@example.com>'));
    assert.match(smtp.mails[0].data, /Hi Synthetic Google Patient/);

    const again = await post({ credential: CRED });
    assert.equal(again.status, 200);
    assert.equal(again.body.created, false);
    assert.equal(again.body.user.id, first.body.user.id);
    assert.equal(smtp.mails.length, 2);

    current = claims({ email_verified: 'false', email: 'someone@example.com' });
    assert.equal((await post({ credential: CRED })).status, 401);
    current = claims({ aud: 'another-app' });
    assert.equal((await post({ credential: CRED })).status, 401);
    assert.equal(smtp.mails.length, 2);
  } finally {
    await new Promise(r => { if (child.exitCode !== null) return r(); child.once('exit', r); child.kill('SIGTERM'); });
    tokeninfo.close(); smtp.server.close();
  }
});
