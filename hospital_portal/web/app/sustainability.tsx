"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Row = Record<string, any>;
type Api = (path: string, options?: RequestInit) => Promise<any>;

const metrics = [
  ["water_m3", "Water", "m³"],
  ["energy_kwh", "Electricity", "kWh"],
  ["paper_sheets", "Paper", "sheets"],
  ["waste_kg", "Waste (aggregate)", "kg"],
] as const;

const wasteStreams = ["general", "recyclable", "biomedical", "sharps", "other"] as const;

const nice = (x: unknown) => String(x ?? "—").replaceAll("_", " ");
const number = (x: number) =>
  x.toLocaleString("en-IN", { maximumFractionDigits: 2 });

function QualityBadge({ q }: { q?: string }) {
  const tone =
    q === "measured"
      ? "#065f46"
      : q === "facility_reported"
        ? "#1e40af"
        : q === "estimated"
          ? "#92400e"
          : "#6b7280";
  const bg =
    q === "measured"
      ? "#d1fae5"
      : q === "facility_reported"
        ? "#dbeafe"
        : q === "estimated"
          ? "#fef3c7"
          : "#f3f4f6";
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 999,
        background: bg,
        color: tone,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {nice(q || "unavailable")}
    </span>
  );
}

export function SustainabilityPanel({
  api,
  permissions,
}: {
  api: Api;
  permissions: string[];
}) {
  const [data, setData] = useState<Row | null>(null);
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Row | null>(null);
  const write = permissions.includes("green.write");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(await api("/sustainability" + (period ? "?period=" + period : "")));
    } catch (e) {
      setData(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [api, period]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(path: string, body: Row) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      setEditor(null);
      setNotice("Saved with reporting source and audit history.");
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function measure(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = Object.fromEntries(new FormData(form));
    if (
      await save("/sustainability/measurements", {
        ...v,
        value: Number(v.value),
        occupied_bed_days: v.occupied_bed_days ? Number(v.occupied_bed_days) : null,
      })
    ) {
      setPeriod(String(v.period));
      form.reset();
    }
  }

  async function action(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = Object.fromEntries(new FormData(form));
    if (
      await save("/sustainability/actions", {
        ...v,
        baseline: Number(v.baseline),
        target: Number(v.target),
      })
    ) {
      form.reset();
    }
  }

  async function ticket(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = Object.fromEntries(new FormData(form));
    if (await save("/sustainability/tickets", v)) form.reset();
  }

  async function waste(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = Object.fromEntries(new FormData(form));
    if (
      await save("/sustainability/waste-streams", {
        ...v,
        mass_kg: Number(v.mass_kg),
        segregation_compliant: v.segregation_compliant === "on",
      })
    ) {
      form.reset();
    }
  }

  const cards: Row[] = data?.cards || [];
  const actions: Row[] = data?.actions || [];
  const tickets: Row[] = data?.tickets || [];
  const wasteRows: Row[] = data?.waste_streams || [];
  const flags: Row[] = data?.anomaly_flags || [];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-950">
        <strong>Methodology:</strong>{" "}
        {data?.methodology?.note ||
          "Resource observations only. This dashboard does not invent estimates or label the hospital green without a defined external methodology."}
        <div className="mt-2 flex flex-wrap gap-2 items-center">
          <span className="text-xs text-emerald-800">Reporting month</span>
          <input
            type="month"
            className="rounded-lg border px-2 py-1 text-sm"
            value={period || data?.period || ""}
            onChange={(e) => setPeriod(e.target.value)}
          />
          <button
            type="button"
            className="rounded-lg bg-emerald-700 text-white px-3 py-1 text-sm"
            onClick={() => load()}
            disabled={busy}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      {/* Resource cards */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Resource tracking</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c) => (
            <div key={c.metric} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex justify-between gap-2 items-start">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {c.label}
                </div>
                <QualityBadge q={c.quality} />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900">
                {c.value == null ? "—" : number(c.value)}
                <span className="ml-1 text-sm font-medium text-slate-500">{c.unit}</span>
              </div>
              {c.intensity_per_bed_day != null && (
                <div className="text-xs text-slate-600 mt-1">
                  Intensity: {number(c.intensity_per_bed_day)} {c.unit}/occupied bed-day
                </div>
              )}
              <div className="mt-2 text-xs text-slate-500">
                Period {c.period || "—"}
                {c.source ? ` · Source: ${c.source}` : ""}
              </div>
              {c.note && <div className="mt-1 text-xs italic text-slate-400">{c.note}</div>}
            </div>
          ))}
        </div>
      </section>

      {flags.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-900 mb-2">
            Unusual consumption changes (facility baseline only)
          </h3>
          <ul className="text-sm text-amber-950 space-y-1">
            {flags.map((f, i) => (
              <li key={i}>
                <strong>{nice(f.metric)}</strong> {f.period}: {Math.round(f.change_ratio * 100)}% vs{" "}
                {f.previous_period} ({nice(f.label)}) — {f.note}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* IoT / BMS */}
      <section className="rounded-2xl border bg-white p-4 text-sm">
        <h3 className="font-semibold text-slate-700 mb-1">Energy, cooling &amp; building data</h3>
        <div className="flex flex-wrap gap-2 items-center mb-1">
          <QualityBadge q={data?.iot?.quality} />
          <span className="text-slate-600">{data?.iot?.note}</span>
        </div>
        {data?.iot?.source && data.iot.source !== "none" && (
          <div className="text-xs text-slate-500">Source: {data.iot.source}</div>
        )}
      </section>

      {/* Service efficiency */}
      <section className="rounded-2xl border bg-white p-4 text-sm">
        <h3 className="font-semibold text-slate-700 mb-1">Travel &amp; service efficiency</h3>
        <div className="flex flex-wrap gap-2 items-center mb-2">
          <QualityBadge q={data?.service_efficiency?.quality} />
          <span className="text-slate-600">{data?.service_efficiency?.note}</span>
        </div>
        <div className="grid sm:grid-cols-3 gap-2 text-xs text-slate-600">
          <div>
            Referrals recorded:{" "}
            {data?.service_efficiency?.referrals_recorded ?? "unavailable"}
          </div>
          <div>
            Appointments recorded:{" "}
            {data?.service_efficiency?.appointments_recorded ?? "unavailable"}
          </div>
          <div>
            Teleconsult:{" "}
            {data?.service_efficiency?.teleconsult_enabled
              ? "configured"
              : data?.service_efficiency?.teleconsult_note || "unavailable"}
          </div>
        </div>
      </section>

      {/* Waste streams */}
      <section className="rounded-2xl border bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          Waste streams &amp; segregation (facility-reported)
        </h3>
        {wasteRows.length === 0 ? (
          <p className="text-sm text-slate-500 mb-3">No waste-stream rows for this period.</p>
        ) : (
          <div className="overflow-x-auto mb-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1">Stream</th>
                  <th>Mass (kg)</th>
                  <th>Quality</th>
                  <th>Segregation</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {wasteRows.map((w) => (
                  <tr key={w.id || w.stream} className="border-t">
                    <td className="py-1">{nice(w.stream)}</td>
                    <td>{number(w.mass_kg)}</td>
                    <td>
                      <QualityBadge q={w.quality} />
                    </td>
                    <td>{w.segregation_compliant ? "Compliant (reported)" : "Not confirmed"}</td>
                    <td className="text-xs text-slate-500">{w.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {write && (
          <form onSubmit={waste} className="grid gap-2 sm:grid-cols-3 text-sm">
            <input name="period" type="month" required className="border rounded-lg px-2 py-1" />
            <select name="stream" className="border rounded-lg px-2 py-1" required>
              {wasteStreams.map((s) => (
                <option key={s} value={s}>
                  {nice(s)}
                </option>
              ))}
            </select>
            <input
              name="mass_kg"
              type="number"
              min={0}
              step="any"
              required
              placeholder="Mass kg"
              className="border rounded-lg px-2 py-1"
            />
            <select name="quality" className="border rounded-lg px-2 py-1" required>
              <option value="measured">measured</option>
              <option value="facility_reported">facility_reported</option>
              <option value="estimated">estimated</option>
              <option value="unavailable">unavailable</option>
            </select>
            <input
              name="source"
              required
              minLength={3}
              placeholder="Source"
              className="border rounded-lg px-2 py-1"
            />
            <input
              name="evidence"
              required
              minLength={3}
              placeholder="Evidence ref"
              className="border rounded-lg px-2 py-1"
            />
            <label className="flex items-center gap-2 text-xs sm:col-span-2">
              <input type="checkbox" name="segregation_compliant" /> Segregation compliant
              (facility-attested)
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-slate-800 text-white px-3 py-1"
            >
              Save waste stream
            </button>
          </form>
        )}
      </section>

      {/* Water / energy tickets */}
      <section className="rounded-2xl border bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          Leak &amp; maintenance tickets
        </h3>
        <ul className="text-sm space-y-2 mb-3">
          {tickets.length === 0 && (
            <li className="text-slate-500">No open or recent tickets.</li>
          )}
          {tickets.map((t) => (
            <li key={t.id} className="border rounded-xl p-2 flex flex-wrap justify-between gap-2">
              <div>
                <strong>{t.title}</strong>
                <div className="text-xs text-slate-500">
                  {nice(t.domain)} · {nice(t.kind)} · {nice(t.status)} · {nice(t.priority)}
                </div>
              </div>
              {write && t.status !== "closed" && (
                <button
                  type="button"
                  className="text-xs rounded-lg border px-2 py-1"
                  onClick={() =>
                    save(`/sustainability/tickets/${t.id}`, {
                      status: "closed",
                      notes: "Closed from dashboard",
                      evidence: "dashboard",
                    })
                  }
                >
                  Close
                </button>
              )}
            </li>
          ))}
        </ul>
        {write && (
          <form onSubmit={ticket} className="grid gap-2 sm:grid-cols-3 text-sm">
            <select name="domain" className="border rounded-lg px-2 py-1" required>
              <option value="water">water</option>
              <option value="energy">energy</option>
              <option value="waste">waste</option>
            </select>
            <select name="kind" className="border rounded-lg px-2 py-1" required>
              <option value="leak">leak</option>
              <option value="maintenance">maintenance</option>
              <option value="cooling">cooling</option>
              <option value="other">other</option>
            </select>
            <select name="priority" className="border rounded-lg px-2 py-1">
              <option value="routine">routine</option>
              <option value="elevated">elevated</option>
            </select>
            <input
              name="title"
              required
              minLength={3}
              placeholder="Ticket title"
              className="border rounded-lg px-2 py-1 sm:col-span-2"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-slate-800 text-white px-3 py-1"
            >
              Open ticket
            </button>
          </form>
        )}
      </section>

      {/* Record measurement */}
      {write && (
        <section className="rounded-2xl border bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Record monthly observation</h3>
          <form onSubmit={measure} className="grid gap-2 sm:grid-cols-3 text-sm">
            <input name="period" type="month" required className="border rounded-lg px-2 py-1" />
            <select name="metric" className="border rounded-lg px-2 py-1" required>
              {metrics.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <input
              name="value"
              type="number"
              min={0}
              step="any"
              required
              placeholder="Value"
              className="border rounded-lg px-2 py-1"
            />
            <select name="quality" className="border rounded-lg px-2 py-1" required>
              <option value="measured">measured</option>
              <option value="facility_reported">facility_reported</option>
              <option value="estimated">estimated</option>
              <option value="unavailable">unavailable</option>
            </select>
            <input
              name="occupied_bed_days"
              type="number"
              min={1}
              placeholder="Occupied bed-days (optional)"
              className="border rounded-lg px-2 py-1"
            />
            <input
              name="source"
              required
              minLength={3}
              placeholder="Source (meter / bill / log)"
              className="border rounded-lg px-2 py-1"
            />
            <input
              name="evidence"
              required
              minLength={3}
              placeholder="Evidence reference"
              className="border rounded-lg px-2 py-1 sm:col-span-2"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-emerald-700 text-white px-3 py-1"
            >
              Save observation
            </button>
          </form>
          <p className="text-xs text-slate-500 mt-2">
            Paper reduction supports digital records and consent where clinically safe; required paper
            records are never blocked by this module.
          </p>
        </section>
      )}

      {/* Green actions register */}
      <section className="rounded-2xl border bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          Green actions register (facility baseline → target)
        </h3>
        <ul className="space-y-2 text-sm mb-3">
          {actions.length === 0 && (
            <li className="text-slate-500">No actions logged yet.</li>
          )}
          {actions.map((a) => {
            const done = a.details?.completion?.actual;
            const progress =
              a.baseline > 0 && done != null
                ? Math.min(100, Math.max(0, ((a.baseline - done) / (a.baseline - a.target || a.baseline)) * 100))
                : null;
            return (
              <li key={a.id} className="border rounded-xl p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>{a.title}</strong>
                  <span className="text-xs uppercase text-slate-500">{nice(a.status)}</span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {nice(a.metric)} · baseline {number(a.baseline)} {a.unit} → target{" "}
                  {number(a.target)} {a.unit} · due {a.due_date}
                </div>
                {a.details?.baseline_source && (
                  <div className="text-xs text-slate-400">Baseline source: {a.details.baseline_source}</div>
                )}
                {progress != null && (
                  <div className="text-xs text-emerald-700 mt-1">
                    Progress vs own baseline (from completion evidence): ~{Math.round(progress)}%
                  </div>
                )}
                {write && a.status !== "completed" && a.status !== "cancelled" && (
                  <button
                    type="button"
                    className="mt-2 text-xs rounded-lg border px-2 py-1"
                    onClick={() => setEditor(a)}
                  >
                    Update status
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {write && (
          <form onSubmit={action} className="grid gap-2 sm:grid-cols-3 text-sm">
            <input
              name="title"
              required
              minLength={3}
              placeholder="Action title"
              className="border rounded-lg px-2 py-1 sm:col-span-2"
            />
            <select name="metric" className="border rounded-lg px-2 py-1" required>
              {metrics.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <input
              name="baseline"
              type="number"
              min={0}
              step="any"
              required
              placeholder="Baseline"
              className="border rounded-lg px-2 py-1"
            />
            <input
              name="target"
              type="number"
              min={0}
              step="any"
              required
              placeholder="Target"
              className="border rounded-lg px-2 py-1"
            />
            <input name="due_date" type="date" required className="border rounded-lg px-2 py-1" />
            <select name="owner_id" className="border rounded-lg px-2 py-1" required>
              <option value="">Owner</option>
              {(data?.owners || []).map((o: Row) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.role})
                </option>
              ))}
            </select>
            <input
              name="baseline_source"
              required
              minLength={3}
              placeholder="Baseline source / evidence"
              className="border rounded-lg px-2 py-1 sm:col-span-2"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-emerald-700 text-white px-3 py-1"
            >
              Log action
            </button>
          </form>
        )}
      </section>

      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            className="bg-white rounded-2xl p-4 max-w-md w-full space-y-2 text-sm"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const v = Object.fromEntries(new FormData(form));
              await save(`/sustainability/actions/${editor.id}`, {
                version: editor.details?.version || 1,
                status: v.status,
                notes: v.notes,
                evidence: v.evidence || null,
                actual: v.actual === "" ? null : Number(v.actual),
              });
            }}
          >
            <h4 className="font-semibold">Update: {editor.title}</h4>
            <select name="status" className="border rounded-lg px-2 py-1 w-full" defaultValue="in_progress">
              <option value="in_progress">in_progress</option>
              <option value="completed">completed</option>
              <option value="cancelled">cancelled</option>
            </select>
            <textarea
              name="notes"
              required
              minLength={3}
              placeholder="Notes"
              className="border rounded-lg px-2 py-1 w-full"
              rows={3}
            />
            <input
              name="evidence"
              placeholder="Evidence (required if completed)"
              className="border rounded-lg px-2 py-1 w-full"
            />
            <input
              name="actual"
              type="number"
              min={0}
              step="any"
              placeholder="Actual observation (if completed)"
              className="border rounded-lg px-2 py-1 w-full"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" className="border rounded-lg px-3 py-1" onClick={() => setEditor(null)}>
                Cancel
              </button>
              <button type="submit" className="bg-slate-900 text-white rounded-lg px-3 py-1" disabled={busy}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
