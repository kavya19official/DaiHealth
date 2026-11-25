(function () {
  'use strict';

  const nav = document.querySelector('[data-dai-mobile-nav]');
  if (!nav) return;
  const patient = nav.dataset.daiMobileNav === 'patient';
  const sidebar = document.getElementById(patient ? 'sidebar' : 'doctorSidebar');
  const mobile = window.matchMedia('(max-width: 1024px)');
  const controls = [...nav.querySelectorAll('[data-mobile-panel]')];
  const more = nav.querySelector('[data-mobile-menu]');
  const desktopMenu = document.getElementById(patient ? 'menuBtn' : 'dwCollapse');
  const workspace = document.querySelector('.app > .main');

  let wasOpen = false;

  function openNow() {
    return mobile.matches && (patient ? sidebar.classList.contains('is-open')
      : document.body.classList.contains('dw-menu-open'));
  }

  function syncDrawer() {
    const open = openNow();
    more.setAttribute('aria-expanded', String(open));
    desktopMenu?.setAttribute('aria-expanded', String(open));
    sidebar.inert = mobile.matches && !open;
    if (workspace) workspace.inert = open;
    nav.inert = open;
    document.body.classList.toggle('dai-drawer-visible', open);
    if (open && !wasOpen) {
      sidebar.querySelector('[data-dai-drawer-close]')?.focus();
    }
    if (!open && wasOpen && mobile.matches) more.focus({preventScroll:true});
    wasOpen = open;
  }

  function syncPanel(panel) {
    for (const button of controls) {
      if (button.dataset.mobilePanel === panel) button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    }
    more.toggleAttribute('data-active', !controls.some(button => button.dataset.mobilePanel === panel));
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'dai-drawer-close';
  close.dataset.daiDrawerClose = '';
  close.textContent = 'Close navigation';
  sidebar.prepend(close);
  function closeDrawer() {
    if (!openNow()) return;
    if (patient) document.getElementById('sidebarBackdrop')?.click();
    else document.querySelector('[data-dw-close-menu]')?.click();
    syncDrawer();
  }

  more.addEventListener('click', () => {
    desktopMenu?.click();
    syncDrawer();
  });
  close.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && openNow()) closeDrawer();
  }, true);
  for (const button of controls) {
    button.addEventListener('click', () => {
      const panel = button.dataset.mobilePanel;
      if (patient) {
        if (panel === 'profile') document.querySelector('.user-chip')?.click();
        else sidebar.querySelector(`.nav-item[data-panel="${panel}"]`)?.click();
      } else {
        window.DoctorNavigation?.showPanel(panel);
        window.scrollTo({top:0,behavior:'auto'});
      }
    });
  }
  window.addEventListener(patient ? 'dai:patient-panel' : 'dai:doctor-ultrasound-panel', event => {
    if (!patient) closeDrawer();
    syncPanel(event.detail.panel);
  });

  const observer = new MutationObserver(syncDrawer);
  observer.observe(patient ? sidebar : document.body, {attributes:true,attributeFilter:['class']});

  mobile.addEventListener('change', syncDrawer);
  syncDrawer();
  syncPanel(document.querySelector('.panel.is-active')?.id.replace('panel-', '') || 'dashboard');

  // Native table navigation is retained. Only tables missing a local scroll
  // region receive one, and the original DOM is restored on desktop.
  function fitTables() {
    if (!mobile.matches) {
      for (const wrapper of document.querySelectorAll('[data-dai-table-wrap]')) {
        wrapper.replaceWith(...wrapper.childNodes);
      }
      return;
    }
    for (const table of workspace?.querySelectorAll('table') || []) {
      if (!table.getClientRects().length || table.closest('[data-dai-table-wrap]')) continue;
      const parent = table.parentElement;
      if (['auto','scroll'].includes(getComputedStyle(parent).overflowX)) continue;
      const wrap = document.createElement('div');
      wrap.className = 'dai-table-scroll';
      wrap.dataset.daiTableWrap = '';
      wrap.tabIndex = 0;
      wrap.setAttribute('role','region');
      wrap.setAttribute('aria-label', table.caption?.textContent?.trim() || 'Scrollable table');
      table.before(wrap);
      wrap.append(table);
    }
  }
  let frame;
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; fitTables(); });
  };
  if (workspace) new MutationObserver(schedule).observe(workspace,{childList:true,subtree:true});
  mobile.addEventListener('change',schedule);
  window.addEventListener(patient ? 'dai:patient-panel' : 'dai:doctor-ultrasound-panel',schedule);
  schedule();
})();
