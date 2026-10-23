"use strict";
// Explicit local-only fixtures. Insert once; never overwrite a teammate's directory edits.
async function seedMatchingDemo(client, env = process.env) {
  if (env.DAI_LOCAL !== "true") return;
  const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const fixtures = [
    [
      "SEVA",
      "SYNTHETIC Seva Mother & Child Centre",
      28.62,
      77.211,
      ["hindi", "english"],
      600,
      800,
      "afternoon",
      true,
      "obstetrics",
    ],
    [
      "ASHA",
      "SYNTHETIC Asha Maternity Hospital",
      28.65,
      77.235,
      ["english"],
      1500,
      1800,
      "morning",
      true,
      "obstetrics",
    ],
    [
      "DISHA",
      "SYNTHETIC Nayi Disha Women’s Clinic",
      28.7,
      77.265,
      ["hindi", "english"],
      200,
      400,
      "afternoon",
      true,
      "obstetrics",
    ],
    [
      "SAKHI",
      "SYNTHETIC Sakhi Community Clinic",
      28.629,
      77.23,
      ["hindi"],
      null,
      null,
      null,
      true,
      "obstetrics",
    ],
    [
      "GENERAL",
      "SYNTHETIC Nearby General Centre",
      28.614,
      77.209,
      ["hindi"],
      100,
      200,
      "afternoon",
      false,
      "obstetrics",
    ],
    [
      "VACCINE",
      "SYNTHETIC Nearby Vaccination Centre",
      28.615,
      77.208,
      ["hindi"],
      0,
      0,
      "afternoon",
      false,
      "vaccination",
    ],
  ];
  await client.query("BEGIN");
  try {
    for (const [
      code,
      name,
      lat,
      lng,
      languages,
      low,
      high,
      time,
      highrisk,
      category,
    ] of fixtures) {
      const inserted = await client.query(
        `INSERT INTO facilities(facility_code,name,facility_type,address,city,district,state,pincode,latitude,longitude,phone,languages,accessibility_features,verification_source,notes,active)
    VALUES($1,$2,'clinic','Fictional demonstration address; not a real provider','New Delhi','New Delhi','Delhi','110001',$3,$4,NULL,$5::jsonb,'["wheelchair"]'::jsonb,'synthetic_fixture','Synthetic matching demonstration only; not a real facility',TRUE)
    ON CONFLICT(facility_code) DO NOTHING RETURNING id`,
        ["DAI-ACCESS-DEMO-" + code, name, lat, lng, JSON.stringify(languages)],
      );
      if (!inserted.rows.length) continue;
      const id = inserted.rows[0].id;
      const service = (
        await client.query(
          `INSERT INTO facility_services(facility_id,service_name,service_category,available,fee_min_inr,fee_max_inr,fee_source,fee_updated_at) VALUES($1,$2,$3,TRUE,$4,$5,$6,$7) RETURNING id`,
          [
            id,
            category === "obstetrics"
              ? "Antenatal consultation"
              : "Child vaccination",
            category,
            low,
            high,
            low === null ? null : "Synthetic demo fee",
            low === null ? null : new Date().toISOString(),
          ],
        )
      ).rows[0].id;
      if (highrisk)
        await client.query(
          "INSERT INTO facility_capabilities(facility_id,capability,available) VALUES($1,'high_risk_pregnancy',TRUE)",
          [id],
        );
      if (time)
        await client.query(
          `INSERT INTO facility_service_slots(facility_service_id,starts_at,ends_at,available_places,source) VALUES($1,$2,$3,4,'Synthetic demo schedule')`,
          [
            service,
            day + (time === "morning" ? "T10:00:00+05:30" : "T14:00:00+05:30"),
            day + (time === "morning" ? "T11:00:00+05:30" : "T15:00:00+05:30"),
          ],
        );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
module.exports = { seedMatchingDemo };
