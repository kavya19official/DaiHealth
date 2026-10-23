/* Local-only helper: normal authenticated demo accounts, never a guest-auth bypass. */
(async function () {
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  try {
    var response = await fetch('/api/local/status');
    if (!response.ok) return;
    var status = await response.json();
    if (!status.local) return;
    var banner = document.createElement('aside');
    banner.className = 'local-workspace-banner';
    banner.setAttribute('aria-label', 'Local synthetic demo');
    banner.innerHTML = '<strong>Local DAI · Simulated on synthetic data</strong><span>Patient, Doctor and Hospital/Admin are running together. Local changes stay on this laptop.</span>';
    var main = document.querySelector('main');
    if (main) main.prepend(banner);
    document.querySelectorAll('a[href="hospital.html"]').forEach(function(a){ a.href='/hospital-admin'; });
    if (location.pathname.endsWith('auth.html')) {
      var role = new URLSearchParams(location.search).get('role') || 'mother';
      if (role === 'hospital') { location.replace('/hospital-admin'); return; }
      var hint = document.createElement('p');
      hint.textContent = 'Local synthetic sign-in: '+(role==='doctor'?status.accounts.doctor:status.accounts.mother)+' · Password: Dai-Synthetic-2026!';
      banner.append(hint);
      var email = document.getElementById('loginEmail');
      if (email && !email.value) email.value = role==='doctor'?status.accounts.doctor:status.accounts.mother;
    }
  } catch (_) { /* Hosted and manually served apps keep their existing behaviour. */ }
})();
