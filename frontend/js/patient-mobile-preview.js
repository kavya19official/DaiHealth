/* Recording preview: a real narrow viewport for the existing patient portal. */
(function () {
  'use strict';
  if (new URLSearchParams(location.search).has('patientMobilePreview')) return;
  const host = document.querySelector('.topbar__right');
  if (!host) return;
  const labels = {
    en: ['Mobile view', 'Patient mobile view', 'Back to desktop'],
    hi: ['मोबाइल दृश्य', 'रोगी का मोबाइल दृश्य', 'डेस्कटॉप पर वापस जाएँ'],
    mr: ['मोबाइल दृश्य', 'रुग्णाचे मोबाइल दृश्य', 'डेस्कटॉपवर परत जा']
  };
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'patient-mobile-preview-button';
  button.id = 'patientMobileView';
  button.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/></svg><span></span>';
  host.prepend(button);
  const dialog = document.createElement('dialog');
  dialog.className = 'patient-mobile-preview';
  dialog.setAttribute('aria-labelledby', 'patientMobilePreviewTitle');
  dialog.innerHTML = '<div class="patient-mobile-preview-toolbar"><strong id="patientMobilePreviewTitle"></strong><button type="button" class="patient-mobile-preview-close"></button></div><div class="patient-mobile-preview-stage"><iframe title="Patient mobile view" allow="camera; microphone; geolocation; fullscreen"></iframe></div>';
  document.body.append(dialog);
  const frame = dialog.querySelector('iframe');
  const close = dialog.querySelector('button');
  function translate() {
    const copy = labels[document.documentElement.lang] || labels.en;
    button.querySelector('span').textContent = copy[0];
    dialog.querySelector('strong').textContent = copy[1];
    close.textContent = copy[2];
    frame.title = copy[1];
  }
  translate();
  new MutationObserver(translate).observe(document.documentElement, {attributes:true, attributeFilter:['lang']});
  button.addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.set('patientMobilePreview', '1');
    frame.src = url.href;
    dialog.showModal();
    close.focus();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    // Keep the page selected during the recording when returning to desktop.
    try { if (frame.contentWindow.location.pathname === location.pathname) location.hash = frame.contentWindow.location.hash; } catch (_) {}
    frame.src = 'about:blank';
    button.focus();
  });
}());
