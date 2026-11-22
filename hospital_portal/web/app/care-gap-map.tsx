"use client";

import { CSSProperties, useMemo, useState } from "react";
import styles from "./care-gap-map.module.css";

type Row = Record<string, any>;

const metrics = [
  ["care_gap_rate", "Any recorded care gap"],
  ["missed_anc_rate", "Missed antenatal visits"],
  ["overdue_vaccine_rate", "Overdue child vaccines"],
  ["long_referral_rate", "Long referral transport"],
] as const;

function heat(value: number) {
  if (value >= 75) return styles.heat4;
  if (value >= 50) return styles.heat3;
  if (value >= 25) return styles.heat2;
  return styles.heat1;
}

function label(value: unknown) {
  return typeof value === "number" ? `${value.toFixed(1)}%` : "Not recorded";
}

export function CareGapMap({
  data,
  filters,
  setFilters,
  navigate,
}: {
  data: Row;
  filters: Row;
  setFilters: (value: Row) => void;
  navigate: (view: string) => void;
}) {
  const [metric, setMetric] = useState<(typeof metrics)[number][0]>("care_gap_rate");
  const areas: Row[] = data.areas || [];
  const selected = data.selected_area;
  const points = useMemo(() => areas.filter((row) => row.latitude != null && row.longitude != null), [areas]);
  const bounds = useMemo(() => {
    const latitudes = points.map((row) => Number(row.latitude));
    const longitudes = points.map((row) => Number(row.longitude));
    return {
      minLat: Math.min(...latitudes), maxLat: Math.max(...latitudes),
      minLng: Math.min(...longitudes), maxLng: Math.max(...longitudes),
    };
  }, [points]);
  const position = (row: Row) => {
    const width = Math.max(bounds.maxLng - bounds.minLng, 0.001);
    const height = Math.max(bounds.maxLat - bounds.minLat, 0.001);
    return {
      left: `${12 + ((Number(row.longitude) - bounds.minLng) / width) * 76}%`,
      top: `${88 - ((Number(row.latitude) - bounds.minLat) / height) * 76}%`,
    } as CSSProperties;
  };
  const worst = areas.reduce<Row | null>((current, row) => !current || Number(row[metric] || 0) > Number(current[metric] || 0) ? row : current, null);

  return <div className={styles.shell}>
    <section className={styles.hero}>
      <div>
        <span className={styles.kicker}>District programme view · synthetic records</span>
        <h2>See where follow-up is being missed.</h2>
        <p>Explore privacy-protected PIN-code outreach zones in {data.district}. Select a zone to prepare a follow-up worklist without ranking people or predicting clinical risk.</p>
      </div>
      <div className={styles.privacy}>
        <strong>Privacy rule active</strong>
        <span>Zones with fewer than {data.minimum_cell_size} registered mothers are hidden.</span>
        <small>{data.suppressed_area_count} small {data.suppressed_area_count === 1 ? "zone is" : "zones are"} withheld in this view.</small>
      </div>
    </section>

    <section className={styles.stats} aria-label="Care gap map summary">
      <article><span>Visible outreach zones</span><strong>{areas.length}</strong><small>After privacy suppression</small></article>
      <article><span>Highest recorded gap rate</span><strong>{worst ? label(worst[metric]) : "—"}</strong><small>{worst ? `PIN ${worst.area}` : "No eligible zone"}</small></article>
      <article><span>Selected district</span><strong>{data.district}</strong><small>Facility-scoped synthetic cohort</small></article>
      <article><span>Referral threshold</span><strong>{data.long_referral_threshold_minutes} min</strong><small>Shown as an operational delay, not urgency</small></article>
    </section>

    <section className={styles.workspace}>
      <div className={styles.mapCard}>
        <div className={styles.cardHead}>
          <div><span className={styles.kicker}>Recorded gap geography</span><h3>{data.district} outreach zones</h3></div>
          <label>Map measure<select value={metric} onChange={(event) => setMetric(event.target.value as typeof metric)}>{metrics.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
        </div>
        {points.length ? <div className={styles.map} role="group" aria-label={`${data.district} care gap map`}>
          <div className={styles.grid} aria-hidden />
          {points.map((row) => <button
            key={row.area}
            type="button"
            className={`${styles.zone} ${heat(Number(row[metric] || 0))} ${filters.area === row.area ? styles.selected : ""}`}
            style={position(row)}
            aria-label={`PIN ${row.area}, ${label(row[metric])}`}
            aria-pressed={filters.area === row.area}
            onClick={() => setFilters({...filters, area: filters.area === row.area ? "" : row.area})}
          ><strong>{label(row[metric])}</strong><span>{row.area}</span></button>)}
          <div className={styles.compass} aria-hidden>N</div>
        </div> : <div className={styles.empty}>No outreach zone meets the minimum group size for this facility.</div>}
        <div className={styles.legend}><span>Lower recorded gap rate</span><i className={styles.heat1}/><i className={styles.heat2}/><i className={styles.heat3}/><i className={styles.heat4}/><span>Higher recorded gap rate</span></div>
        <p className={styles.method}>{data.methodology}</p>
      </div>

      <aside className={styles.detail}>
        {selected ? <>
          <div className={styles.cardHead}><div><span className={styles.kicker}>Selected outreach zone</span><h3>PIN {selected.area}</h3></div><button className={styles.clear} onClick={() => setFilters({...filters, area: ""})}>Clear</button></div>
          <div className={styles.metricList}>
            <div><span>Registered people</span><strong>{selected.people_band}</strong></div>
            <div><span>Any recorded care gap</span><strong>{label(selected.care_gap_rate)}</strong></div>
            <div><span>Missed antenatal visits</span><strong>{label(selected.missed_anc_rate)}</strong></div>
            <div><span>Overdue child vaccines</span><strong>{label(selected.overdue_vaccine_rate)}</strong></div>
            <div><span>Long referral transport</span><strong>{label(selected.long_referral_rate)}</strong></div>
            <div><span>Median recorded referral time</span><strong>{selected.median_referral_minutes == null ? "Not recorded" : `${selected.median_referral_minutes} min`}</strong></div>
          </div>
          <h4>Suggested programme follow-up</h4>
          <ul>{(data.suggested_actions || []).map((item: string) => <li key={item}>{item}</li>)}</ul>
        </> : <div className={styles.prompt}><span className={styles.kicker}>Explore the map</span><h3>Select a visible zone.</h3><p>You’ll see its recorded follow-up measures and, if your role allows it, the matching outreach worklist.</p></div>}
      </aside>
    </section>

    {selected && <section className={styles.outreach}>
      <div className={styles.cardHead}><div><span className={styles.kicker}>Human follow-up only</span><h3>ASHA and outreach worklist preview</h3><p>Prioritized by number and age of recorded open gaps—not by clinical risk.</p></div>{data.outreach_authorized && <button onClick={() => navigate("careTasks")}>Open follow-up workspace</button>}</div>
      {!data.outreach_authorized ? <div className={styles.restricted}><strong>Patient details are hidden for this role.</strong><span>The aggregate map remains available to programme and quality teams.</span></div> : data.outreach?.length ? <div className={styles.outreachGrid}>{data.outreach.map((row: Row) => <article key={row.portal_mother_id}><div><span>{row.open_gap_count} open {row.open_gap_count === 1 ? "gap" : "gaps"}</span><strong>{row.name}</strong><small>Oldest due date: {row.oldest_due_date || "Not recorded"}</small></div><ul>{row.gap_types.map((gap: string) => <li key={gap}>{gap}</li>)}</ul></article>)}</div> : <div className={styles.empty}>No authorized patient records with open mapped gaps are available in this zone.</div>}
    </section>}
  </div>;
}
