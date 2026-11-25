/* Clinical intelligence panel for the doctor patient record. All content comes from
   /api/doctor/patients/:id/intelligence — deterministic, evidence-linked, no invented data. */
(function () {
  const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SEV = { urgent: '#b3261e', review: '#a15c00', info: '#1a56db' };
  const ST = { new: 'New', under_review: 'Under review', acknowledged: 'Acknowledged', resolved: 'Resolved', monitoring: 'Monitoring' };
  const AST = { open: 'Open', completed: 'Completed', deferred: 'Deferred', not_applicable: 'Not applicable', follow_up: 'Follow-up' };
  const GAP = { completed: 'Completed', pending: 'Pending', overdue: 'Overdue', not_applicable: 'Not applicable', awaiting_result: 'Awaiting result' };

  async function mount(container, { api, patientId, alive }) {
    container.innerHTML = '<p role="status">Analysing recorded measurements…</p>';
    let data;
    try { data = await api(`/doctor/patients/${patientId}/intelligence`); }
    catch (e) { if (alive()) container.innerHTML = `<p class="dpp-muted">${E(e.message)}</p>`; return; }
    if (!alive() || !container.isConnected) return;
    container.innerHTML = render(data);
    bind(container, data, { api, patientId, alive, reload: () => mount(container, { api, patientId, alive }) });
  }

  function spark(points, unit) {
    if (!points || points.length < 2) return '';
    const w = 260, h = 56, pad = 4;
    const vals = points.map(p => p.value);
    const lo = Math.min(...vals), hi = Math.max(...vals), span = (hi - lo) || 1;
    const xy = points.map((p, i) => `${pad + i * (w - 2 * pad) / (points.length - 1)},${h - pad - (p.value - lo) / span * (h - 2 * pad)}`).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Trend chart"><polyline points="${xy}" fill="none" stroke="#1a56db" stroke-width="1.5"/>${points.map((p, i) => `<circle cx="${pad + i * (w - 2 * pad) / (points.length - 1)}" cy="${h - pad - (p.value - lo) / span * (h - 2 * pad)}" r="2.5" fill="#1a56db"><title>${E(p.on)}: ${E(p.value)} ${E(unit || '')}</title></circle>`).join('')}</svg>`;
  }

  function render(d) {
    const g = d.gestation ? `${d.gestation.weeks}w + ${d.gestation.days}d` : 'Not estimable';
    const flags = d.flags || [], cmps = d.comparisons || [], gaps = d.care_gaps || [], actions = d.actions || [];
    const kindLabel = { fact: 'Documented', calculated: 'Calculated', automated: 'Automated observation', missing: 'Missing information' };
    return `
    <div class="dpp-intel">
      <p class="dpp-label">CLINICAL INTELLIGENCE · deterministic rules · ${E(d.generated_at?.slice(0, 16).replace('T', ' '))}</p>
      <p><strong>Gestation:</strong> ${E(g)} · <strong>Flags:</strong> ${flags.length} · <strong>Open actions:</strong> ${actions.filter(a => a.status === 'open' || a.status === 'follow_up').length}</p>
      <section><h3>Clinical brief</h3><ul>${(d.summary || []).map(s => `<li><span class="dpp-label">${kindLabel[s.kind] || s.kind}</span> ${E(s.text)} <small class="dpp-muted">(${E(s.source)})</small></li>`).join('') || '<li class="dpp-muted">No summary statements.</li>'}</ul></section>
      <section><h3>What changed — previous vs current</h3>
        ${cmps.length ? `<table class="dpp-table"><thead><tr><th>Parameter</th><th>Previous</th><th>Current</th><th>Change</th><th>Observation</th></tr></thead><tbody>${cmps.map(c => `<tr><td>${E(c.label)}</td><td>${E(c.previous)} ${E(c.unit)}<br><small>${E(c.previous_on)}</small></td><td>${E(c.current)} ${E(c.unit)}<br><small>${E(c.current_on)}</small></td><td>${c.delta > 0 ? '+' : ''}${E(c.delta)}</td><td>${E(c.observation)}</td></tr>`).join('')}</tbody></table>` : '<p class="dpp-muted">Not enough repeated measurements recorded yet.</p>'}
      </section>
      <section><h3>Clinical flags</h3>
        ${flags.length ? flags.map(f => `<article class="dpp-flag" data-flag="${f.id}" style="border-left:4px solid ${SEV[f.severity] || '#666'}">
          <header><strong>${E(f.title)}</strong> <span class="dpp-label">${ST[f.status] || f.status}</span></header>
          <p>${E(f.reason)}</p>
          <p class="dpp-muted">${f.current_on ? `Current ${E(f.current_on)}` : ''}${f.previous_on ? ` · previous ${E(f.previous_on)}` : ''}${f.reference_low != null ? ` · ref ${E(f.reference_low)}–${E(f.reference_high)} ${E(f.unit || '')}` : ''}</p>
          <div class="dpp-flag-actions">
            ${['acknowledge', 'under_review', 'monitoring'].filter(a => f.status !== ({ acknowledge: 'acknowledged', under_review: 'under_review', monitoring: 'monitoring' })[a]).map(a => `<button type="button" class="dw-text-button" data-flag-act="${a}">${{ acknowledge: 'Acknowledge', under_review: 'Mark under review', monitoring: 'Monitoring' }[a]}</button>`).join('')}
            <button type="button" class="dw-text-button" data-flag-act="resolve">Resolve…</button>
            ${f.status === 'resolved' ? '' : ''}
          </div></article>`).join('') : '<p class="dpp-muted">No active flags. Absence of flags is not a guarantee of safety.</p>'}
      </section>
      <section><h3>ANC care gaps</h3>
        <table class="dpp-table"><thead><tr><th>Activity</th><th>Expected by</th><th>Status</th><th>Completed via</th></tr></thead><tbody>${gaps.map(x => `<tr><td>${E(x.label)}</td><td>Week ${E(x.by_week ?? '—')}</td><td>${GAP[x.status] || E(x.status)}</td><td>${E(x.completed_via || '—')}</td></tr>`).join('')}</tbody></table>
      </section>
      <section><h3>Suggested clinical actions</h3>
        ${actions.length ? actions.map(a => `<article class="dpp-action" data-action="${a.id}"><strong>${E(a.title)}</strong><p class="dpp-muted">${E(a.detail || '')} · ${E(a.source)}</p>
          <div class="dpp-flag-actions">${['completed', 'deferred', 'not_applicable', 'follow_up'].filter(s => s !== a.status).map(s => `<button type="button" class="dw-text-button" data-act-status="${s}">${AST[s]}</button>`).join('')}
          <span class="dpp-label">${AST[a.status] || a.status}</span></div></article>`).join('') : '<p class="dpp-muted">No suggested actions.</p>'}
      </section>
      <section><h3>Trends</h3>
        ${(d.trends || []).length ? d.trends.map(t => `<details><summary>${E(t.label)} (${E(t.unit || 'unit n/a')}) — ${t.points.length} points</summary>${spark(t.points, t.unit)}<ul>${t.points.map(p => `<li>${E(p.on)} · ${E(p.value)} ${E(t.unit || '')}${p.gestation_weeks != null ? ` · ~${p.gestation_weeks}w` : ''}</li>`).join('')}</ul></details>`).join('') : '<p class="dpp-muted">Not enough repeated measurements for trends.</p>'}
      </section>
      <p class="dpp-muted">${(d.limitations || []).map(E).join(' ')}</p>
    </div>`;
  }

  function bind(container, d, { api, patientId, alive, reload }) {
    container.querySelectorAll('[data-flag]').forEach(el => {
      const flagId = el.dataset.flag;
      el.querySelectorAll('[data-flag-act]').forEach(btn => btn.onclick = async () => {
        const act = btn.dataset.flagAct;
        let note = '';
        if (act === 'resolve') { note = prompt('Resolution note (required for audit):') || ''; if (!note.trim()) return; }
        btn.disabled = true;
        try {
          await api(`/doctor/patients/${patientId}/flags/${flagId}`, { method: 'POST', body: { action: act, note } });
          reload();
        } catch (e) { alert(e.message); btn.disabled = false; }
      });
    });
    container.querySelectorAll('[data-action]').forEach(el => {
      const actionId = el.dataset.action;
      el.querySelectorAll('[data-act-status]').forEach(btn => btn.onclick = async () => {
        btn.disabled = true;
        try { await api(`/doctor/patients/${patientId}/actions/${actionId}`, { method: 'POST', body: { status: btn.dataset.actStatus } }); reload(); }
        catch (e) { alert(e.message); btn.disabled = false; }
      });
    });
  }

  window.DoctorIntelligence = { mount };
})();
