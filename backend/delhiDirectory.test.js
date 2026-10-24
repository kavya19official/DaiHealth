"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  express = require("express");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { createLocalPool } = require("./localPool");
const { migrations, directories } = require("../scripts/seed-local.cjs");
const {
  resolveLocation,
  nearestLocality,
  haversineKm,
} = require("./delhiGazetteer");

test("gazetteer resolves PIN, locality and city; refuses to guess outside Delhi", () => {
  const pin = resolveLocation({ pincode: "110017" });
  assert.equal(pin.ok, true);
  assert.equal(pin.precision, "pincode");
  const loc = resolveLocation({ city: "Delhi", locality: "Saket" });
  assert.equal(loc.ok, true);
  assert.equal(loc.precision, "locality");
  assert.equal(resolveLocation({ city: "New Delhi" }).precision, "city");
  // A real Delhi PIN we do not list falls back to the city centre, labelled as such.
  const unknown = resolveLocation({ pincode: "110099" });
  assert.equal(unknown.ok, true);
  assert.equal(unknown.precision, "city");
  assert.equal(resolveLocation({ pincode: "40001" }).reason, "invalid_pincode");
  assert.equal(resolveLocation({ pincode: "400001" }).reason, "outside_coverage");
  assert.equal(resolveLocation({ city: "Mumbai" }).reason, "outside_coverage");
  assert.equal(resolveLocation({}).reason, "empty");
  assert.equal(nearestLocality(19.07, 72.87), null);
  assert.match(nearestLocality(28.5282, 77.2121).name, /Malviya Nagar/);
  assert.ok(haversineKm(28.6, 77.2, 28.6, 77.2) < 0.001);
});

