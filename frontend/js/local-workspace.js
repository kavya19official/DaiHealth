/* Local-only helper: normal authenticated demo accounts, never a guest-auth bypass. */
(async function () {
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  try {
    var response = await fetch('/api/local/status');
    if (!response.ok) return;
    var status = await response.json();
    if (!status.local) return;
    if (document.body.classList.contains('auth-page')) {
      window.dispatchEvent(new CustomEvent('dai:local-ready', {detail:status}));
      return;
    }
    // Keep provenance accessible once without repeating a banner above every page.
    var info = document.createElement('details');
    info.className = 'local-demo-info';
    info.innerHTML = '<summary>About this demo</summary><p>This local prototype uses fictional people, facilities and synthetic records. Forecasts are demonstrations, not validated clinical guidance. Changes stay on this laptop.</p>';
    var sidebar = document.querySelector('.sidebar, .hs-sidebar');
    var main = document.querySelector('main');
    if (!document.querySelector('.local-demo-info')) {
      if (sidebar) sidebar.appendChild(info);
      else if (main) main.appendChild(info);
    }
    document.querySelectorAll('a[href="hospital.html"]').forEach(function(a){ a.href='/auth.html?role=hospital'; });
  } catch (_) { /* Hosted and manually served apps keep their existing behaviour. */ }
})();
