# Patient email signup

Open **Sign up** at `/auth.html`, enter your name, email and password, then enter the six-digit code. DaiHealth creates the account and starts the normal patient session only after verification. Patients can sign in with the same email and password afterward. The login tabs for existing patients, doctors and hospital staff remain available. Doctors can still provision a colleague from the clinical workspace, and hospital and ASHA accounts still use the portal’s existing sign-in.

## Local setup and a real delivery test

1. Use Node.js 22.13 or newer and the Python version listed in the [project setup](../README.md#quick-start).
2. Create or update `backend/.env`. If you already have this file, add the variables to it. The file is ignored by Git.

   ```dotenv
   RESEND_API_KEY=<replacement-resend-key>
   EMAIL_FROM="DaiHealth <onboarding@resend.dev>"
   RESEND_TEST_EMAIL=<your-verified-resend-account-email>
   ```

3. Run `npm start` from the repository root. If it is already running, use `npm run stop` first. The launcher installs the locked dependencies and applies `backend/db/email_signup.sql` automatically. Signup uses the launcher’s existing JWT secret unless `SIGNUP_OTP_SECRET` is set.
4. Visit [http://localhost:3001/auth.html](http://localhost:3001/auth.html) and sign up using your verified Resend account email. Check the inbox or spam folder and look for the email in your Resend dashboard. Resend restricts delivery from `onboarding@resend.dev` to your own account email. Use a local database where that email is free for the test.
5. Enter the code within five minutes, check that the patient dashboard opens, then log out and sign in with the new credentials. To test resend, wait for the 60-second countdown and use the most recent email.

For an automated run without an inbox, run `npm ci --prefix backend` and `node --test backend/localAuth.test.js`. It runs the real Express routes, the embedded database and the official Resend SDK against a local test endpoint.

## Render environment

In the Render dashboard, select the backend web service, open **Environment**, and add these values. Select **Save only** if you want to apply them with your next manual deploy.

| Variable | Value |
| --- | --- |
| `RESEND_API_KEY` | A Resend sending key stored on the backend |
| `EMAIL_FROM` | `DaiHealth <onboarding@resend.dev>` for testing. A blank value uses this default. |
| `RESEND_TEST_EMAIL` | Your verified Resend account email. Remove this restriction after verifying your sender domain. |
| `SIGNUP_OTP_SECRET` | Optional dedicated stable secret, at least 32 characters. Generate with `openssl rand -hex 32`. |
| `JWT_SECRET` | Keep the existing signing secret. Signup requires a configured JWT signing secret of at least 32 characters. |
| `EMAIL_LOGO_URL` | Optional public HTTPS logo URL, for example `https://your-daihealth-host.example/assets/logo.jpeg`. |

Keep your existing demo, database and audit settings. The current Render Docker launcher applies the migration on startup using its persistent data disk. Hosted demo login and the existing demo access gate still apply.

For standalone Express with PostgreSQL, apply the migration to the target database after the existing schema migrations and before starting the updated server. Keep the standalone deployment’s existing timeline and consent signing keys, database configuration and document storage paths. Existing users retain their sign-in policy.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/db/email_signup.sql
npm ci --prefix backend
npm start --prefix backend
```

## Switch to public email delivery

Add a sending domain or subdomain in [Resend Domains](https://resend.com/docs/dashboard/domains/introduction). Publish the DNS records Resend supplies and wait for the domain to show as verified. Set `EMAIL_FROM` to your verified sender, for example `DaiHealth <hello@updates.your-domain.example>`, remove `RESEND_TEST_EMAIL`, and restart or redeploy the backend. If your sending key is limited to a specific domain, configure a key that can send from the verified domain. The signup code and routes stay the same.

The existing Google login and its optional SMTP login notices have their own configuration. Resend handles email verification for password-based patient signup.

## Existing API clients

`POST /api/auth/signup` accepts `full_name`, `email`, `password`, and `confirm_password`. A successful response is HTTP 202 and includes an opaque `challenge_id`, `expires_in`, and `resend_in`. Send the challenge ID and six-digit `code` to `POST /api/auth/signup/verify`. HTTP 201 returns the patient and the existing HttpOnly session cookie. `POST /api/auth/signup/resend` accepts the same challenge ID. A successful resend resets the five-minute deadline and invalidates the previous code.

The legacy `POST /api/auth/register/mother` route also starts a verification challenge. Authorized doctors can use `POST /api/doctor/colleagues`; the existing `POST /api/auth/register/doctor` path requires the same clinician session.
