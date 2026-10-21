"use client";
import { useState } from "react";
type Row = Record<string, any>;
const num = (value: number, digits = 0) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits });
const day = (value: string) =>
  new Date(value + "T12:00:00").toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
const method = (value: string) =>
  value === "random_forest" ? "Random Forest" : "Seasonal baseline";
const featureLabels: Record<string, string> = {
  horizon_days: "Forecast horizon",
  target_weekday_sin: "Target weekday (sine)",
  target_weekday_cos: "Target weekday (cosine)",
  target_year_sin: "Annual seasonality (sine)",
  target_year_cos: "Annual seasonality (cosine)",
  origin_index: "Elapsed history days",
  planned_arrivals_known_in_advance: "Planned arrivals known in advance",
  delivery_latest: "Latest completed-day deliveries",
  delivery_lag_7: "Deliveries seven days earlier",
  delivery_mean_7: "Seven-day delivery average",
  delivery_mean_28: "28-day delivery average",
  delivery_std_7: "Seven-day variability",
  delivery_trend_7_vs_28: "Recent versus 28-day trend",
  nicu_mean_7: "Seven-day NICU admissions average",
};
function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((v, j) => (
                <td key={j}>{v ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function ForecastChart({
  history,
  future,
  target,
  title,
  coverage,
}: {
  coverage: number;
  history: Row[];
  future: Row[];
  target: string;
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 980,
    height = 270,
    left = 44,
    right = 22,
    top = 24,
    bottom = 34;
  const all: Row[] = [
    ...history.map((r) => ({
      date: r.date,
      value: r[target],
      lower: r[target],
      upper: r[target],
      type: "history",
    })),
    ...future.map((r) => ({ ...r, type: "forecast" })),
  ];
  const max = Math.max(1, ...all.map((r) => r.upper)) * 1.1;
  const x = (i: number) =>
    left + (i / (all.length - 1)) * (width - left - right);
  const y = (v: number) =>
    height - bottom - (v / max) * (height - top - bottom);
  const historyPath = history
    .map((r, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(r[target])}`)
    .join(" ");
  const predictionPath = [
    { value: history[history.length - 1][target] },
    ...future,
  ]
    .map(
      (r, i) =>
        `${i === 0 ? "M" : "L"} ${x(history.length - 1 + i)} ${y(r.value)}`,
    )
    .join(" ");
  const band = [
    ...future.map((r, i) => `${x(history.length + i)},${y(r.upper)}`),
    ...future.map((r, i) => `${x(history.length + i)},${y(r.lower)}`).reverse(),
  ].join(" ");
  const hovered = hover === null ? null : all[hover];
  return (
    <div className="ml-chart-wrap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={title}
        onMouseLeave={() => setHover(null)}
      >
        <title>
          {title}: synthetic history and trained forecast with an empirical
          range.
        </title>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line
              x1={left}
              x2={width - right}
              y1={y(max * t)}
              y2={y(max * t)}
              stroke="#eee7f4"
            />
            <text
              x={left - 10}
              y={y(max * t) + 4}
              textAnchor="end"
              fill="#95859f"
              fontSize="10"
            >
              {num(max * t)}
            </text>
          </g>
        ))}
        <rect
          x={x(history.length - 1)}
          y={top}
          width={width - right - x(history.length - 1)}
          height={height - top - bottom}
          fill="#f8f4fd"
        />
        <polygon points={band} fill="#d9c8ee" opacity=".7" />
        <path d={historyPath} fill="none" stroke="#a99ab9" strokeWidth="2.5" />
        <path
          d={predictionPath}
          fill="none"
          stroke="#8053b2"
          strokeWidth="3"
          strokeDasharray="5 4"
        />
        <line
          x1={x(history.length - 1)}
          x2={x(history.length - 1)}
          y1={top}
          y2={height - bottom}
          stroke="#bda3d2"
          strokeDasharray="3 4"
        />
        <text
          x={x(history.length - 1) + 8}
          y={top + 12}
          fill="#9977b5"
          fontSize="9"
        >
          Forecast starts
        </text>
        {all.map((r, i) => (
          <g key={r.date}>
            {(i % 7 === 0 || i === all.length - 1) && (
              <text
                x={x(i)}
                y={height - 10}
                textAnchor="middle"
                fill="#95859f"
                fontSize="9"
              >
                {day(r.date)}
              </text>
            )}
            <rect
              x={x(i) - (width - left - right) / (all.length - 1) / 2}
              y={top}
              width={(width - left - right) / (all.length - 1)}
              height={height - top - bottom}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            >
              <title>
                {r.date}: {num(r.value, 1)}{" "}
                {r.type === "forecast"
                  ? `(range ${num(r.lower, 1)}–${num(r.upper, 1)})`
                  : "synthetic recorded total"}
              </title>
            </rect>
          </g>
        ))}
        {hovered && hover !== null && (
          <g pointerEvents="none">
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={top}
              y2={height - bottom}
              stroke="#bea4d3"
            />
            <circle cx={x(hover)} cy={y(hovered.value)} r="4" fill="#8053b2" />
          </g>
        )}
      </svg>
      <div className="ml-chart-caption" aria-live="polite">
        {hovered ? (
          <>
            <strong>{day(hovered.date)}</strong> {num(hovered.value, 1)}{" "}
            expected{" "}
            {target === "deliveries" ? "deliveries" : "NICU admissions"}{" "}
            {hovered.type === "forecast"
              ? `· empirical range ${num(hovered.lower, 1)}–${num(hovered.upper, 1)}`
              : "· synthetic history"}
          </>
        ) : (
          <>
            Hover over the chart to inspect a day. Forecasts are expected
            counts, not individual patient predictions.
          </>
        )}
      </div>
      <div className="ml-chart-legend">
        <span>
          <i className="history" /> Synthetic history
        </span>
        <span>
          <i className="prediction" /> Selected forecast
        </span>
        <span>
          <i className="range" /> {coverage}% nominal daily empirical range
        </span>
      </div>
    </div>
  );
}
export function ForecastPanel({ report }: { report: Row }) {
  const [horizon, setHorizon] = useState(14);
  const [target, setTarget] = useState("deliveries");
  const [stockScale, setStockScale] = useState(100);
  const predictions = report.forecast.deliveries.slice(0, horizon);
  const nicu = report.forecast.nicu_admissions.slice(0, horizon);
  const total = predictions.reduce((n: number, r: Row) => n + r.value, 0);
  const peak = predictions.reduce((a: Row, b: Row) =>
    a.value > b.value ? a : b,
  );
  const evals = report.evaluation[target];
  const deliveryEval = report.evaluation.deliveries;
  const labels: Record<string, string> = {
    deliveries: "Deliveries",
    nicu_admissions: "NICU admissions",
    ...Object.fromEntries(
      report.stock_projection.map((i: Row) => [i.code, i.name]),
    ),
  };
  const attention = report.stock_projection.filter(
    (i: Row) => i.reorder_attention,
  ).length;
  function download() {
    const rows = [
      [
        "date",
        "expected_deliveries",
        "lower_daily_range",
        "upper_daily_range",
        "expected_nicu_admissions",
        "method",
        "model_version",
        "data_label",
      ],
      ...predictions.map((r: Row, i: number) => [
        r.date,
        r.value,
        r.lower,
        r.upper,
        nicu[i].value,
        r.selected_method,
        report.model_version,
        "Trained on synthetic data",
      ]),
    ];
    const csv = rows
      .map((r) =>
        r
          .map((v: any) => '"' + String(v).replaceAll('"', '""') + '"')
          .join(","),
      )
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = "dai-synthetic-forecast-" + report.as_of_date + ".csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }
  return (
    <>
      <section className="ml-intro">
        <div>
          <span className="pill">Trained on synthetic data</span>
          <h2>Prepare for demand before it arrives.</h2>
          <p>
            Real trained models on a generated operating scenario.
            Partner-hospital validation is still pending.
          </p>
        </div>
        <div className="ml-horizon">
          <span>Planning horizon</span>
          <div>
            {[7, 14].map((n) => (
              <button
                key={n}
                className={horizon === n ? "active" : ""}
                onClick={() => setHorizon(n)}
              >
                {n} days
              </button>
            ))}
          </div>
          <small>Issued after {day(report.as_of_date)} 2026</small>
        </div>
      </section>
      <div className="metrics operational-metrics">
        <section className="card metric">
          <span>Expected deliveries · {horizon} days</span>
          <strong>{num(total)}</strong>
          <small>
            {day(predictions[0].date)}–
            {day(predictions[predictions.length - 1].date)} ·{" "}
            {method(deliveryEval.selected_method)}
          </small>
        </section>
        <section className="card metric metric-blue">
          <span>Expected NICU admissions</span>
          <strong>
            {num(nicu.reduce((n: number, r: Row) => n + r.value, 0))}
          </strong>
          <small>Aggregate admissions, not concurrent cot occupancy</small>
        </section>
        <section className="card metric metric-green">
          <span>Planning peak</span>
          <strong>
            {num(peak.value, 1)}
            <small> / day</small>
          </strong>
          <small>{day(peak.date)} · review staffing and capacity</small>
        </section>
        <section className="card metric metric-rose">
          <span>Scenario stock attention</span>
          <strong>
            {attention}
            <small> items</small>
          </strong>
          <small>Predicted depletion within configured reorder window</small>
        </section>
      </div>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>
              {target === "deliveries"
                ? "Delivery load forecast"
                : "NICU admission forecast"}
            </h2>
            <p>
              28 days of synthetic history, followed by {horizon} forecast days.
              Shading shows daily empirical ranges.
            </p>
          </div>
          <div className="inner-tabs ml-inline-tabs">
            {[
              ["deliveries", "Delivery load"],
              ["nicu_admissions", "NICU demand"],
            ].map(([id, name]) => (
              <button
                key={id}
                className={target === id ? "active" : ""}
                onClick={() => setTarget(id)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
        <ForecastChart
          history={report.recent_history}
          future={report.forecast[target].slice(0, horizon)}
          target={target}
          title={labels[target]}
          coverage={report.range_nominal_coverage_percent}
        />
        <div className="ml-evidence-strip">
          <span>
            <strong>{num(evals.selected_test.mae, 2)}</strong> test MAE ·
            counts/day
          </span>
          <span>
            <strong>{num(evals.baseline_test.mae, 2)}</strong> seasonal-baseline
            MAE
          </span>
          <span>
            <strong>{num(evals.empirical_range_coverage_percent, 1)}%</strong>{" "}
            observed daily-range coverage
          </span>
          <span>
            <strong>{method(evals.selected_method)}</strong> selected on
            validation data
          </span>
        </div>
        <div className="ml-note">
          Metrics use a later synthetic test period across all 14 forecast
          horizons. They are not real-world accuracy. Daily ranges do not imply
          a joint probability that all 14 days fall inside the band.
        </div>
      </section>
      <div className="command-columns">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Why this forecast?</h2>
              <p>
                Observed inputs and model-wide importance; not causal or
                individual-patient explanations.
              </p>
            </div>
          </div>
          <div className="ml-inputs">
            {[
              [
                "Latest completed-day deliveries",
                report.explanation.inputs.delivery_latest,
              ],
              ["Seven-day average", report.explanation.inputs.delivery_mean_7],
              ["28-day average", report.explanation.inputs.delivery_mean_28],
              [
                "Next-day planned arrivals",
                report.explanation.inputs.planned_arrivals_known_in_advance,
              ],
            ].map(([title, value]) => (
              <div key={title}>
                <span>{title}</span>
                <strong>{num(Number(value), 1)}</strong>
              </div>
            ))}
          </div>
          <div className="ml-drivers">
            {report.global_feature_importance.slice(0, 5).map((r: Row) => (
              <div key={r.feature}>
                <div>
                  <span>{featureLabels[r.feature] || r.feature}</span>
                  <strong>{num(r.importance_percent, 1)}%</strong>
                </div>
                <i style={{ width: r.importance_percent + "%" }} />
              </div>
            ))}
          </div>
          <div className="ml-note">
            These importance values describe the Random Forest. A target that
            selects the seasonal baseline uses the previous four matching
            weekdays instead. {report.explanation.booking_signal}
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Forecast calendar</h2>
              <p>
                Expected counts may be fractional. No bed or theatre is
                automatically reserved.
              </p>
            </div>
            <button className="text-button" onClick={download}>
              Export CSV ↗
            </button>
          </div>
          <Table
            headers={["Date", "Deliveries", "Daily range", "NICU admissions"]}
            rows={predictions.map((r: Row, i: number) => [
              day(r.date),
              num(r.value, 1),
              num(r.lower, 1) + "–" + num(r.upper, 1),
              num(nicu[i].value, 1),
            ])}
          />
        </section>
      </div>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Stock-demand planning</h2>
            <p>
              Eight inventory items · separately generated scenario balances ·
              14-day consumption forecast.
            </p>
          </div>
          <span className="pill amber">Scenario stock, not pharmacy stock</span>
        </div>
        <div className="ml-scenario">
          <label htmlFor="stock-scale">
            What if opening stock were <strong>{stockScale}%</strong> of the
            scenario balance?
          </label>
          <input
            id="stock-scale"
            type="range"
            min="25"
            max="200"
            step="5"
            value={stockScale}
            onChange={(e) => setStockScale(Number(e.target.value))}
          />
          <small>
            This slider recalculates inventory cover only; it does not retrain a
            model or save a stock change.
          </small>
        </div>
        <Table
          headers={[
            "Item",
            "Scenario balance",
            "Forecast/day",
            "Estimated cover",
            "Depletion in forecast window",
            "Planning status",
          ]}
          rows={report.stock_projection.map((item: Row) => {
            const balance = Math.round((item.current_stock * stockScale) / 100);
            const cover =
              item.mean_daily_demand > 0
                ? balance / item.mean_daily_demand
                : null;
            let used = 0;
            const crossing = report.forecast[item.code].find((r: Row) => {
              used += r.value;
              return used >= balance && used > 0;
            });
            const needs = cover !== null && cover <= item.reorder_days;
            return [
              item.name,
              num(balance) + " " + item.unit,
              num(item.mean_daily_demand, 1),
              cover === null ? "No demand forecast" : num(cover, 1) + " days",
              crossing ? day(crossing.date) : "Beyond 14 days / no demand",
              <span
                key={item.code}
                className={"pill " + (needs ? "amber" : "green")}
              >
                {needs ? "Review replenishment" : "Monitor"}
              </span>,
            ];
          })}
        />
        <div className="ml-note">
          Stock units and coefficients are inventory-planning assumptions, not
          medication doses. Reorder thresholds are deterministic rules applied
          to forecast demand. No purchase order, dispensing decision or clinical
          action is created.
        </div>
      </section>
      <details className="card ml-details">
        <summary>
          Model evaluation, provenance & assumptions <span>↗</span>
        </summary>
        <div className="ml-details-content">
          <div className="ml-split-grid">
            {[
              ["Training targets through", report.splits.train_target_end],
              [
                "Validation period",
                report.splits.validation_start +
                  " → " +
                  report.splits.validation_end,
              ],
              [
                "Range calibration",
                report.splits.calibration_start +
                  " → " +
                  report.splits.calibration_end,
              ],
              [
                "Untouched test period",
                report.splits.test_start + " → " + report.splits.test_end,
              ],
            ].map(([title, value]) => (
              <div key={title}>
                <small>{title}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p className="ml-note">
            {report.splits.note} The evaluated model was fitted through{" "}
            {report.splits.evaluation_model_fit_through}; serving models were
            then refitted through {report.splits.serving_model_refit_through}.
            Test errors are measured, not recomputed to favour the final model.
          </p>
          <Table
            headers={[
              "Target",
              "Selected method",
              "Validation model / baseline MAE",
              "Test selected MAE",
              "Test baseline MAE",
              "WAPE",
              "Daily range coverage",
            ]}
            rows={Object.entries(report.evaluation).map(([name, v]) => {
              const e = v as Row;
              return [
                labels[name] || name,
                method(e.selected_method),
                num(e.validation_model_mae, 2) +
                  " / " +
                  num(e.validation_baseline_mae, 2),
                num(e.selected_test.mae, 2),
                num(e.baseline_test.mae, 2),
                e.selected_test.wape_percent === null
                  ? "Undefined (zero actual demand)"
                  : num(e.selected_test.wape_percent, 1) + "%",
                num(e.empirical_range_coverage_percent, 1) + "%",
              ];
            })}
          />
          <div className="ml-provenance">
            <span>
              Model version <code>{report.model_version}</code>
            </span>
            <span>
              {report.provenance.history_rows.toLocaleString("en-IN")} generated
              daily rows across {report.provenance.facility_count} linked
              facilities
            </span>
            <span>
              {report.history_start} → {report.history_end} · scikit-learn{" "}
              {report.provenance.sklearn_version}
            </span>
            <span>{report.serving_mode}</span>
            <span>
              Source SHA-256 <code>{report.provenance.source_sha256}</code>
            </span>
          </div>
          <p className="ml-note">
            {report.cohort_note}{" "}
            {report.registered_cohort_edd_context.reduce(
              (n: number, r: Row) => n + r.count,
              0,
            )}{" "}
            imported ongoing pregnancies have an EDD in this forecast window;
            this is not the larger operating-scenario population.
          </p>
          <ul className="assumptions">
            {report.assumptions.map((a: string) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      </details>
    </>
  );
}