test("Delhi directory loads, stays unverified, search works from city/PIN without device location", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dai-delhi-"));
  const pool = createLocalPool(dir);
  let server;
  try {
    for (const name of [...migrations, ...directories])
      await pool.query(await fs.readFile(path.join(__dirname, "db", name), "utf8"));
    // Idempotent.
    await pool.query(await fs.readFile(path.join(__dirname, "db", "delhi_directory.sql"), "utf8"));
    const counts = (await pool.query(
      `SELECT count(*)::int n, count(verified_at)::int verified, count(phone)::int phones,
              count(*) FILTER (WHERE facility_type='ivf_centre')::int ivf,
              count(*) FILTER (WHERE facility_type='nursing_home')::int homes
         FROM facilities WHERE facility_code LIKE 'DEL-%'`)).rows[0];
    assert.ok(counts.n >= 60, "expected a substantial Delhi directory");
    assert.equal(counts.verified, 0, "nothing in the compiled directory may claim verification");
    assert.ok(counts.ivf >= 10);
    assert.ok(counts.homes >= 1);
    assert.ok(counts.phones <= 3, "phone numbers must not be invented");

    await pool.query("INSERT INTO users(email,password_hash,role) VALUES('m@dai-synthetic.invalid','x','mother')");
    const me = (await pool.query("SELECT id FROM users WHERE email='m@dai-synthetic.invalid'")).rows[0].id;
    await pool.query("INSERT INTO users(email,password_hash,role) VALUES('d@dai-synthetic.invalid','x','doctor')");
    const doc = (await pool.query("SELECT id FROM users WHERE email='d@dai-synthetic.invalid'")).rows[0].id;
    await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number) VALUES($1,'Test Doctor','Obstetrics','TEST-1')", [doc]);
    const maxSaket = (await pool.query("SELECT id FROM facilities WHERE facility_code='DEL-MAXSKT'")).rows[0].id;
    await pool.query("INSERT INTO doctor_facilities(doctor_id,facility_id,role,specialization) VALUES($1,$2,'consultant','Obstetrics')", [doc, maxSaket]);

    const app = express();
    app.use(express.json());
    const auth = (req, res, next) => { req.user = { id: me, role: "mother" }; next(); };
    require("./facilityDiscovery")(app, { pool, authenticateToken: auth, authorizeRole: () => auth });
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = "http://127.0.0.1:" + server.address().port;
    const get = async (u) => { const r = await fetch(base + u); return { status: r.status, body: await r.json() }; };

    // 1. Locality only: coordinates are derived, distances appear, nearest first.
    let r = await get("/api/facilities/search?city=Delhi&locality=Saket&service=obstetrics");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.location.precision, "locality");
    assert.ok(r.body.facilities.length >= 3);
    assert.ok(r.body.facilities.every((f) => f.distance_km !== null && f.distance_km <= 25));
    assert.ok(r.body.facilities.every((f) => f.contact && "advice" in f.contact));
    assert.match(JSON.stringify(r.body.facilities.slice(0, 5).map((f) => f.name)), /Max Super Speciality Hospital, Saket/);

    // 2. PIN code; "New Delhi" vs "Delhi" no longer matters.
    r = await get("/api/facilities/search?city=New%20Delhi&pincode=110085&service=obstetrics&facility_type=hospital");
    assert.equal(r.body.location.precision, "pincode");
    assert.ok(r.body.facilities.length >= 3);

    // 3. IVF / fertility, type filter.
    r = await get("/api/facilities/search?city=Delhi&pincode=110024&service=fertility&facility_type=ivf_centre");
    assert.ok(r.body.facilities.length >= 3);
    assert.ok(r.body.facilities.every((f) => f.facility_type === "ivf_centre"));

    // 4. Unsupported city: no fake results, a clear message.
    r = await get("/api/facilities/search?city=Mumbai&service=obstetrics");
    assert.equal(r.status, 200);
    assert.equal(r.body.facilities.length, 0);
    assert.match(r.body.warnings.join(" "), /Delhi only/);

    // 5. Alternatives: a tiny radius around Narela finds nothing, nearest suitable ones are offered with a route.
    r = await get("/api/facilities/search?locality=Narela&service=nicu&capability=high_risk_pregnancy&max_distance_km=3");
    assert.equal(r.body.total, 0);
    assert.ok(r.body.alternatives && r.body.alternatives.facilities.length > 0);
    assert.ok(r.body.alternatives.facilities[0].distance_km > 3);
    assert.ok(r.body.alternatives.facilities[0].contact.directions_url);
    const ds = r.body.alternatives.facilities.map((f) => f.distance_km);
    assert.deepEqual(ds, [...ds].sort((a, b) => a - b));

    // 6. Device coordinates take priority over typed text.
    r = await get("/api/facilities/search?service=obstetrics&user_lat=28.5282&user_lon=77.2121");
    assert.equal(r.body.location.precision, "device");

    // 7. Nearby doctors: only registered doctors; facilities without doctors returned separately.
    r = await get("/api/facilities/doctors/nearby?locality=Saket&specialty=obstetrics");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.doctors.length, 1);
    assert.equal(r.body.doctors[0].full_name, "Test Doctor");
    assert.equal(r.body.doctors[0].qualification_verified, false);
    assert.ok(r.body.facilities_without_doctors.length > 0);
    assert.ok(r.body.facilities_without_doctors.every((f) => f.id !== maxSaket));
    r = await get("/api/facilities/doctors/nearby?locality=Narela&specialty=obstetrics&max_distance_km=3");
    assert.equal(r.body.doctors.length, 0);
    assert.match(r.body.warnings.join(" "), /No clinician registered/);
    assert.equal((await get("/api/facilities/doctors/nearby?locality=Saket&max_distance_km=0")).status, 400);

    // 8. Location save/get: manual PIN gets coordinates, bad PIN rejected, device coords snap to a locality.
    const post = (b) => fetch(base + "/api/patient/location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    let s = await post({ city: "Delhi", pincode: "110017" });
    assert.equal(s.status, 201);
    let saved = (await s.json()).location;
    assert.ok(Number(saved.latitude) > 28 && saved.location_source === "manual");
    assert.equal((await post({ city: "Delhi", pincode: "11" })).status, 400);
    assert.equal((await post({ city: "Mumbai" })).status, 400);
    s = await post({ latitude: 28.5282, longitude: 77.2121, location_source: "device" });
    assert.equal(s.status, 201);
    saved = (await s.json()).location;
    assert.equal(saved.location_source, "device");
    assert.equal(saved.city, "Delhi");
    assert.equal((await get("/api/patient/location")).body.location.id, saved.id);
    assert.ok((await get("/api/patient/location/resolve?locality=rohi")).body.suggestions.length > 0);

    // 9. Appointment + detail routes still reachable (not shadowed).
    assert.equal((await get("/api/facilities/appointments")).status, 200);
    assert.equal((await get("/api/facilities/" + maxSaket)).status, 200);
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await pool.end();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
