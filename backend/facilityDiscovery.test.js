"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  express = require("express");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { createLocalPool } = require("./localPool");
const { migrations } = require("../scripts/seed-local.cjs");

test("real SQL search, safe ranking, shared preferences, limits and repeatable local demo seed", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dai-matching-"));
  const pool = createLocalPool(dir);
  let server;
  try {
    for (const name of migrations)
      await pool.query(
        await fs.readFile(path.join(__dirname, "db", name), "utf8"),
      );
    const client = await pool.connect();
    await require("../scripts/seed-matching-demo.cjs").seedMatchingDemo(
      client,
      { DAI_LOCAL: "true" },
    );
    await require("../scripts/seed-matching-demo.cjs").seedMatchingDemo(
      client,
      { DAI_LOCAL: "true" },
    );
    client.release();
    assert.equal(
      Number(
        (await pool.query("SELECT count(*) FROM facilities")).rows[0].count,
      ),
      6,
    );
    await pool.query(
      "INSERT INTO users(email,password_hash,role) VALUES('test@dai-synthetic.invalid','not-used','mother')",
    );
    const app = express();
    app.use(express.json());
    const auth = (req, res, next) => {
      req.user = { id: 1, role: "mother" };
      next();
    };
    require("./facilityDiscovery")(app, {
      pool,
      authenticateToken: auth,
      authorizeRole: () => auth,
    });
    require("./patientPreferences")(app, { pool, authenticateToken: auth });
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = "http://127.0.0.1:" + server.address().port;
    const p = new URLSearchParams({
      city: "New Delhi",
      service: "obstetrics",
      capability: "high_risk_pregnancy",
      language: "hindi",
      budget_max: "1000",
      preferred_time: "afternoon",
      user_lat: "28.6139",
      user_lon: "77.209",
      max_distance_km: "50",
      accessibility: "wheelchair",
      limit: "1",
    });
    const r = await fetch(base + "/api/facilities/search?" + p);
    const data = await r.json();
    assert.equal(r.status, 200, JSON.stringify(data));
    assert.equal(data.total, 4);
    assert.equal(data.facilities.length, 1);
    assert.ok(data.facilities[0].freshness);
    const reportUrl = base + '/api/facilities/' + data.facilities[0].id + '/contact-report';
    const contactBody = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome: 'reached' }) };
    assert.equal((await fetch(reportUrl, contactBody)).status, 201);
    assert.equal((await fetch(reportUrl, contactBody)).status, 429);
    assert.equal(Number((await pool.query('SELECT count(*) FROM facility_contact_reports')).rows[0].count), 1);

    assert.match(data.facilities[0].name, /Seva/);
    assert.equal(
      data.facilities[0].matching.components.find((c) => c.key === "cost")
        .status,
      "matched",
    );
    assert.equal(
      (await fetch(base + "/api/facilities/search?max_distance_km=-1")).status,
      400,
    );
    const prefs = await fetch(base + "/api/me/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preferences: {
          care_access: {
            budget_max: 800,
            transport_difficulty: true,
            language: "hindi",
            user_lat: 28.6,
          },
        },
      }),
    });
    assert.equal(prefs.status, 200);
    const saved = (await (await fetch(base + "/api/me/preferences")).json())
      .preferences.care_access;
    assert.equal(saved.budget_max, 800);
    assert.equal(saved.transport_difficulty, true);
    assert.equal(saved.user_lat, undefined);
    assert.equal(
      (
        await fetch(base + "/api/me/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            preferences: { care_access: { budget_min: 1000, budget_max: 100 } },
          }),
        })
      ).status,
      400,
    );
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await pool.end();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
