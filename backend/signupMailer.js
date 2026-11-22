'use strict';

const { Resend } = require('resend');
const DEFAULT_FROM = 'DaiHealth <onboarding@resend.dev>';
const html = value => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

function buildEmail({ name, code, logo }) {
  const brand = logo
    ? `<img src="${html(logo)}" alt="DaiHealth" width="140" style="max-width:100%;height:auto;display:block">`
    : '<strong style="font-size:21px;color:#633d90">DaiHealth</strong>';
  return {
    subject: 'Your DaiHealth verification code',
    text: `Welcome to DaiHealth, ${name}.\n\nYour email verification code is ${code}. It expires in 5 minutes.\n\nIf you did not request verification, ignore this email. Never share this code with anyone.`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#f5f0fa;font-family:Arial,sans-serif;color:#302641">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border:1px solid #e6dced;border-radius:16px"><tr><td style="padding:28px">
${brand}
<h1 style="font-size:25px;margin:22px 0 12px">Verify your email</h1>
<p style="line-height:1.55">Welcome to DaiHealth, ${html(name)}. Enter this code to finish creating your patient account.</p>
<p style="text-align:center;background:#f3edf8;color:#462b65;padding:18px 8px;border-radius:8px;font-size:32px;font-weight:bold;letter-spacing:6px">${html(code)}</p>
<p style="line-height:1.55">This code expires in <strong>5 minutes</strong>. Keep it private.</p>
<hr style="border:0;border-top:1px solid #e6dced">
<p style="font-size:14px;line-height:1.55;color:#675271">If you did not request verification, you can ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`
  };
}

function signupMailer(env = process.env) {
  const key = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim() || DEFAULT_FROM;
  const recipient = env.RESEND_TEST_EMAIL?.trim().toLowerCase();
  let logo;
  try {
    const url = new URL(env.EMAIL_LOGO_URL);
    if (url.protocol === 'https:' && !url.username && !url.password) logo = url.href;
  } catch { /* The text wordmark works without a remote image. */ }

  const address = from.match(/^[^<>]+ <([^<>]+)>$/)?.[1] || from;
  const configured = Boolean(key) && !/[\r\n]/.test(from) &&
    /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address);
  const resend = configured ? new Resend(key) : null;
  return {
    configured,
    allows(email) { return !recipient || recipient === email; },
    async send({ email, name, code, generation }) {
      const { data, error } = await resend.emails.send(
        { from, to: email, ...buildEmail({ name, code, logo }) },
        { idempotencyKey: 'dai-signup/' + generation, signal: AbortSignal.timeout(10000) }
      );
      // Provider error bodies can contain recipient details. Keep them server-private.
      return !error && Boolean(data?.id);
    }
  };
}

module.exports = signupMailer;
