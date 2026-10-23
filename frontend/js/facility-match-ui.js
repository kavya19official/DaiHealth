/* Shared patient preference controls and matching explanations. No location-based inference. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const keys = {
    language: "language",
    max_distance_km: "maxDistance",
    budget_min: "budgetMin",
    budget_max: "budgetMax",
    preferred_date: "preferredDate",
    preferred_time: "preferredTime",
    transport_difficulty: "transportDifficulty",
    strict_preferences: "strictPreferences",
  };
  const escape = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  function read() {
    const result = {};
    for (const [key, id] of Object.entries(keys)) {
      const el = $(id);
      if (!el) continue;
      const value = el.type === "checkbox" ? String(el.checked) : el.value;
      if (value !== "") result[key] = value;
    }
    return result;
  }
  function apply(values) {
    for (const [key, id] of Object.entries(keys)) {
      const el = $(id);
      if (!el) continue;
      if (el.type === "checkbox")
        el.checked = values[key] === true || values[key] === "true";
      else el.value = values[key] ?? "";
    }
  }
  async function preferences(method, body) {
    const base = (window.DaiAPI && window.DaiAPI.API_BASE) || "/api";
    const r = await fetch(base + "/me/preferences", {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "Could not update preferences");
    return d;
  }
  function announce(text) {
    $("matchingStatus").textContent = text;
  }
  async function init() {
    if (!$("saveCarePreferences")) return;
    $("saveCarePreferences").addEventListener("click", async () => {
      try {
        await preferences("PATCH", { preferences: { care_access: read() } });
        announce(
          "Your stated access preferences are saved to your account. Location is not saved with these preferences.",
        );
      } catch (e) {
        announce(e.message);
      }
    });
    $("resetCarePreferences").addEventListener("click", async () => {
      apply({ max_distance_km: 50 });
      try {
        await preferences("PATCH", { preferences: { care_access: read() } });
        announce(
          "Access preferences cleared. Your selected service and required capability are unchanged. Search again to update results.",
        );
      } catch (e) {
        announce(e.message);
      }
    });
    for (const id of Object.values(keys))
      $(id)?.addEventListener("change", () =>
        announce(
          "Preferences changed. Select “Find suitable care” to update the ranking.",
        ),
      );
    try {
      const d = await preferences("GET");
      if (d.preferences?.care_access) apply(d.preferences.care_access);
    } catch (e) {
      announce(
        "You can search without saving preferences. Sign in to remember them.",
      );
    }
  }
  function explain(f) {
    const m = f.matching;
    if (!m || m.score === null) return "";
    const rows = m.components
      .map(
        (c) =>
          `<li class="match-reason match-${escape(c.status)}"><span class="match-icon" aria-hidden="true">${c.status === "matched" ? "✓" : c.status === "unknown" ? "?" : "–"}</span><div><strong>${escape(c.label)}</strong><span>${escape(c.note)}</span></div></li>`,
      )
      .join("");
    const safety = `${m.eligible_service.replaceAll("_", " ")} is listed as available${m.required_capability ? "; " + m.required_capability.replaceAll("_", " ") + " capability is listed" : ""}.`;
    const slots = (m.matching_slots || [])
      .map(
        (s) =>
          `<li>${escape(new Date(s.starts_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }))} IST${s.doctor_name ? " · " + escape(s.doctor_name) : ""} · ${escape(s.source)}</li>`,
      )
      .join("");
    return `<section class="matching-explanation"><div class="matching-heading"><div><span class="matching-eyebrow">BASED ON YOUR PREFERENCES</span><h4>Why this facility appears</h4></div><div class="match-score"><strong>${m.score}<small>/100</small></strong><span>preference match</span></div></div><p class="matching-safety"><span aria-hidden="true">✓</span> Required directory checks passed: ${escape(safety)}</p><ul class="match-reasons">${rows}</ul>${slots ? '<details class="matching-slot-details"><summary>Reported matching slots</summary><ul>' + slots + "</ul></details>" : ""}<details class="matching-method"><summary>How the score is calculated</summary><p>Only facilities passing your required service, capability and accessibility checks are ranked. Your stated preferences earn points; unknown information earns zero. This is not a clinical safety, affordability or hospital-quality score.</p><ul>${m.components.map((c) => `<li>${escape(c.label)}: ${c.points} / ${c.weight} points</li>`).join("")}</ul><p>Score = earned points ÷ possible points × 100. Transport difficulty increases the travel-distance weight. Availability is reported, not reserved.</p></details></section>`;
  }
  window.FacilityMatchUI = { read, explain, announce };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
