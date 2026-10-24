'use strict';

// M. Facility quality and freshness indicators.
// Shows what is known about a facility and how old that information is. It never produces a
// score, a rank or a "best" label, and nothing here is read by facilityMatching.rankFacilities.
// Unknown stays unknown: no date, no reports and no slots are reported as exactly that.

const DAY = 86400000, HOUR = 3600000;
const RECENT_DAYS = 90, AGEING_DAYS = 365, MIN_CONTACT_REPORTS = 5, STALE_AVAILABILITY_HOURS = 48;
const iso = (t) => new Date(t).toISOString();
const dayStamp = (t) => iso(t).slice(0, 10);

function confirmation(f, now) {
  if (f.verification_source === 'synthetic_fixture') {
    return { status: 'synthetic', label: 'Fictional demo facility. Not a real provider.', last_confirmed_at: null, age_days: null, source: f.verification_source };
  }
  const t = f.verified_at ? new Date(f.verified_at).getTime() : NaN;
  if (Number.isFinite(t)) {
    const age = Math.max(0, Math.floor((now - t) / DAY));
    const status = age <= RECENT_DAYS ? 'recent' : age <= AGEING_DAYS ? 'ageing' : 'stale';
    const text = { recent: 'Confirmed recently', ageing: 'Last confirmed a while ago', stale: 'Last confirmation is over a year old' }[status];
    return { status, label: `${text} (${dayStamp(t)}, ${age} days ago).`, last_confirmed_at: iso(t), age_days: age, source: f.verification_source || null };
  }
  // Never confirmed with the facility. If the entry comes from a public directory, say so and give
  // the date the directory entry was last updated, which is not the same as a confirmation.
  const u = f.last_updated ? new Date(f.last_updated).getTime() : NaN;
  const from = f.verification_source === 'public_directory_compilation' ? 'Compiled from public information' : 'Listed';
  return {
    status: 'unconfirmed',
    label: `${from}${Number.isFinite(u) ? '; directory entry last updated ' + dayStamp(u) : ''}. Never confirmed with the facility. Call before travelling.`,
    last_confirmed_at: null, age_days: null, source: f.verification_source || null,
    directory_updated_at: Number.isFinite(u) ? iso(u) : null
  };
}

function contact(stats) {
  const reached = Number(stats?.reached || 0), notReached = Number(stats?.not_reached || 0), total = reached + notReached;
  if (total < MIN_CONTACT_REPORTS) {
    return { reliability: 'not_enough_reports', reports_last_180_days: total, label: 'Not enough recent reports to say whether this facility can be reached.' };
  }
  const ratio = reached / total;
  const reliability = ratio >= 0.8 ? 'mostly_reachable' : ratio <= 0.5 ? 'often_unreachable' : 'mixed';
  const text = { mostly_reachable: 'Most people reported reaching them.', mixed: 'Reports are mixed.', often_unreachable: 'Many people reported not reaching them.' }[reliability];
  return { reliability, reports_last_180_days: total, reached, not_reached: notReached, label: `${text} Based on ${total} user reports in the last 180 days. These are not verified.` };
}

function availability(slots, now) {
  const upcoming = (slots || []).filter((s) => new Date(s.starts_at).getTime() > now);
  if (!upcoming.length) return { status: 'none_reported', label: 'No appointment availability has been reported. Call to ask.' };
  const times = upcoming.map((s) => new Date(s.updated_at).getTime()).filter(Number.isFinite);
  const latest = times.length ? Math.max(...times) : NaN;
  const ageH = Number.isFinite(latest) ? Math.floor((now - latest) / HOUR) : null;
  const stale = ageH == null || ageH > STALE_AVAILABILITY_HOURS;
  return {
    status: stale ? 'stale' : 'reported', reported_at: Number.isFinite(latest) ? iso(latest) : null, age_hours: ageH,
    sources: [...new Set(upcoming.map((s) => s.source).filter(Boolean))], upcoming_slots: upcoming.length,
    label: (stale ? 'Availability may be out of date. ' : 'Availability was reported recently. ') + 'This is not a booking; confirm with the facility.'
  };
}

function describeFreshness(facility, contactStats, now = Date.now()) {
  const conf = confirmation(facility, now);
  const confirmed = conf.status === 'recent' || conf.status === 'ageing' || conf.status === 'stale';
  const services = (facility.services || []).map((s) => s.service_name).filter(Boolean);
  return {
    confirmation: conf,
    services: {
      listed: services,
      basis: confirmed
        ? `Services are as listed on ${dayStamp(new Date(conf.last_confirmed_at).getTime())}. Individual services are not separately verified.`
        : 'Services are listed but not confirmed. Do not rely on them without calling.'
    },
    contact: contact(contactStats),
    availability: availability(facility.slots, now),
    note: 'These indicators show how recent and well-sourced the information is. They are not a hospital-quality rating. Optional access assistance may use reported freshness within eligible search results.'
  };
}

module.exports = { describeFreshness, confirmation, contact, availability, MIN_CONTACT_REPORTS, RECENT_DAYS, AGEING_DAYS, STALE_AVAILABILITY_HOURS };
