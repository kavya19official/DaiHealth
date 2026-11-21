'use strict';

const { createHmac, randomInt, randomUUID, timingSafeEqual } = require('node:crypto');
const bcrypt = require('bcrypt');
const createMailer = require('./signupMailer');

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailInUse = 'That email already has a DaiHealth account. Please sign in.';
const unavailable = 'Email signup is temporarily unavailable. Please try again later.';

module.exports = function registerEmailSignup(app, { pool, preparePatientProfile, createVerifiedPatient, setLoginCookie }) {
  const mailer = createMailer();
  const jwtSecret = process.env.JWT_SECRET || '';
  const secret = process.env.SIGNUP_OTP_SECRET || jwtSecret;
  const hmac = value => createHmac('sha256', secret).update(value).digest();
  const otpDigest = (id, generation, code) => hmac(`signup:otp:${id}:${generation}:${code}`);
  const newCode = () => String(randomInt(1_000_000)).padStart(6, '0');

  function reply(res, status, message, retryAfter) {
    const data = { error: message };
    if (retryAfter > 0) {
      res.set('Retry-After', String(retryAfter));
      data.retry_after = retryAfter;
    }
    return res.status(status).json(data);
  }

  const cooldown = (res, seconds) => reply(res, 429, 'Please wait before requesting another code.', seconds);
  const obsolete = res => reply(res, 410, 'This signup request has expired. Please start again.');

  async function consumeLimit(scope, identifier, maximum, seconds) {
    const bucket = hmac(`signup:limit:${scope}:${identifier}`).toString('hex');
    const result = await pool.query(
      `INSERT INTO email_signup_rate_limits AS limits (bucket, attempts, resets_at)
       VALUES ($1, 1, clock_timestamp() + $2::int * interval '1 second')
       ON CONFLICT (bucket) DO UPDATE SET
         attempts = CASE WHEN limits.resets_at <= clock_timestamp() THEN 1 ELSE limits.attempts + 1 END,
         resets_at = CASE WHEN limits.resets_at <= clock_timestamp() THEN excluded.resets_at ELSE limits.resets_at END
       WHERE limits.resets_at <= clock_timestamp() OR limits.attempts < $3
       RETURNING bucket`, [bucket, seconds, maximum]
    );
    if (result.rowCount) return 0;
    const { rows } = await pool.query(
      'SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM resets_at - clock_timestamp()))) AS wait FROM email_signup_rate_limits WHERE bucket = $1', [bucket]
    );
    return Number(rows[0]?.wait || 1);
  }

  async function checkLimit(req, res, scope, maximum, seconds, identifier = req.ip) {
    const wait = await consumeLimit(scope, identifier, maximum, seconds);
    if (wait) cooldown(res, wait);
    return wait > 0;
  }

  const handler = operation => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (jwtSecret.length < 32 || secret.length < 32) return reply(res, 503, unavailable);
    try {
      return await operation(req, res);
    } catch {
      console.error('Email signup operation failed');
      return reply(res, 500, 'Email signup could not be completed. Please try again.');
    }
  };

  async function checkAddress(email) {
    const result = await pool.query('SELECT 1 FROM users WHERE lower(email) = $1 LIMIT 1', [email]);
    return result.rowCount > 0;
  }

  async function deliver(res, pending, code) {
    let sent = false;
    try { sent = await mailer.send({ email: pending.email, name: pending.full_name, code, generation: pending.generation }); }
    catch { /* Return a controlled error without provider payload or credentials. */ }
    if (!sent) return reply(res, 502, 'The verification email could not be sent. Try again in a minute.', 60);

    const result = await pool.query(
      `UPDATE pending_email_signups SET delivered_at = clock_timestamp(), expires_at = clock_timestamp() + interval '5 minutes'
       WHERE challenge_id = $1 AND generation = $2
       RETURNING GREATEST(1, CEIL(EXTRACT(EPOCH FROM resend_at - clock_timestamp()))) AS wait`,
      [pending.challenge_id, pending.generation]
    );
    if (!result.rowCount) return obsolete(res);
    return res.status(202).json({ challenge_id: pending.challenge_id, expires_in: 300, resend_in: Number(result.rows[0].wait) });
  }

  app.post(['/api/auth/signup', '/api/auth/register/mother'], handler(async (req, res) => {
    const b = req.body || {};
    const legacy = /^\/api\/auth\/register\/mother\/?$/i.test(req.path);
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const name = typeof b.full_name === 'string' ? b.full_name.trim() : '';
    if (!name || name.length > 255 || /[\u0000-\u001f\u007f]/.test(name)) return reply(res, 400, 'Enter a valid full name.');
    if (email.length > 255 || !EMAIL.test(email)) return reply(res, 400, 'Enter a valid email address.');
    if (typeof b.password !== 'string' || b.password.length < 8 || Buffer.byteLength(b.password) > 72 || b.password.includes('\0')) {
      return reply(res, 400, 'Use a password with at least 8 characters and at most 72 UTF-8 bytes.');
    }
    if ((!legacy || b.confirm_password !== undefined) && b.password !== b.confirm_password) {
      return reply(res, 400, 'The passwords do not match.');
    }
    if (b.role !== undefined && b.role !== 'mother') return reply(res, 400, 'Public signup is available for patient accounts.');
    const profile = preparePatientProfile(legacy ? b : {});
    if (profile.pregnancyStatus === 'delivered' && profile.childName && !profile.childDate) {
      return reply(res, 400, 'Enter a valid date of birth for your child.');
    }
    if (!mailer.configured) return reply(res, 503, unavailable);
    if (await checkLimit(req, res, 'mail-ip', 60, 900)) return;
    if (!mailer.allows(email)) return reply(res, 422, 'Email signup is currently restricted to the configured testing address.');
    if (await checkAddress(email)) return reply(res, 409, emailInUse);

    await pool.query('DELETE FROM pending_email_signups WHERE discard_at <= clock_timestamp()');
    await pool.query('DELETE FROM email_signup_rate_limits WHERE resets_at <= clock_timestamp()');
    const { rows: active } = await pool.query(
      `SELECT CEIL(EXTRACT(EPOCH FROM resend_at - clock_timestamp())) AS wait
       FROM pending_email_signups WHERE email = $1 AND resend_at > clock_timestamp()`, [email]
    );
    if (active.length) return cooldown(res, Number(active[0].wait));
    if (await checkLimit(req, res, 'mail-email', 5, 3600, email)) return;

    const id = randomUUID();
    const generation = randomUUID();
    const code = newCode();
    const passwordHash = await bcrypt.hash(b.password, 12);
    const result = await pool.query(
      `INSERT INTO pending_email_signups AS pending
         (email, challenge_id, full_name, password_hash, profile, generation, otp_digest, attempts_remaining, expires_at, resend_at, discard_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 5, clock_timestamp() + interval '5 minutes',
               clock_timestamp() + interval '60 seconds', clock_timestamp() + interval '24 hours')
       ON CONFLICT (email) DO UPDATE SET challenge_id = excluded.challenge_id, full_name = excluded.full_name,
         password_hash = excluded.password_hash, profile = excluded.profile, generation = excluded.generation,
         otp_digest = excluded.otp_digest, attempts_remaining = 5, delivered_at = NULL,
         expires_at = excluded.expires_at, resend_at = excluded.resend_at, discard_at = excluded.discard_at
       WHERE pending.resend_at <= clock_timestamp()
       RETURNING email, full_name, challenge_id, generation`,
      [email, id, name, passwordHash, JSON.stringify(profile), generation, otpDigest(id, generation, code)]
    );
    if (!result.rowCount) return cooldown(res, 60);
    return deliver(res, result.rows[0], code);
  }));

  app.post('/api/auth/signup/resend', handler(async (req, res) => {
    const id = req.body?.challenge_id;
    if (typeof id !== 'string' || !UUID.test(id)) return reply(res, 400, 'Invalid signup request.');
    if (!mailer.configured) return reply(res, 503, unavailable);
    if (await checkLimit(req, res, 'mail-ip', 60, 900)) return;
    const { rows } = await pool.query(
      `SELECT email, generation, otp_digest, CEIL(EXTRACT(EPOCH FROM resend_at - clock_timestamp())) AS wait
       FROM pending_email_signups WHERE challenge_id = $1 AND discard_at > clock_timestamp()`, [id]
    );
    if (!rows.length) return obsolete(res);
    if (Number(rows[0].wait) > 0) return cooldown(res, Number(rows[0].wait));
    if (!mailer.allows(rows[0].email)) return reply(res, 422, 'Email signup is currently restricted to the configured testing address.');
    const current = rows[0];
    if (await checkAddress(current.email)) return reply(res, 409, emailInUse);
    if (await checkLimit(req, res, 'mail-email', 5, 3600, current.email)) return;

    const generation = randomUUID();
    const priorDigest = Buffer.from(current.otp_digest);
    let code;
    do { code = newCode(); } while (timingSafeEqual(priorDigest, otpDigest(id, current.generation, code)));
    const result = await pool.query(
      `UPDATE pending_email_signups SET generation = $2, otp_digest = $3, attempts_remaining = 5,
         expires_at = clock_timestamp() + interval '5 minutes', resend_at = clock_timestamp() + interval '60 seconds',
         delivered_at = NULL
       WHERE challenge_id = $1 AND generation = $4 AND discard_at > clock_timestamp() AND resend_at <= clock_timestamp()
       RETURNING email, full_name, challenge_id, generation`,
      [id, generation, otpDigest(id, generation, code), current.generation]
    );
    if (!result.rowCount) return cooldown(res, 60);
    return deliver(res, result.rows[0], code);
  }));

  app.post('/api/auth/signup/verify', handler(async (req, res) => {
    const { challenge_id: id, code } = req.body || {};
    if (typeof id !== 'string' || !UUID.test(id) || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return reply(res, 400, 'Enter a valid six-digit verification code.');
    }
    if (await checkLimit(req, res, 'verify-ip', 90, 900)) return;
    const client = await pool.connect();
    let user;
    let result;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT *, expires_at <= clock_timestamp() AS expired FROM pending_email_signups WHERE challenge_id = $1 FOR UPDATE`, [id]
      );
      const pending = rows[0];
      if (!pending) result = [410, 'This signup request has expired. Please start again.'];
      else if (!pending.delivered_at || pending.expired) result = [410, 'This code has expired. Request a new one.'];
      else if (!pending.attempts_remaining) result = [429, 'Too many incorrect attempts. Request a new code.'];
      else if (!timingSafeEqual(Buffer.from(pending.otp_digest), otpDigest(id, pending.generation, code))) {
        await client.query('UPDATE pending_email_signups SET attempts_remaining = attempts_remaining - 1 WHERE challenge_id = $1', [id]);
        result = pending.attempts_remaining > 1
          ? [400, 'That code is incorrect. Please try again.']
          : [429, 'Too many incorrect attempts. Request a new code.'];
      } else {
        const existing = await client.query('SELECT 1 FROM users WHERE lower(email) = $1 LIMIT 1', [pending.email]);
        if (existing.rowCount) result = [409, emailInUse];
        else user = await createVerifiedPatient(client, pending);
        await client.query('DELETE FROM pending_email_signups WHERE challenge_id = $1', [id]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505' && error.constraint === 'users_email_key') return reply(res, 409, emailInUse);
      throw error;
    } finally {
      client.release();
    }

    if (result) return reply(res, ...result);
    setLoginCookie(res, user);
    return res.status(201).json({ message: 'Email verified. Your patient account is ready.', user });
  }));
};
