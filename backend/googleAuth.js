'use strict';
// "Sign in with Google" (Google Identity Services ID token). The token is verified with
// Google (signature, audience, issuer, expiry, verified email) before any account lookup.
// Existing accounts sign in by email; a new Google user gets a patient account only —
// clinician accounts still require registration and verification.
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { sendLoginNotice } = require('./loginMailer');

const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo';
class AuthError extends Error { constructor(status, message) { super(message); this.status = status; } }

async function verifyGoogleCredential(credential, { clientId, tokeninfoUrl = TOKENINFO, fetchImpl = fetch, now = Date.now() }) {
  if (!clientId) throw new AuthError(503, 'Google sign-in is not configured');
  if (typeof credential !== 'string' || credential.length < 20 || credential.length > 4096) throw new AuthError(400, 'Missing Google credential');
  let response;
  try { response = await fetchImpl(`${tokeninfoUrl}?id_token=${encodeURIComponent(credential)}`); }
  catch { throw new AuthError(502, 'Could not reach Google to verify sign-in'); }
  if (!response.ok) throw new AuthError(401, 'Google sign-in could not be verified');
  const t = await response.json();
  if (t.aud !== clientId || !ISSUERS.has(t.iss)) throw new AuthError(401, 'Google sign-in could not be verified');
  if (!(Number(t.exp) * 1000 > now)) throw new AuthError(401, 'Google sign-in has expired; try again');
  if (!(t.email_verified === true || t.email_verified === 'true') || typeof t.email !== 'string') throw new AuthError(401, 'Your Google email address is not verified');
  return { email: t.email.trim().toLowerCase(), name: t.name ? String(t.name).slice(0, 255) : null };
}

module.exports = function registerGoogleAuth(app, { pool, getUserProfile, seedCareMilestones, jwtSecret, jwtExpiresIn, env = process.env, fetchImpl = fetch, notify = sendLoginNotice }) {
  const clientId = () => env.GOOGLE_CLIENT_ID || '';
  const tokeninfoUrl = () => (env.NODE_ENV !== 'production' && env.GOOGLE_TOKENINFO_URL) || TOKENINFO;

  app.get('/api/auth/google/config', (req, res) => {
    res.json({ enabled: Boolean(clientId()), client_id: clientId() || null, login_email: Boolean(env.SMTP_USER && env.SMTP_PASS) });
  });

  async function createPatient(email, name) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      const { rows } = await client.query("INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'mother') RETURNING *", [email, hash]);
      const careStart = new Date();
      await client.query('INSERT INTO mother_profiles (user_id, full_name, care_start_date) VALUES ($1, $2, $3)', [rows[0].id, name || email.split('@')[0], careStart]);
      await seedCareMilestones(client, rows[0].id, careStart);
      await client.query('COMMIT');
      return rows[0];
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  app.post('/api/auth/google', async (req, res) => {
    try {
      const google = await verifyGoogleCredential(req.body?.credential, { clientId: clientId(), tokeninfoUrl: tokeninfoUrl(), fetchImpl });
      let user = (await pool.query('SELECT * FROM users WHERE lower(email) = $1', [google.email])).rows[0];
      const created = !user;
      if (created) user = await createPatient(google.email, google.name);
      const profile = await getUserProfile(user.id, user.role);
      const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, jwtSecret, { expiresIn: jwtExpiresIn });
      res.cookie('token', token, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      const fullName = profile?.full_name || google.name || user.email.split('@')[0];
      const loginEmail = await notify({ email: user.email, full_name: fullName });
      res.status(created ? 201 : 200).json({
        message: 'Login successful', created, login_email: loginEmail,
        user: { id: user.id, email: user.email, role: user.role, full_name: fullName, ...profile },
      });
    } catch (e) {
      if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
      console.error('Google login error:', e.message);
      res.status(500).json({ error: 'Google sign-in failed' });
    }
  });
};
module.exports.verifyGoogleCredential = verifyGoogleCredential;
