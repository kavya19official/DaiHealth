(() => {
  'use strict';

  const field = id => document.getElementById(id);
  const api = window.DaiAPI ? window.DaiAPI.API_BASE : (window.DAI_API_BASE || '/api');
  const signup = field('signupForm');
  const verification = field('signupOtpForm');
  const email = field('signupEmail');
  const code = field('signupCode');
  const status = field('signupStatus');
  const send = field('signupSubmit');
  const verify = field('signupVerify');
  const resend = field('signupResend');
  const back = field('signupBack');
  const locks = { signup: 0, resend: 0 };
  let challenge;
  let activeForm;
  let timer;

  const passwordToggles = document.querySelectorAll('[data-password-toggle]');
  passwordToggles.forEach(button => {
    const input = field(button.dataset.passwordToggle);
    const label = button.getAttribute('aria-label');
    button.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Hide' : 'Show';
      button.setAttribute('aria-label', show ? label.replace('Show', 'Hide') : label);
    });
  });

  function show(message, isError = false) {
    status.toggleAttribute('data-error', isError);
    status.hidden = !message;
    status.textContent = message;
  }

  function renderControls() {
    const now = Date.now();
    const waitForStart = Math.max(0, Math.ceil((locks.signup - now) / 1000));
    const waitForResend = Math.max(0, Math.ceil((locks.resend - now) / 1000));
    send.disabled = Boolean(activeForm || waitForStart);
    resend.disabled = Boolean(activeForm || waitForResend || !challenge);
    verify.disabled = Boolean(activeForm || !challenge);
    back.disabled = Boolean(activeForm);
    send.textContent = activeForm === send ? 'Sending…' : waitForStart ? `Try again in ${waitForStart}s` : 'Send verification code';
    verify.textContent = activeForm === verify ? 'Verifying…' : 'Verify and create account';
    resend.textContent = activeForm === resend ? 'Sending…' : waitForResend ? `Resend code in ${waitForResend}s` : 'Resend code';
    signup.setAttribute('aria-busy', String(activeForm === send));
    verification.setAttribute('aria-busy', String(activeForm === verify || activeForm === resend));
    clearTimeout(timer);
    if (waitForResend || waitForStart) timer = setTimeout(renderControls, 1000);
  }

  function setCooldown(type, seconds) {
    locks[type] = Date.now() + Math.max(0, Number(seconds) || 0) * 1000;
  }

  async function request(path, body, button, onSuccess, cooldownType) {
    if (activeForm || button.disabled) return;
    activeForm = button;
    renderControls();
    show('');
    try {
      const response = await fetch(api + '/auth/signup' + path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok) {
        if (cooldownType && data.retry_after) setCooldown(cooldownType, data.retry_after);
        show(data.error || 'Something went wrong. Please try again.', true);
        return;
      }
      onSuccess(data);
    } catch {
      show('Could not reach DaiHealth. Check your connection and try again.', true);
    } finally {
      activeForm = null;
      renderControls();
    }
  }

  function sent(data, message) {
    challenge = data.challenge_id;
    setCooldown('resend', data.resend_in);
    code.value = '';
    show(message);
    code.focus();
  }

  signup.addEventListener('submit', event => {
    event.preventDefault();
    const name = field('signupName').value.trim();
    const password = field('signupPassword').value;
    const confirmation = field('signupConfirm').value;
    if (!name) return show('Enter your full name.', true);
    if (new TextEncoder().encode(password).length > 72) return show('Your password must be at most 72 UTF-8 bytes.', true);
    if (password !== confirmation) return show('The passwords do not match.', true);
    const address = email.value.trim().toLowerCase();
    request('', { full_name: name, email: address, password, confirm_password: confirmation }, send, data => {
      signup.hidden = true;
      signup.reset();
      signup.querySelectorAll('[data-password-toggle]').forEach(button => {
        if (field(button.dataset.passwordToggle).type === 'text') button.click();
      });
      field('signupName').value = name;
      email.value = address;
      verification.hidden = false;
      sent(data, `We sent a code to ${address}. It expires in 5 minutes.`);
    }, 'signup');
  });

  verification.addEventListener('submit', event => {
    event.preventDefault();
    request('/verify', { challenge_id: challenge, code: code.value }, verify, data => {
      challenge = null;
      show('Email verified. Opening your patient dashboard…');
      document.dispatchEvent(new CustomEvent('dai:signup-verified', { detail: data.user }));
    });
  });

  resend.addEventListener('click', () => {
    request('/resend', { challenge_id: challenge }, resend, data => {
      sent(data, 'A new code was sent. Use the latest email within 5 minutes.');
    }, 'resend');
  });

  back.addEventListener('click', () => {
    challenge = null;
    code.value = '';
    verification.hidden = true;
    signup.hidden = false;
    show('');
    renderControls();
    email.focus();
  });

  renderControls();
})();
