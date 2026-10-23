/* Local-only helper: normal authenticated demo accounts, never a guest-auth bypass. */
(async function () {
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  try {
    var response = await fetch('/api/local/status');
    if (!response.ok) return;
    var status = await response.json();
    if (!status.local) return;
    if (location.pathname.endsWith('auth.html')) {
      window.dispatchEvent(new CustomEvent('dai:local-ready', {detail:status}));
      return;
    }
    var banner = document.createElement('aside');
    banner.className = 'local-workspace-banner';
    banner.setAttribute('aria-label', 'Local synthetic demo');
    banner.innerHTML = '<strong>Local DAI · Simulated on synthetic data</strong><span>Patient, Doctor and Hospital/Admin are running together. Local changes stay on this laptop.</span>';
    var main = document.querySelector('main');
    if (main) main.prepend(banner);
    document.querySelectorAll('a[href="hospital.html"]').forEach(function(a){ a.href='/auth.html?role=hospital'; });
  } catch (_) { /* Hosted and manually served apps keep their existing behaviour. */ }
})();
