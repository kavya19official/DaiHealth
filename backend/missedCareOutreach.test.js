"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  express = require("express");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { createLocalPool } = require("./localPool");
const { migrations } = require("../scripts/seed-local.cjs");

test("outreach queue: mother sees her own items, doctor sees only active patients, writes are scoped", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dai-outreach-"));
  const pool = createLocalPool(dir);
  let server;
  try {
    for (const name of migrations) await pool.query(await fs.readFile(path.join(__dirname, "db", name), "utf8"));
    const user = async (email, role) => (await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,'x',$2) RETURNING id", [email, role])).rows[0].id;
    const m1 = await user("m1@dai-synthetic.invalid", "mother");
    const m2 = await user("m2@dai-synthetic.invalid", "mother");
    const d1 = await user("d1@dai-synthetic.invalid", "doctor");
    const d2 = await user("d2@dai-synthetic.invalid", "doctor");
    await pool.query("INSERT INTO mother_profiles(user_id,full_name) VALUES($1,'SYNTHETIC One'),($2,'SYNTHETIC Two')", [m1, m2]);
    for (const [d, n] of [[d1, "One"], [d2, "Two"]]) await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number) VALUES($1,$2,'Obstetrics',$3)", [d, "Dr " + n, "T-" + n]);
    const old = (days) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    await pool.query("INSERT INTO care_milestones(mother_id,stage,category,title,due_date) VALUES($1,'T2','pregnancy','Glucose test',$2),($1,'T2','pregnancy','Anomaly scan',$3),($1,'T3','pregnancy','Future visit',CURRENT_DATE + 30),($4,'T2','pregnancy','Other mother test',$2)", [m1, old(40), old(3), m2]);
    await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,reason,status) VALUES($1,$2,CURRENT_DATE+5,'Review','confirmed'),($3,$4,CURRENT_DATE+5,'Review','confirmed')", [m1, d1, m2, d2]);

    let who = { id: m1, role: "mother" };
    const auth = (req, res, next) => { req.user = who; next(); };
    const role = (roles) => (req, res, next) => (roles.includes(req.user.role) ? next() : res.status(403).json({ error: "Insufficient permissions" }));
    const app = express();
    app.use(express.json());
    require("./missedCareOutreach")(app, { pool, authenticateToken: auth, authorizeRole: role });
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = "http://127.0.0.1:" + server.address().port + "/api";
    const call = async (method, url, body) => { const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };

    // Mother: items are created on read, scored, and only her own.
    let r = await call("GET", "/patient/missed-care");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.missed_care_items.map((i) => i.title), ["Glucose test", "Anomaly scan"]);
    assert.equal(r.body.missed_care_items[0].urgency_level, "critical");
    assert.equal(r.body.missed_care_items[0].overdue_days, 40);
    assert.equal(r.body.missed_care_items[1].urgency_level, "low");
    const first = r.body.missed_care_items[0].id;
    assert.equal((await call("GET", "/patient/missed-care")).body.missed_care_items.length, 2, "reading twice must not duplicate");

    // Mother cannot use staff endpoints.
    assert.equal((await call("GET", "/outreach/queue")).status, 403);
    assert.equal((await call("GET", `/outreach/${first}/attempts`)).status, 403);

    // Mother records barriers: whitelist only, own item only.
    assert.equal((await call("POST", `/patient/missed-care/${first}/barriers`, { barriers: ["transport", "cost"] })).status, 200);
    assert.equal((await call("POST", `/patient/missed-care/${first}/barriers`, { barriers: ["<script>"] })).status, 400);
    who = { id: m2, role: "mother" };
    assert.equal((await call("POST", `/patient/missed-care/${first}/barriers`, { barriers: ["cost"] })).status, 404);

    // Doctor 1 sees mother 1 only, with barriers raising priority; summary counts come from the server.
    who = { id: d1, role: "doctor" };
    r = await call("GET", "/outreach/queue");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.queue.map((i) => i.title), ["Glucose test", "Anomaly scan"]);
    assert.deepEqual(r.body.summary, { critical: 1, high: 0, medium: 0, low: 1 });
    assert.deepEqual(r.body.queue[0].access_barriers, ["transport", "cost"]);
    assert.equal((await call("GET", "/outreach/queue?urgency=low")).body.queue.length, 1);

    // Doctor 2 cannot touch mother 1's items.
    who = { id: d2, role: "doctor" };
    assert.equal((await call("GET", `/outreach/${first}/attempts`)).status, 403);
    assert.equal((await call("POST", `/outreach/${first}/attempts`, { attempt_type: "call", outcome: "no_answer" })).status, 403);
    assert.equal((await call("PATCH", `/outreach/${first}/status`, { status: "resolved" })).status, 403);

    // Doctor 1 logs attempts; "reached" keeps the item open; bad input is rejected; history shows the author.
    who = { id: d1, role: "doctor" };
    assert.equal((await call("POST", `/outreach/${first}/attempts`, { attempt_type: "call" })).status, 400);
    assert.equal((await call("POST", `/outreach/${first}/attempts`, { attempt_type: "call", outcome: "reached", next_action_date: "soon" })).status, 400);
    assert.equal((await call("POST", `/outreach/${first}/attempts`, { attempt_type: "call", outcome: "reached", notes: "Will visit Monday" })).status, 201);
    r = await call("GET", `/outreach/${first}/attempts`);
    assert.equal(r.body.attempts.length, 1);
    assert.equal(r.body.attempts[0].attempted_by_name, "Dr One");
    assert.equal((await call("GET", "/outreach/queue?status=in_progress")).body.queue[0].attempt_count, 1);

    // Mother sees that the team tried, but not staff notes.
    who = { id: m1, role: "mother" };
    const mine = (await call("GET", "/patient/missed-care")).body.missed_care_items.find((i) => i.id === first);
    assert.equal(mine.attempt_count, 1);
    assert.ok(!("notes" in mine));

    // Completing the milestone closes the item on the next read.
    await pool.query("UPDATE care_milestones SET completed_at = now() WHERE mother_id = $1 AND title = 'Glucose test'", [m1]);
    assert.deepEqual((await call("GET", "/patient/missed-care")).body.missed_care_items.map((i) => i.title), ["Anomaly scan"]);

    // Revoking doctor 1 removes the mother from his queue and blocks his writes immediately.
    await pool.query("INSERT INTO patient_access_controls(mother_id,grantee_type,grantee_ref,state) VALUES($1,'doctor',$2,'revoked')", [m1, String(d1)]);
    who = { id: d1, role: "doctor" };
    assert.equal((await call("GET", "/outreach/queue")).body.queue.length, 0);
    assert.equal((await call("POST", `/outreach/${first}/attempts`, { attempt_type: "call", outcome: "no_answer" })).status, 403);
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await pool.end();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
