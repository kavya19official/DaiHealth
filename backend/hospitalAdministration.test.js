"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
test("synthetic hospital bridge reads linked units and guards bed writes", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dai-admin-"));
  const db = path.join(dir, "hospital.db");
  fs.copyFileSync(path.join(__dirname, "data", "dai-hospital.db"), db);
  const app = express();
  app.use(express.json());
  const module = require("./hospitalAdministration")(app, { dbPath: db });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.close();
    module.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api/hospital-admin`;
  async function req(route, method = "GET", body, role = "admin") {
    const response = await fetch(base + route, {
      method,
      headers: { "Content-Type": "application/json", "x-hospital-role": role },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  }
  const catalog = await req("/catalog");
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.hospitals.length, 12);
  const hid = catalog.body.hospitals[0].hospital_id;
  const units = await req("/" + hid + "/units");
  assert.equal(
    units.body.units.filter((u) => u.department === "obg" && u.code !== "FP")
      .length,
    6,
  );
  const listing = await req("/" + hid + "/patients");
  const mother = listing.body.mothers?.[0] || listing.body.patients?.[0];
  assert.ok(mother);
  const detail = await req("/" + hid + "/patients/" + mother.mother_id);
  assert.equal(
    detail.body.assignment.assigned_doctor_id,
    detail.body.mother.assigned_obgyn_id,
  );
  const available = (await req("/" + hid + "/beds?status=available")).body
    .beds[0];
  assert.ok(available);
  const mutation = {
    status: "maintenance",
    expected_status: "available",
    reason: "Synthetic bridge acceptance check",
  };
  assert.equal(
    (
      await req(
        "/" + hid + "/beds/" + available.bed_id,
        "PATCH",
        mutation,
        "doctor",
      )
    ).status,
    403,
  );
  assert.equal(
    (await req("/" + hid + "/beds/" + available.bed_id, "PATCH", mutation))
      .status,
    200,
  );
  assert.equal(
    (await req("/" + hid + "/beds/" + available.bed_id, "PATCH", mutation))
      .status,
    409,
  );
  const history = await req(
    "/" + hid + "/beds/" + available.bed_id + "/history",
  );
  assert.ok(history.body.history.some((r) => r.reason === mutation.reason));
  const occupied = (await req("/" + hid + "/beds?status=occupied")).body
    .beds[0];
  assert.equal(
    (
      await req("/" + hid + "/beds/" + occupied.bed_id, "PATCH", {
        ...mutation,
        expected_status: "occupied",
      })
    ).status,
    409,
  );
});
