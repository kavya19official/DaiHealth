"use strict";
// Ranking uses stated preferences only. Required service/capability are eligibility gates.
const VERSION = "access-preferences-v1";
const present = (value) =>
  value !== undefined && value !== null && value !== "";
const numeric = (value, name, min, max) => {
  if (!present(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max)
    throw new Error(`${name} must be between ${min} and ${max}`);
  return n;
};
function parsePreferences(query = {}) {
  for (const value of Object.values(query))
    if (Array.isArray(value) || (typeof value === "object" && value !== null))
      throw new Error("Use one value per search preference");
  const p = {
    service: String(query.service || "").trim(),
    capability: String(query.capability || "").trim(),
    language: String(query.language || "")
      .trim()
      .toLowerCase(),
    accessibility: String(query.accessibility || "").trim(),
    user_lat: numeric(query.user_lat, "Latitude", -90, 90),
    user_lon: numeric(query.user_lon, "Longitude", -180, 180),
    max_distance_km: numeric(query.max_distance_km, "Maximum distance", 1, 500),
    budget_min: numeric(query.budget_min, "Minimum budget", 0, 1000000),
    budget_max: numeric(query.budget_max, "Maximum budget", 0, 1000000),
    preferred_date: String(query.preferred_date || ""),
    preferred_time: String(query.preferred_time || ""),
    transport_difficulty: query.transport_difficulty === "true",
    strict_preferences: query.strict_preferences === "true",
  };
  if ((p.user_lat === null) !== (p.user_lon === null))
    throw new Error("Provide both latitude and longitude");
  if (
    p.budget_min !== null &&
    p.budget_max !== null &&
    p.budget_max < p.budget_min
  )
    throw new Error("Maximum budget must be at least the minimum budget");
  if (
    p.preferred_date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(p.preferred_date) ||
      new Date(p.preferred_date + "T00:00:00Z").toISOString().slice(0, 10) !==
        p.preferred_date)
  )
    throw new Error("Choose a valid appointment date");
  if (
    p.preferred_time &&
    !["morning", "afternoon", "evening"].includes(p.preferred_time)
  )
    throw new Error("Choose morning, afternoon or evening");
  for (const key of ["transport_difficulty", "strict_preferences"])
    if (present(query[key]) && !["true", "false"].includes(query[key]))
      throw new Error("Invalid " + key);
  if (
    p.service.length > 100 ||
    p.capability.length > 100 ||
    p.language.length > 50
  )
    throw new Error("Search preference is too long");
  return p;
}
function distance(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180,
    dlat = (lat2 - lat1) * rad,
    dlon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
function slotTime(slot) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(slot.starts_at));
  const get = (key) => parts.find((p) => p.type === key).value;
  const h = Number(get("hour"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    period: h < 12 ? "morning" : h < 17 ? "afternoon" : "evening",
  };
}
function rankFacilities(rows, p, now = new Date()) {
  const ranked = [];
  for (const row of rows) {
    if (row.active === false) continue;
    const services = (row.services || []).filter(
      (s) =>
        s.available === true &&
        (!p.service ||
          s.service_name === p.service ||
          s.service_category === p.service),
    );
    if (p.service && !services.length) continue;
    const capabilities = (row.capabilities || [])
      .filter((c) => c.available === true)
      .map((c) => c.capability);
    if (p.capability && !capabilities.includes(p.capability)) continue;
    if (
      p.accessibility &&
      !(row.accessibility_features || []).includes(p.accessibility)
    )
      continue;
    // A missing coordinate cannot pass a numeric distance bound.
    let km = null;
    if (
      p.user_lat !== null &&
      present(row.latitude) &&
      present(row.longitude) &&
      Number.isFinite(Number(row.latitude)) &&
      Number.isFinite(Number(row.longitude)) &&
      Math.abs(Number(row.latitude)) <= 90 &&
      Math.abs(Number(row.longitude)) <= 180
    )
      km = distance(
        p.user_lat,
        p.user_lon,
        Number(row.latitude),
        Number(row.longitude),
      );
    if (
      p.user_lat !== null &&
      p.max_distance_km !== null &&
      (km === null || km > p.max_distance_km)
    )
      continue;
    const components = [];
    function add(key, label, status, weight, value, note) {
      components.push({
        key,
        label,
        status,
        weight,
        points: Math.round(value * weight * 10) / 10,
        note,
      });
    }
    if (
      p.user_lat !== null ||
      p.max_distance_km !== null ||
      p.transport_difficulty
    ) {
      const limit = p.max_distance_km || 50;
      add(
        "distance",
        "Travel distance",
        km === null ? "unknown" : "matched",
        p.transport_difficulty ? 45 : 30,
        km === null ? 0 : Math.max(0, 1 - km / limit),
        km === null
          ? "Distance unknown; allow device location to compare travel."
          : `${km.toFixed(1)} km straight-line distance; road distance and travel time may differ.${p.transport_difficulty ? " Shorter travel is prioritised because you selected transport difficulty." : ""}`,
      );
    }
    if (p.language) {
      const langs = row.languages;
      const known = Array.isArray(langs) && langs.length > 0;
      const match =
        known && langs.map((l) => String(l).toLowerCase()).includes(p.language);
      add(
        "language",
        "Preferred language",
        match ? "matched" : known ? "unmet" : "unknown",
        20,
        match ? 1 : 0,
        match
          ? `${p.language} is listed by this facility; confirm your clinician's language.`
          : known
            ? `${p.language} is not listed.`
            : "Languages have not been reported.",
      );
    }
    const future = (row.slots || []).filter(
      (s) =>
        (s.doctor_id == null || s.clinician_eligible === true) &&
        s.available_places > 0 &&
        s.source &&
        Date.parse(s.starts_at) > now.getTime() &&
        services.some((x) => Number(x.id) === Number(s.facility_service_id)),
    );
    const matching = future.filter((s) => {
      const t = slotTime(s);
      return (
        (!p.preferred_date || t.date === p.preferred_date) &&
        (!p.preferred_time || t.period === p.preferred_time)
      );
    });
    const dated = p.preferred_date || p.preferred_time;
    const hasData = (row.slots || []).some(
      (s) =>
        services.some((x) => Number(x.id) === Number(s.facility_service_id)) &&
        Date.parse(s.starts_at) > now.getTime(),
    );
    add(
      "availability",
      dated ? "Preferred appointment timing" : "Reported availability",
      matching.length ? "matched" : hasData ? "unmet" : "unknown",
      25,
      matching.length ? 1 : 0,
      matching.length
        ? `${matching.length} reported slot${matching.length === 1 ? "" : "s"} ${dated ? "match your timing" : "available"}. Availability is not a reservation; confirm with the facility.`
        : hasData
          ? "No reported available slot matches this search."
          : "Appointment availability unknown; opening hours are not confirmed appointment slots.",
    );
    if (p.budget_min !== null || p.budget_max !== null) {
      const low = p.budget_min ?? 0,
        high = p.budget_max ?? Infinity;
      const priced = services.filter(
        (s) =>
          present(s.fee_min_inr) &&
          present(s.fee_max_inr) &&
          s.fee_source &&
          s.fee_updated_at,
      );
      const within = priced.find(
        (s) => Number(s.fee_min_inr) >= low && Number(s.fee_max_inr) <= high,
      );
      const overlap = priced.find(
        (s) => Number(s.fee_max_inr) >= low && Number(s.fee_min_inr) <= high,
      );
      const best = within || overlap;
      add(
        "cost",
        "Stated cost range",
        within
          ? "matched"
          : overlap
            ? "partial"
            : priced.length
              ? "unmet"
              : "unknown",
        25,
        within ? 1 : overlap ? 0.5 : 0,
        best
          ? `Reported service fee ₹${Number(best.fee_min_inr).toLocaleString("en-IN")}–₹${Number(best.fee_max_inr).toLocaleString("en-IN")}. Source: ${best.fee_source}; updated ${String(best.fee_updated_at).slice(0, 10)}. ${within ? "Within your stated range." : "Only part of the fee range overlaps your budget."} Extra charges may apply; confirm total cost.`
          : priced.length
            ? "Reported service fee is outside your stated range."
            : "Cost unknown; no affordability assumption is made.",
      );
    }
    if (
      p.strict_preferences &&
      components.some((c) => ["unmet", "unknown", "partial"].includes(c.status))
    )
      continue;
    const max = components.reduce((sum, c) => sum + c.weight, 0),
      points = components.reduce((sum, c) => sum + c.points, 0);
    ranked.push({
      ...row,
      distance_km: km === null ? null : Math.round(km * 10) / 10,
      matching: {
        version: VERSION,
        score: p.service ? Math.round((points / max) * 100) : null,
        components,
        service_match: !!p.service,
        capability_match: p.capability ? true : null,
        eligible_service: p.service || null,
        required_capability: p.capability || null,
        matching_slots: matching.slice(0, 3),
        summary: p.service
          ? "Required service and selected capability checks passed."
          : "Directory browsing: select a care need for preference matching.",
        unknown_count: components.filter((c) => c.status === "unknown").length,
      },
    });
  }
  return ranked.sort(
    (a, b) =>
      (b.matching.score ?? 0) - (a.matching.score ?? 0) ||
      (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity) ||
      String(a.name).localeCompare(String(b.name)),
  );
}
module.exports = { parsePreferences, rankFacilities, distance, VERSION };
