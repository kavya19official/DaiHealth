/* A patient-led journey through recorded care. No inferred clinical completion. */
(function () {
'use strict';
let data, prefs = {}, filter = 'all', lane = 'mother', baby, compact = false;
let previous = new Map(), hasRendered = false, contrast = false, lowMotion = false;
const expanded = new Map();
try {
  contrast = localStorage.getItem('dai_journey_contrast') === '1';
  lowMotion = localStorage.getItem('dai_journey_simple') === '1';
} catch {}
const $ = id => document.getElementById(id), M = () => window.PatientModel, E = x => M().escape(x);
const svg = name => '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>';
const icons = { visits: 'clipboard', tests: 'droplet', scans: 'scan', nutrition: 'pill', vaccines: 'shield', body: 'heart', prep: 'flag' };
const labels = { completed: 'Done', overdue: 'Let’s catch up', due: 'Due soon', upcoming: 'Upcoming', queued: 'Waiting to sync' };
const fmt = d => d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString(document.documentElement.lang || 'en', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date to confirm';
const stopId = m => 'journey-stop-' + String(m.id).replace(/[^\w-]/g, '');
function category(m) {
  if (m.child) return 'vaccines';
  const t = (m.title + ' ' + (m.guidance || '')).toLowerCase();
  return /vaccin|bcg|opv|td dose/.test(t) ? 'vaccines' : /nutrition|iron|calcium|supplement/.test(t) ? 'nutrition' : /scan|ultrasound/.test(t) ? 'scans' : /test|blood|glucose|haemoglobin|ogtt/.test(t) ? 'tests' : /birth plan|hospital|transport|bag|readiness/.test(t) ? 'prep' : /mood|breast|recovery|postnatal|pnc|mental/.test(t) ? 'body' : 'visits';
}
function plain(m) {
  const t = m.title;
  return /glucose|ogtt/i.test(t) ? 'Your sugar test' : /haemoglobin|\bhb\b/i.test(t) ? 'Your blood count check' : /anomaly/i.test(t) ? 'Your baby’s detailed scan' : /first antenatal/i.test(t) ? 'Your first pregnancy visit' : t;
}
function week(m) {
  const start = data.user.lmp_date || data.user.care_start_date;
  return start && m.due_date ? Math.max(0, Math.floor(M().days(m.due_date, start) / 7)) : null;
}
function status(m) {
  if (m.status === 'queued') return 'queued';
  const s = M().status(m);
  return s === 'upcoming' && m.due_date && M().days(m.due_date, M().today()) <= 7 ? 'due' : s;
}
function items() {
  if (lane === 'baby') {
    const c = (data.children || []).find(c => String(c.id) === String(baby)) || data.children?.[0];
    if (!c || !window.AnvayaChild) return [];
    const map = Object.fromEntries((c.vaccinations || []).map(v => [v.vaccine_code, v.given_on]));
    return AnvayaChild.vaccineSchedule(String(c.date_of_birth).slice(0, 10), map, M().today()).filter(v => !v.conditional || v.givenOn).map(v => ({ id: 'baby-' + c.id + '-' + v.code, title: v.name, category: 'vaccines', due_date: v.dueDate, status: v.status === 'completed' ? 'completed' : v.status === 'missed' ? 'overdue' : 'upcoming', guidance: 'A little protection, one visit at a time. Your vaccination centre can confirm doses and a catch-up plan.', child: c.id, birth: c.date_of_birth, given: v.givenOn, zone: 'baby' }));
  }
  const rows = (data.milestones || []).filter(m => m.category !== 'child').map(m => ({ ...m, zone: week(m) < 14 ? 't1' : week(m) < 28 ? 't2' : 't3' }));
  if (data.post?.active) for (const p of data.post.schedule || []) rows.push({ id: 'post-' + p.code, title: p.title, due_date: p.window_end, guidance: p.why, status: p.status === 'done' ? 'completed' : p.status, post: true, zone: 'post' });
  return rows.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
}
const zones = [
  { id: 't1', symbol: 'seed', label: 'Little beginnings', short: 'First trimester', sub: 'Weeks 0–13', text: 'The first chapter of a very personal story.' },
  { id: 't2', symbol: 'leaf', label: 'Growing, together', short: 'Second trimester', sub: 'Weeks 14–27', text: 'Room for new questions, little movements and your next checks.' },
  { id: 't3', symbol: 'bloom', label: 'Almost time to meet', short: 'Third trimester', sub: 'Week 28 onwards', text: 'Your care team, your birth plan, your next beginning.' },
  { id: 'post', symbol: 'heart', label: 'A little care for you, too', short: 'Your recovery', sub: 'After delivery', text: 'There is room in this new chapter for your recovery and support.' },
  { id: 'baby', symbol: 'bloom', label: 'Hello, little one', short: 'Baby’s journey', sub: 'Vaccines & follow-ups', text: 'Small steps for a growing world. This baby’s records stay their own.' }
];
function plant(type) {
  const petals = type === 'bloom' ? '<g fill="currentColor" opacity=".22"><ellipse cx="60" cy="21" rx="10" ry="18"/><ellipse cx="60" cy="21" rx="10" ry="18" transform="rotate(60 60 21)"/><ellipse cx="60" cy="21" rx="10" ry="18" transform="rotate(120 60 21)"/></g><circle cx="60" cy="21" r="6" fill="currentColor"/>' : type === 'heart' ? '<path d="M60 37C32 20 43 1 60 14C77 1 88 20 60 37Z" fill="currentColor" opacity=".4"/>' : '<ellipse cx="60" cy="23" rx="8" ry="13" fill="currentColor" opacity=".4"/>';
  return '<svg viewBox="0 0 120 120" class="journey-botanical" aria-hidden="true"><path d="M24 110Q60 100 97 110M60 104Q45 73 60 36" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M56 83Q18 82 23 50Q51 50 56 83ZM56 68Q94 69 98 39Q68 37 56 68Z" fill="currentColor" opacity=".18"/><path d="M56 83L30 58M56 68L90 45" fill="none" stroke="currentColor" stroke-width="1" opacity=".4"/>' + petals + '</svg>';
}
function details(m, s) {
  const kind = category(m);
  const primary = s === 'completed' ? '<div class="stop-complete-note">✓ ' + (m.verified_facility_name ? 'Verified by ' + E(m.verified_facility_name) : 'Recorded as completed') + '</div>' : s === 'queued' ? '<p class="stop-sync">Your update is saved on this device and waiting to sync.</p>' : m.child ? '<button type="button" class="btn btn--primary" data-journey-child="' + E(m.child) + '">Open this baby’s record →</button>' : m.post ? '<button type="button" class="btn btn--primary" data-route="postpartum">Open recovery check-in →</button>' : '<button type="button" class="btn btn--primary" data-book="' + E(m.title) + '">' + (/tests|scans/.test(kind) ? 'Find care / book' : 'Book a visit') + ' →</button>';
  return '<div class="stop-content"><p class="stop-guidance">' + E(m.guidance || 'Bring your questions. Your care team will help you plan the next step.') + '</p><div class="stop-actions">' + primary + '<button type="button" class="journey-listen" data-journey-listen="' + stopId(m) + '" aria-label="Listen to ' + E(plain(m)) + '">' + svg('speaker') + ' Listen</button></div>' + (!m.child && !m.post && s !== 'completed' && s !== 'queued' ? '<div class="stop-secondary"><button type="button" class="link-btn" data-finish="' + E(m.id) + '">Mark done</button><button type="button" class="link-btn" data-route="records">Upload report</button></div>' : '') + '<details class="stop-details"><summary>Preparation & care progress</summary><div class="stop-loop" aria-label="Recorded care loop"><span class="loop-dot is-done">Planned</span><span class="loop-dot ' + (m.appointment_id ? 'is-done' : '') + '">Booked</span><span class="loop-dot ' + (m.result_id ? 'is-done' : '') + '">Result</span><span class="loop-dot ' + (s === 'completed' ? 'is-done' : '') + '">Done</span></div><small class="loop-note">' + (m.result_id ? 'Linked result recorded.' : s === 'completed' ? 'Completion recorded; result verification is not implied.' : 'Booking and results appear only when linked to this step.') + '</small><p>' + E(m.post ? 'Scheduled from your recorded delivery date.' : m.child ? 'Scheduled from this baby’s date of birth.' : 'From your recorded care plan and pregnancy dates.') + ' Bring your care card and previous reports. Confirm any fasting or other preparation with your clinician.</p><button type="button" class="link-btn" data-route="schemes">Official scheme information →</button><button type="button" class="link-btn" data-journey-questions="' + E(m.title) + '">Questions for my doctor →</button></details></div>';
}
function card(m, index, current) {
  const s = status(m), id = stopId(m), open = expanded.has(id) ? expanded.get(id) : current && !compact;
  const when = m.post ? 'Recovery' : m.child ? 'Baby’s care' : week(m) !== null ? 'Week ' + week(m) : 'Your care';
  return '<article id="' + id + '" class="journey-stop stop-' + s + (current ? ' stop-current' : '') + '" data-week="' + (m.child || m.post ? '' : week(m) ?? '') + '"><div class="path-node" aria-hidden="true">' + (s === 'completed' ? (window.PatientVisuals?.checkmark()||'✓') : current ? '♡' : '·') + '</div><details class="stop-card" data-stop-expand="' + id + '" ' + (open ? 'open' : '') + '><summary class="stop-summary"><span class="stop-icon">' + svg(icons[category(m)] || 'heart') + '</span><span class="stop-heading">' + (current ? '<span class="you-are-here">YOUR NEXT STEP</span>' : '') + '<span class="stop-when">' + E(when) + ' <span>· ' + E(fmt(m.due_date)) + '</span></span><strong>' + E(plain(m)) + '</strong>' + (m.doctor_name && m.added_by_doctor_id ? '<span class="doctor-note">From ' + E(m.doctor_name) + '</span>' : '') + '</span><span class="stop-status">' + (s === 'completed' ? '✓ ' : s === 'overdue' ? '◷ ' : s === 'queued' ? '↻ ' : '○ ') + (s==='completed'&&m.completion_verification==='awaiting_verification'?'Awaiting review':labels[s]) + '</span><span class="stop-chevron" aria-hidden="true">⌄</span></summary>' + details(m, s) + '</details></article>';
}
function deliveryChapter() {
  return '<aside class="delivery-chapter"><span>YOUR BIRTH CHAPTER</span><h3>Pack a little peace of mind.</h3><div><p><strong>Your hospital</strong>' + E(data.overview?.registered_facility?.name || 'Not selected yet') + '</p><p><strong>Your emergency contact</strong>' + E(data.user.emergency_contact_name || 'Not recorded yet') + '</p></div><p>Discuss your bag and transport plan with your care team. Hospital readiness is not yet confirmed here.</p><button type="button" class="link-btn" data-route="profile">Review my birth & contact details →</button></aside>';
}
function render() {
  if (!data?.user) return;
  const root = $('timelineList'); if (!root) return;
  root.classList.toggle('journey-high-contrast', contrast); root.classList.toggle('journey-simple', lowMotion);
  const all = items(), visible = all.filter(m => filter === 'all' || category(m) === filter || (filter === 'tests' && category(m) === 'scans'));
  const completed = all.filter(m => status(m) === 'completed').length, percent = all.length ? Math.round(completed / all.length * 100) : 0;
  const st = M().stage(data.user, data.post, data.children);
  // Old antenatal gaps stay in history after birth; recovery is the current chapter.
  const current = all.find(m => status(m) !== 'completed' && (!st.delivered || lane === 'baby' || m.post));
  const activeZone = lane === 'baby' ? 'baby' : st.delivered ? 'post' : st.week === null ? 't1' : st.week < 14 ? 't1' : st.week < 28 ? 't2' : 't3';
  const chapters = zones.filter(z => visible.some(m => m.zone === z.id));
  root.innerHTML = '<header class="journey-intro"><div class="journey-intro-copy"><span class="journey-eyebrow">YOUR CARE TIMELINE</span><h2>Every little step, a story of love.</h2><p>A place for your firsts, your follow-ups, and everything you’re growing into.</p><div class="journey-stage-pill">' + svg(lane === 'baby' ? 'baby' : 'heart') + E(lane === 'baby' ? 'Each baby. Their own little journey.' : st.label) + '</div><div class="journey-view-switch"><button type="button" data-journey-lane="mother" aria-pressed="' + (lane === 'mother') + '">♡ Mother’s journey</button><button type="button" data-journey-lane="baby" aria-pressed="' + (lane === 'baby') + '" ' + (!data.children?.length ? 'disabled' : '') + '>' + svg('baby') + ' Baby’s journey</button></div></div></header>' +
    '<div class="journey-toolbar"><div class="journey-filters" role="group" aria-label="Timeline filters">' + [['all', 'All steps'], ['visits', 'Visits'], ['tests', 'Tests & scans'], ['nutrition', 'Nutrition'], ['vaccines', 'Vaccines'], ['body', 'Mind & body'], ['prep', 'Hospital prep']].map(([k, title]) => '<button type="button" data-journey-filter="' + k + '" aria-pressed="' + (filter === k) + '">' + title + '</button>').join('') + '</div><details class="journey-options"><summary aria-label="Journey display options">•••</summary><div><button type="button" data-journey-compact aria-pressed="' + compact + '">Close / open next step</button><button type="button" data-journey-recap>Save my journey</button><button type="button" data-journey-contrast aria-pressed="' + contrast + '">High contrast</button><button type="button" data-journey-simple aria-pressed="' + lowMotion + '">Low bandwidth</button></div></details></div>' +
    (lane === 'baby' ? '<div class="journey-baby-tabs" role="tablist" aria-label="Choose a baby">' + (data.children || []).map((c, i) => '<button type="button" role="tab" data-journey-baby="' + E(c.id) + '" aria-selected="' + (String(baby || data.children[0].id) === String(c.id)) + '">' + E(/^CHILD-SYN-/.test(c.name) ? 'Baby ' + (i + 1) : c.name) + '</button>').join('') + '</div>' : '') +
    '<div class="journey-workspace"><aside class="journey-sidebar"><span class="journey-eyebrow">THE CHAPTERS</span><nav aria-label="Care chapters">' + chapters.map((z, i) => '<button type="button" data-journey-chapter="' + z.id + '" ' + (z.id === activeZone ? 'aria-current="step"' : '') + '><span class="chapter-number">' + String(i + 1).padStart(2, '0') + '</span><span><strong>' + E(z.short) + '</strong><small>' + E(z.sub) + '</small></span>' + (z.id === activeZone ? '<i aria-hidden="true">●</i>' : '') + '</button>').join('') + '</nav><div class="journey-progress-card"><div class="journey-completion"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42"/><circle class="completion-stroke" cx="50" cy="50" r="42" stroke-dasharray="' + percent * 2.639 + ' 263.9"/></svg><strong>' + completed + '<small>of ' + all.length + ' steps</small></strong></div><strong>Your journey. Your pace.</strong><p>Every recorded step counts.<br>We’ll take the next one together.</p></div><button type="button" class="journey-find-next" data-journey-current>Find my next step ↗</button></aside>' +
    '<div class="journey-landscape">' + (data.overview?.clinician_status && lane === 'mother' ? '<aside class="journey-extra-plan">' + svg('heart') + '<div><strong>Care plan marked by your clinician</strong><p>' + E(data.overview.clinician_status.doctor || 'Your care team') + ' · Extra checks appear only when recorded.</p></div></aside>' : '') +
    chapters.map(z => {
      const rows = visible.filter(m => m.zone === z.id), done = rows.filter(m => status(m) === 'completed').length;
      return '<section class="journey-zone zone-' + z.id + '" id="journey-zone-' + z.id + '"><header class="zone-header"><div><span>' + E(z.short) + ' · ' + E(z.sub) + '</span><h3>' + E(z.label) + '</h3><p>' + E(z.text) + '</p>' + (z.id === activeZone ? '<span class="chapter-now">' + svg(lane === 'baby' ? 'baby' : 'heart') + E(lane === 'baby' ? 'This baby’s own care path' : st.label) + ' · You are here</span>' : '') + '</div>' + plant(z.symbol) + '</header><div class="journey-path"><svg class="winding-river" width="52" height="100%" aria-hidden="true"><defs><pattern id="river-' + z.id + '" width="52" height="300" patternUnits="userSpaceOnUse"><path d="M26 0C-4 65 56 90 26 150S-4 235 26 300" fill="none" stroke="var(--journey-river)" stroke-width="12"/><path d="M26 0C-4 65 56 90 26 150S-4 235 26 300" fill="none" stroke="var(--brand-mid)" stroke-opacity=".45" stroke-width="1.5" stroke-dasharray="2 7"/></pattern></defs><rect width="52" height="100%" fill="url(#river-' + z.id + ')"/></svg>' + rows.map((m, i) => card(m, i, m.id === current?.id)).join('') + '</div><div class="zone-recap"><span>✦</span><p><strong>' + done + ' of ' + rows.length + ' recorded steps completed</strong> ' + (done === rows.length && done ? 'A chapter to remember.' : 'One step at a time.') + '</p></div>' + (z.id === 't3' ? deliveryChapter() : '') + '</section>';
    }).join('') + (!visible.length ? '<div class="journey-empty">✿<h3>A little space for your next step.</h3><p>No recorded items match this filter. Choose All to return to your journey.</p></div>' : '') + '</div></div>' +
    '<aside class="journey-week-ruler" ' + (lane === 'baby' || st.delivered ? 'hidden' : '') + '><label for="journeyWeek">Explore week <strong id="journeyWeekValue">' + (st.week ?? 0) + '</strong></label><input id="journeyWeek" type="range" min="0" max="42" value="' + Math.min(42, st.week || 0) + '" aria-label="Jump to a pregnancy week"><button type="button" data-journey-current>Next step ↗</button></aside><footer class="journey-trust">' + svg('shield') + ' Your recorded plan · Synthetic demonstration · Your clinician interprets your results.</footer>';
  for (const m of all) {
    const s = status(m);
    if (hasRendered && previous.get(String(m.id)) && previous.get(String(m.id)) !== 'completed' && s === 'completed') window.PatientHome?.celebrate('Another little step, completed.');
    previous.set(String(m.id), s);
  }
  hasRendered = true;
}
function listen(id) {
  if (!window.speechSynthesis) return window.DaiAPI.toast('Read-aloud is unavailable in this browser.');
  speechSynthesis.cancel();
  const lang = document.documentElement.lang || 'en', voice = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith(lang));
  if (!voice && lang !== 'en') return DaiAPI.toast('Install a device voice for this language, or choose English.');
  const m = items().find(m => stopId(m) === id), u = new SpeechSynthesisUtterance(m ? plain(m) + '. ' + fmt(m.due_date) + '. ' + labels[status(m)] + '. ' + (m.guidance || '') : '');
  u.lang = voice?.lang || 'en-IN'; if (voice) u.voice = voice; speechSynthesis.speak(u);
}
function recap() {
  const text = ['DAI · My recorded care journey', 'Synthetic demonstration', ...items().map(m => fmt(m.due_date) + ' · ' + plain(m) + ' · ' + status(m)), 'Completion reflects recorded events; it is not clinical clearance.'].join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' })), a = document.createElement('a');
  a.href = url; a.download = 'dai-my-care-journey.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function scrollTo(el) { el?.scrollIntoView({ behavior: lowMotion || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' }); }
