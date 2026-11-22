"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./care-gap-map.module.css";

type Row = Record<string, any>;

const metrics = [
  ["care_gap_rate", "Any recorded care gap"],
  ["missed_anc_rate", "Missed antenatal visits"],
  ["overdue_vaccine_rate", "Overdue child vaccines"],
  ["long_referral_rate", "Long referral transport"],
] as const;

function heatColor(value: number) {
  if (value >= 75) return "#cc425a";
  if (value >= 50) return "#ef7f57";
  if (value >= 25) return "#e7b63f";
  return "#43aa83";
}

function label(value: unknown) {
  return typeof value === "number" ? `${value.toFixed(1)}%` : "Not recorded";
}

const districtCentres: Record<string, [number, number]> = {
  "New Delhi": [28.6139, 77.209],
  Delhi: [28.6139, 77.209],
  Lucknow: [26.8467, 80.9462],
  Patna: [25.5941, 85.1376],
  Pune: [18.5204, 73.8567],
  Chennai: [13.0827, 80.2707],
  Jaipur: [26.9124, 75.7873],
};

function InteractiveMap({
  areas,
  district,
  metric,
  selectedArea,
  onSelect,
}: {
  areas: Row[];
  district: string;
  metric: (typeof metrics)[number][0];
  selectedArea: string;
  onSelect: (area: string) => void;
}) {
  const node = useRef<HTMLDivElement | null>(null);
  const map = useRef<any>(null);
  const layer = useRef<any>(null);
  const points = useMemo(
    () => areas.filter((row) => row.latitude != null && row.longitude != null),
    [areas],
  );

  useEffect(() => {
    let cancelled = false;
    async function draw() {
      const L = (await import("leaflet")).default;
      if (cancelled || !node.current) return;
      if (!map.current) {
        map.current = L.map(node.current, {
          zoomControl: false,
          attributionControl: true,
          minZoom: 5,
          maxZoom: 17,
        });
        L.control.zoom({ position: "bottomright" }).addTo(map.current);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap contributors",
          maxZoom: 19,
        }).addTo(map.current);
        layer.current = L.layerGroup().addTo(map.current);
      }

      const activeLayer = layer.current;
      activeLayer.clearLayers();
      if (points.length) {
        const bounds = L.latLngBounds([]);
        points.forEach((row) => {
          const latLng: [number, number] = [Number(row.latitude), Number(row.longitude)];
          const value = Number(row[metric] || 0);
          const selected = selectedArea === row.area;
          const color = heatColor(value);
          const coverage = L.circle(latLng, {
            radius: 650 + Math.min(Number(row.population || 10), 50) * 22,
            color: selected ? "#5a20ca" : color,
            fillColor: color,
            fillOpacity: selected ? 0.48 : 0.32,
            opacity: 0.95,
            weight: selected ? 5 : 2,
          }).addTo(activeLayer);
          coverage.bindTooltip(
            `<strong>PIN ${row.area}</strong><span>${label(row[metric])} · ${metrics.find(([key]) => key === metric)?.[1]}</span>`,
            { direction: "top", offset: [0, -10], className: styles.zoneTooltip },
          );
          coverage.bindPopup(
            `<div class="${styles.mapPopup}"><small>SYNTHETIC OUTREACH ZONE</small><strong>PIN ${row.area}</strong><span>${label(row[metric])} recorded rate</span><span>${row.people_band} registered people</span><b>Select zone for details</b></div>`,
          );
          coverage.on("click", () => onSelect(selected ? "" : row.area));
          coverage.on("mouseover", () => coverage.setStyle({ fillOpacity: 0.52, weight: selected ? 5 : 4 }));
          coverage.on("mouseout", () => coverage.setStyle({ fillOpacity: selected ? 0.48 : 0.32, weight: selected ? 5 : 2 }));

          L.circleMarker(latLng, {
            radius: selected ? 9 : 6,
            color: "#fff",
            fillColor: selected ? "#5a20ca" : color,
            fillOpacity: 1,
            weight: 3,
          }).addTo(activeLayer);
          bounds.extend(latLng);
        });
        map.current.fitBounds(bounds.pad(0.7), { maxZoom: 13, animate: true });
      } else {
        map.current.setView(districtCentres[district] || districtCentres["New Delhi"], 11, { animate: true });
      }
      window.setTimeout(() => map.current?.invalidateSize(), 50);
    }
    draw();
    return () => {
      cancelled = true;
    };
  }, [district, metric, onSelect, points, selectedArea]);

  useEffect(() => () => {
    map.current?.remove();
    map.current = null;
  }, []);

  return <div className={styles.mapStage}>
    <div ref={node} className={styles.mapCanvas} aria-label={`${district || "District"} interactive care gap map`} />
    <div className={styles.mapBadge}><span className={styles.liveDot} /> Interactive street map</div>
    <div className={styles.mapHint}>{points.length ? "Select a coloured area to inspect its recorded care gaps" : "No privacy-safe zone is available for this facility yet"}</div>
  </div>;
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
  const worst = areas.reduce<Row | null>((current, row) => !current || Number(row[metric] || 0) > Number(current[metric] || 0) ? row : current, null);
  const selectArea = (area: string) => setFilters({...filters, area});

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
        <InteractiveMap areas={areas} district={data.district} metric={metric} selectedArea={filters.area || ""} onSelect={selectArea} />
        {!areas.length && <div className={styles.emptyCallout}><strong>The map is ready, but this facility has no displayable zone.</strong><span>Use the Facility context menu above to choose a synthetic district facility with at least {data.minimum_cell_size} registered people in one PIN-code zone. Small groups stay hidden.</span></div>}
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
