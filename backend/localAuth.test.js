'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const bcrypt = require('bcrypt');
const { createLocalPool } = require('./localPool');
const { migrations } = require('../scripts/seed-local.cjs');

const password = 'Synthetic-Registration-Test!';
const patientEmail = 'verified-patient@example.invalid';
const apiKey = 'fake-transport-test-only';
const form = (email = patientEmail) => ({
  email, full_name: 'Signup <Patient>', password, confirm_password: password
});
const demoEmail = role => role + '@dai-synthetic.invalid';
const codeFrom = mail => {
  const code = mail.text.match(/verification code is (\d{6})/)[1];
  assert.ok(mail.html.includes(code));
  return code;
};
const differentCode = code => code === '123456' ? '654321' : '123456';

test('DaiHealth email signup, Resend transport, account activation and existing demo roles', { timeout: 90000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dai-email-signup-'));
  const deliveries = [];
  let rejectDelivery = false;
  let child;
  let output = '';
  const mailServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    deliveries.push({ url: req.url, headers: req.headers, ...JSON.parse(Buffer.concat(chunks)) });
    res.writeHead(rejectDelivery ? 422 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(rejectDelivery ? { name: 'validation_error', message: apiKey } : { id: 'fake-email-id' }));
  });
  mailServer.listen(0, '127.0.0.1');
  await once(mailServer, 'listening');

  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const done = once(child, 'exit');
    child.kill('SIGTERM');
    await done;
  }
  t.after(async () => {
    await stop();
    mailServer.closeAllConnections();
    await new Promise(resolve => mailServer.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });

  async function database(work) {
    const pool = createLocalPool(directory);
    try { return await work(pool); }
    finally { await pool.end(); }
  }
  await database(async pool => {
    for (const name of migrations) await pool.query(await fs.readFile(path.join(__dirname, 'db', name), 'utf8'));
    // Apply again to the populated schema later to check migration compatibility.
    const demoHash = await bcrypt.hash('Dai-Synthetic-2026!', 10);
    const mother = (await pool.query("INSERT INTO users (email,password_hash,role) VALUES ($1,$2,'mother') RETURNING id",
      [demoEmail('mother'), demoHash])).rows[0].id;
    const doctor = (await pool.query("INSERT INTO users (email,password_hash,role) VALUES ($1,$2,'doctor') RETURNING id",
      [demoEmail('doctor'), demoHash])).rows[0].id;
    await pool.query("INSERT INTO mother_profiles (user_id,full_name) VALUES ($1,'Demo Patient')", [mother]);
    await pool.query("INSERT INTO doctor_profiles (user_id,full_name,specialization,medical_license_number) VALUES ($1,'Demo Doctor','Obstetrics','SYNTHETIC')", [doctor]);
    const unverified = await bcrypt.hash(password, 4);
    await pool.query("INSERT INTO users (email,password_hash,role,email_verification_required) VALUES ($1,$2,'mother',TRUE)",
      ['disabled-patient@example.invalid', unverified]);
    await pool.query(await fs.readFile(path.join(__dirname, 'db', 'email_signup.sql'), 'utf8'));
  });

  const start = ({ key = apiKey, allowed = patientEmail } = {}) => new Promise((resolve, reject) => {
    child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
      cwd: __dirname,
      env: {
        ...process.env, DAI_LOCAL: 'true', DAI_LOCAL_DB_DIR: directory, DATABASE_URL: '', NODE_ENV: 'development',
        JWT_SECRET: 'synthetic-test-secret-with-at-least-32-characters', SIGNUP_OTP_SECRET: '',
        RESEND_API_KEY: key, EMAIL_FROM: '', RESEND_TEST_EMAIL: allowed, PORT: '0',
        RESEND_BASE_URL: 'http://127.0.0.1:' + mailServer.address().port
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let startup = '';
    const timer = setTimeout(() => reject(new Error('Auth test server did not start: ' + startup)), 30000);
    child.stdout.on('data', chunk => {
      output += chunk;
      startup += chunk;
      const match = startup.match(/DAI backend server running on port (\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve('http://127.0.0.1:' + match[1]);
      }
    });
    child.stderr.on('data', chunk => { output += chunk; startup += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(startup)); });
  });

  let base = await start();
  async function send(url, body, cookie, method = body ? 'POST' : 'GET') {
    const response = await fetch(base + '/api/auth' + url, {
      method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const setCookie = response.headers.get('set-cookie');
    return { status: response.status, body: await response.json(), cookie: setCookie?.split(';')[0], setCookie, headers: response.headers };
  }
  const login = (email, pwd = password) => send('/login', { email, password: pwd });
  const verify = (id, code) => send('/signup/verify', { challenge_id: id, code });
  const resend = id => send('/signup/resend', { challenge_id: id });

  assert.equal((await send('/signup', { ...form(), confirm_password: 'different' })).status, 400);
  assert.equal((await send('/signup', { ...form(), role: 'doctor' })).status, 400);
  assert.equal((await send('/signup', { ...form(), role: 'hospital_admin' })).status, 400);
  assert.equal((await send('/signup', form('other@example.invalid'))).status, 422);
  assert.equal((await send('/register/doctor', form())).status, 401);
  assert.equal((await login('disabled-patient@example.invalid')).status, 401);
  assert.equal(deliveries.length, 0);

  for (const role of ['mother', 'doctor']) {
    const session = await login(demoEmail(role), 'Dai-Synthetic-2026!');
    assert.equal(session.status, 200);
    assert.equal(session.body.user.role, role);
    assert.equal((await send('/me', null, session.cookie)).body.user.role, role);
    if (role === 'mother') assert.equal((await send('/register/doctor', form(), session.cookie)).status, 403);
    else {
      const colleague = { ...form('colleague@example.invalid'), specialization: 'Obstetrics', medical_license_number: 'SYNTHETIC' };
      const provisioned = await send('/register/doctor', colleague, session.cookie);
      assert.equal(provisioned.status, 201, JSON.stringify(provisioned.body));
      assert.equal((await login(colleague.email)).body.user.role, 'doctor');
    }
  }

  const queued = await send('/signup', form(' VERIFIED-PATIENT@EXAMPLE.INVALID '));
  assert.equal(queued.status, 202, JSON.stringify(queued.body));
  const id = queued.body.challenge_id;
  const first = deliveries[0];
  const firstCode = codeFrom(first);
  assert.equal(first.url, '/emails');
  assert.equal(first.from, 'DaiHealth <onboarding@resend.dev>');
  assert.deepEqual([first.to].flat(), [patientEmail]);
  assert.equal(first.headers.authorization, 'Bearer ' + apiKey);
  assert.match(first.headers['idempotency-key'], /^dai-signup\//);
  assert.match(first.html, /Signup &lt;Patient&gt;/);
  assert.deepEqual(Object.keys(queued.body).sort(), ['challenge_id', 'expires_in', 'resend_in']);
  assert.equal(queued.body.expires_in, 300);
  assert.equal(queued.cookie, undefined);
  assert.equal((await login(patientEmail)).status, 401);
  assert.equal((await send('/signup', form())).status, 429);
  const cooldown = await resend(id);
  assert.equal(cooldown.status, 429);
  assert.ok(Number(cooldown.headers.get('retry-after')) > 0);
  assert.equal(deliveries.length, 1);

  for (const status of [400, 400, 400, 400, 429]) assert.equal((await verify(id, differentCode(firstCode))).status, status);
  assert.equal((await verify(id, firstCode)).status, 429);

  await stop();
  await database(async pool => {
    const pending = (await pool.query('SELECT * FROM pending_email_signups WHERE challenge_id = $1', [id])).rows[0];
    assert.ok(pending.delivered_at);
    assert.equal(Buffer.from(pending.otp_digest).length, 32);
    assert.notEqual(pending.password_hash, password);
    assert.equal(await bcrypt.compare(password, pending.password_hash), true);
    assert.equal((await pool.query('SELECT 1 FROM users WHERE email = $1', [patientEmail])).rowCount, 0);
    await pool.query("UPDATE pending_email_signups SET expires_at = now() - interval '1 minute', resend_at = now() - interval '1 minute' WHERE challenge_id = $1", [id]);
  });
  base = await start();
  assert.equal((await verify(id, firstCode)).status, 410);
  const resent = await resend(id);
  assert.equal(resent.status, 202, JSON.stringify(resent.body));
  assert.equal(resent.body.challenge_id, id);
  const next = codeFrom(deliveries[1]);
  assert.notEqual(next, firstCode);
  assert.equal((await verify(id, firstCode)).status, 400);

  const concurrent = await Promise.all([verify(id, next), verify(id, next)]);
  assert.deepEqual(concurrent.map(reply => reply.status).sort(), [201, 410]);
  const activated = concurrent.find(reply => reply.status === 201);
  assert.equal(activated.body.user.role, 'mother');
  assert.equal(activated.body.user.email_verified, true);
  assert.match(activated.setCookie, /HttpOnly/);
  assert.equal((await send('/me', null, activated.cookie)).body.user.role, 'mother');
  assert.equal((await send('/signup', form())).status, 409);
  assert.equal((await login(patientEmail, 'wrong')).status, 401);
  assert.equal((await login(patientEmail)).status, 200);

  const timeline = await fetch(base + '/api/timeline', { headers: { cookie: activated.cookie } });
  assert.equal(timeline.status, 200);
  assert.equal((await timeline.json()).milestones.length, 17);
  const profile = await fetch(base + '/api/profile/pregnancy', {
    method: 'PATCH', headers: { cookie: activated.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ lmp_date: new Date(Date.now() - 86400000 * 85).toISOString().slice(0, 10) })
  });
  assert.equal(profile.status, 200);
  assert.equal((await profile.json()).pregnancy.confirmed, true);
  assert.equal((await send('/me', null, activated.cookie)).body.user.pregnancy_status, 'pregnant');

  await stop();
  await database(async pool => {
    assert.equal((await pool.query('SELECT 1 FROM pending_email_signups WHERE challenge_id = $1', [id])).rowCount, 0);
    const account = (await pool.query('SELECT role, email_verified_at FROM users WHERE email = $1', [patientEmail])).rows[0];
    assert.equal(account.role, 'mother');
    assert.ok(account.email_verified_at);
  });

  const legacyEmail = 'legacy-registration@example.invalid';
  base = await start({ allowed: '' });
  const { confirm_password, ...legacyForm } = form(legacyEmail);
  const legacy = await send('/register/mother', {
    ...legacyForm, date_of_birth: '2000-01-01', systolic: 120, diastolic: 80
  });
  assert.equal(legacy.status, 202, JSON.stringify(legacy.body));
  const legacyVerified = await verify(legacy.body.challenge_id, codeFrom(deliveries.at(-1)));
  assert.equal(legacyVerified.status, 201);
  const reviews = await fetch(base + '/api/patient/clinical-reviews', { headers: { cookie: legacyVerified.cookie } });
  assert.equal(reviews.status, 200);
  assert.equal((await reviews.json()).requests[0].state, 'pending');
  const risk = await fetch(base + '/api/risk/trend', { headers: { cookie: legacyVerified.cookie } });
  assert.equal(risk.status, 200);
  assert.equal((await risk.json()).latest_assessment, null);

  rejectDelivery = true;
  const failure = await send('/signup', form('provider-error@example.invalid'));
  assert.equal(failure.status, 502);
  assert.ok(!JSON.stringify(failure.body).includes(apiKey));
  assert.equal((await login('provider-error@example.invalid')).status, 401);
  assert.equal((await login(patientEmail)).status, 200);

  await stop();
  await database(async pool => {
    await pool.query('UPDATE email_signup_rate_limits SET attempts = 90');
  });
  base = await start({ key: '' });
  assert.equal((await send('/signup', form('missing-key@example.invalid'))).status, 503);
  assert.equal((await verify(id, next)).status, 429);
  assert.equal((await login(demoEmail('doctor'), 'Dai-Synthetic-2026!')).status, 200);
  assert.ok(!output.includes(apiKey));
});