document.addEventListener('toggle', e => {
  const id = e.target.dataset?.stopExpand;
  if (id) expanded.set(id, e.target.open);
}, true);
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.journeyFilter) { filter = b.dataset.journeyFilter; render(); }
  if (b.dataset.journeyLane) { lane = b.dataset.journeyLane; filter = 'all'; render(); }
  if (b.dataset.journeyBaby) { baby = b.dataset.journeyBaby; render(); }
  if (b.hasAttribute('data-journey-compact')) { compact = !compact; expanded.clear(); render(); }
  if (b.dataset.journeyListen) listen(b.dataset.journeyListen);
  if (b.hasAttribute('data-journey-recap')) recap();
  if (b.hasAttribute('data-journey-contrast')) { contrast = !contrast; localStorage.setItem('dai_journey_contrast', contrast ? '1' : '0'); render(); }
  if (b.hasAttribute('data-journey-simple')) { lowMotion = !lowMotion; localStorage.setItem('dai_journey_simple', lowMotion ? '1' : '0'); render(); }
  if (b.dataset.journeyChild) { localStorage.setItem('dai_active_child', b.dataset.journeyChild); location.href = 'child-dashboard.html'; }
  if (b.dataset.journeyQuestions) window.PatientExperience.askDaya('What should I ask my doctor about ' + b.dataset.journeyQuestions + '?');
  if (b.dataset.journeyChapter) scrollTo($('journey-zone-' + b.dataset.journeyChapter));
  if (b.hasAttribute('data-journey-current')) {
    const current = document.querySelector('.stop-current');
    if (!current) return window.DaiAPI.toast('No next step is recorded in this view. Try All steps.');
    const detail = current.querySelector('[data-stop-expand]'); if (detail) detail.open = true;
    scrollTo(current);
  }
});
document.addEventListener('input', e => {
  if (e.target.id !== 'journeyWeek') return;
  const w = Number(e.target.value); $('journeyWeekValue').textContent = w;
  const stops = Array.from(document.querySelectorAll('.journey-stop[data-week]')).filter(x => x.dataset.week !== '');
  const target = stops.sort((a, b) => Math.abs(Number(a.dataset.week) - w) - Math.abs(Number(b.dataset.week) - w))[0];
  target?.scrollIntoView({ behavior: 'instant', block: 'center' });
});
window.PatientJourney = { update(next, p) { data = next; prefs = p; render(); }, category };
})();
