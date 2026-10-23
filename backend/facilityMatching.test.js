"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { parsePreferences, rankFacilities } = require("./facilityMatching");
const now = new Date("2026-10-23T10:00:00Z");
const facility = (extra = {}) => ({
  id: 1,
  name: "SYNTHETIC Test",
  active: true,
  latitude: 28.614,
  longitude: 77.209,
  languages: ["hindi"],
  services: [
    {
      id: 1,
      service_category: "obstetrics",
      service_name: "ANC",
      available: true,
      fee_min_inr: 100,
      fee_max_inr: 200,
      fee_source: "Synthetic report",
      fee_updated_at: "2026-10-23",
    },
  ],
  capabilities: [{ capability: "high_risk_pregnancy", available: true }],
  slots: [
    {
      facility_service_id: 1,
      starts_at: "2026-10-26T09:00:00Z",
      available_places: 2,
      source: "Synthetic schedule",
    },
  ],
  ...extra,
});
const prefs = (extra) =>
  parsePreferences({
    service: "obstetrics",
    capability: "high_risk_pregnancy",
    ...extra,
  });
test("service/capability gates exclude the closest, cheapest unsuitable provider", () => {
  const rows = [
    facility({ id: 2, capabilities: [] }),
    facility({
      id: 3,
      services: [{ id: 2, service_category: "vaccination", available: true }],
    }),
    facility(),
  ];
  assert.deepEqual(
    rankFacilities(rows, prefs(), now).map((r) => r.id),
    [1],
  );
  assert.equal(
    rankFacilities(
      [
        facility({
          services: [
            { id: 1, service_category: "obstetrics", available: false },
          ],
        }),
      ],
      prefs(),
      now,
    ).length,
    0,
  );
});
test("a stated language changes ranking without excluding eligible alternatives", () => {
  const rows = [
    facility({ id: 1, languages: ["english"] }),
    facility({ id: 2, languages: ["hindi"] }),
  ];
  const result = rankFacilities(rows, prefs({ language: "hindi" }), now);
  assert.equal(result[0].id, 2);
  assert.equal(result.length, 2);
  assert.equal(
    result[1].matching.components.find((c) => c.key === "language").status,
    "unmet",
  );
});
test("missing prices, coordinates and schedules never become free, nearby or available", () => {
  const row = facility({
    latitude: null,
    longitude: null,
    services: [{ id: 1, service_category: "obstetrics", available: true }],
    slots: [],
  });
  const [result] = rankFacilities(
    [row],
    prefs({ budget_max: "1000", transport_difficulty: "true" }),
    now,
  );
  assert.equal(result.distance_km, null);
  assert.equal(result.matching.score, 0);
  assert.equal(result.matching.unknown_count, 3);
  assert.equal(
    rankFacilities(
      [row],
      prefs({ user_lat: "28.6", user_lon: "77.2", max_distance_km: "50" }),
      now,
    ).length,
    0,
  );
});
test("fees compare only to stated budget and keep partial overlaps explicit", () => {
  const [result] = rankFacilities(
    [facility()],
    prefs({ budget_min: "150", budget_max: "250" }),
    now,
  );
  const cost = result.matching.components.find((c) => c.key === "cost");
  assert.equal(cost.status, "partial");
  assert.equal(cost.points, 12.5);
  assert.equal(
    rankFacilities(
      [facility()],
      prefs({
        budget_min: "150",
        budget_max: "250",
        strict_preferences: "true",
      }),
      now,
    ).length,
    0,
  );
});
test("timing uses IST, ignores full/past slots and never uses opening hours as appointment evidence", () => {
  const p = prefs({
    preferred_date: "2026-10-26",
    preferred_time: "afternoon",
  });
  assert.equal(
    rankFacilities([facility()], p, now)[0].matching.components[0].status,
    "matched",
  );
  const [past] = rankFacilities(
    [
      facility({
        slots: [
          {
            facility_service_id: 1,
            starts_at: "2026-10-01T09:00:00Z",
            available_places: 5,
            source: "old",
          },
        ],
        operating_hours: { monday: "09:00-17:00" },
      }),
    ],
    p,
    now,
  );
  assert.equal(past.matching.components[0].status, "unknown");
  const [full] = rankFacilities(
    [
      facility({
        slots: [
          {
            facility_service_id: 1,
            starts_at: "2026-10-26T09:00:00Z",
            available_places: 0,
            source: "reported",
          },
        ],
      }),
    ],
    p,
    now,
  );
  assert.equal(full.matching.components[0].status, "unmet");
});
test("transport difficulty increases the explicit travel weight, not inferred demographics", () => {
  const p = { user_lat: "28.6139", user_lon: "77.209", max_distance_km: "50" };
  const normal = rankFacilities([facility()], prefs(p), now)[0];
  const difficult = rankFacilities(
    [facility()],
    prefs({ ...p, transport_difficulty: "true" }),
    now,
  )[0];
  assert.equal(
    normal.matching.components.find((c) => c.key === "distance").weight,
    30,
  );
  assert.equal(
    difficult.matching.components.find((c) => c.key === "distance").weight,
    45,
  );
  assert.equal(
    normal.matching.components.some((c) => c.key === "cost"),
    false,
  );
});
test("invalid, ambiguous and out-of-range inputs are rejected; zero coordinates are valid", () => {
  for (const p of [
    { budget_min: "200", budget_max: "100" },
    { user_lat: "NaN" },
    { user_lat: "0" },
    { user_lat: "91", user_lon: "0" },
    { preferred_date: "2026-02-30" },
    { preferred_time: "night" },
    { language: ["hindi", "english"] },
    { max_distance_km: "-1" },
  ])
    assert.throws(() => parsePreferences(p));
  assert.equal(parsePreferences({ user_lat: "0", user_lon: "0" }).user_lat, 0);
});

test('an unverified or unaffiliated named clinician does not earn availability points',()=>{
 const [result]=rankFacilities([facility({slots:[{facility_service_id:1,doctor_id:99,clinician_eligible:false,starts_at:'2026-10-26T09:00:00Z',available_places:5,source:'Synthetic schedule'}]})],prefs({preferred_time:'afternoon'}),now);
 assert.equal(result.matching.matching_slots.length,0);
 assert.notEqual(result.matching.components.find(c=>c.key==='availability').status,'matched');
});
