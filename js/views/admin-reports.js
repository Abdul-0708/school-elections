/* ADMIN: Results · Reports & exports · Settings (branding, administrators, demo, system). */
(function (S) {
  'use strict';
  const U = S.util, UI = S.ui, R = S.rules, html = U.html, raw = U.raw;
  const A = S.admin;

  /* ================================================================== Results */
  A.pages.results = {
    title: 'Results', cap: 'results.view', needsElection: true,
    async render(el, ctx) {
      const e = ctx.election;
      S.api.logAction(e.id, 'results.viewed', {});
      const sfx = e.is_demo ? '/demo' : '';
      const draw = async () => {
        const r = await S.api.getResults(e.id);
        const vis = { live: 'Public — live', after_close: 'Public after closing', hidden: 'Administrators only' }[r.election.results_visibility];
        U.setHtml(el, html`
          ${A.head(r.final ? 'Official final results' : 'Live count', 'Results', html`${r.final ? `Closed ${U.fmtDateTime(r.election.closed_at)} · locked` : 'Provisional — updates as votes arrive'} · Public display: <b>${vis}</b>`,
            html`<a class="btn btn-secondary" href="#/results${sfx}" target="_blank" rel="noopener noreferrer">${UI.icon('monitor', 18)}<span>Projector screen</span></a>
              ${ctx.can('reports.export') ? html`<button class="btn btn-primary" data-print>${UI.icon('printer', 18)}<span>${r.final ? 'Print official results' : 'Print provisional results'}</span></button>` : ''}`)}
          <div class="stat-grid four">
            ${UI.statCard({ label: 'Eligible voters', value: U.fmtInt(r.stats.eligible), icon: 'users' })}
            ${UI.statCard({ label: 'Votes cast', value: U.fmtInt(r.stats.cast), icon: 'ballot', tone: 'brand' })}
            ${UI.statCard({ label: 'Remaining', value: U.fmtInt(r.stats.remaining), icon: 'clock' })}
            ${UI.statCard({ label: 'Turnout', value: U.fmtPct(r.stats.turnout), icon: 'activity', tone: 'ok' })}
          </div>
          ${!r.positions.length ? UI.empty({ icon: 'chart', title: 'No results yet', text: 'Results appear here as soon as positions and candidates exist.' }) : ''}
          <div class="result-grid">${r.positions.map((p) => {
            const max = Math.max(0, ...p.candidates.map((c) => c.votes));
            return html`<section class="card card-pad res-card">
              <header class="res-head"><h2>${p.name}</h2>
                <span class="muted">${U.plural(p.total_votes, 'valid vote')} · ${p.seats > 1 ? `${p.seats} seats` : '1 seat'}</span>
                ${r.final ? (p.outcome === 'tie' ? UI.badge('TIE — no winner declared', 'warn') : p.outcome === 'decided' ? UI.badge('Decided', 'ok') : UI.badge('No votes')) : p.candidates.some((c) => c.tie) ? UI.badge(p.seats > 1 ? 'Tie for the last seat' : 'Tied for first', 'warn') : ''}
              </header>
              <ol class="res-rows">${p.candidates.map((c) => html`<li class="${c.winner ? 'win' : ''} ${c.tie && r.final ? 'tie' : ''}">
                <span class="rr-rank tnum">${c.rank}</span>${UI.avatar(c, 40)}
                <div class="rr-body"><div class="rr-top"><b>${c.name}</b>${c.winner ? html`<span class="flag win">${UI.icon('trophy', 14)} Winner</span>` : ''}${c.tie && r.final ? html`<span class="flag tie">Tie</span>` : ''}<span class="spacer"></span><span class="tnum rr-votes">${U.fmtInt(c.votes)}</span><span class="tnum muted rr-pct">${U.fmtPct(c.pct)}</span></div>
                  <div class="rr-track"><i style="width:${max ? (c.votes / max) * 100 : 0}%"></i></div></div></li>`)}</ol>
            </section>`;
          })}</div>`);
        el.querySelector('[data-print]') && el.querySelector('[data-print]').addEventListener('click', () => {
          S.print.results(r);
          S.api.logAction(e.id, 'report.printed', { final: r.final });
        });
      };
      await draw();
      const redraw = U.throttle(() => draw().catch(() => {}), 2500);
      const unsub = S.api.subscribe(e.id, (evt) => { if (evt.type !== 'realtime' && evt.type !== 'station') redraw(); });
      return () => unsub();
    },
  };

  /* ================================================================== Reports */
  A.pages.reports = {
    title: 'Reports', cap: 'monitor.view',
    async render(el, ctx) {
      const e = ctx.election;
      const canExport = ctx.can('reports.export');
      const elections = await S.api.listElections();
      const archived = elections.filter((x) => x.archived_at);
      const audit = ctx.can('audit.view') && e ? await S.api.listAudit(e.id, 40) : [];
      const stamp = () => new Date().toISOString().slice(0, 10);
      const exportCSV = async (kind) => {
        const r = await S.api.getResults(e.id);
        const name = `${U.slug(e.name)}${e.is_demo ? '-DEMO' : ''}`;
        if (kind === 'summary') {
          U.download(`${name}-summary-${stamp()}.csv`, U.toCSV([
            ['Field', 'Value'], ['School', (ctx.school && ctx.school.name) || ''], ['Election name', e.name], ['Academic year', e.academic_year],
            ['Demo election', e.is_demo ? 'YES — not real votes' : 'No'], ['Status', R.STATUS[e.status].label],
            ['Total eligible voters', r.stats.eligible], ['Total votes', r.stats.cast], ['Did not vote', r.stats.remaining],
            ['Turnout %', Number(r.stats.turnout).toFixed(1)], ['Start time', e.opened_at ? new Date(e.opened_at).toLocaleString('en-GB') : ''],
            ['Closing time', e.closed_at ? new Date(e.closed_at).toLocaleString('en-GB') : 'Not closed'], ['Results', r.final ? 'Official (locked)' : 'Provisional'],
            ['Generated', new Date().toLocaleString('en-GB')]]));
        } else if (kind === 'results') {
          const rows = [['Position', 'Candidate', 'Class', 'Votes', 'Percentage', 'Rank', 'Result']];
          r.positions.forEach((p) => p.candidates.forEach((c) => rows.push([p.name, c.name, c.class_name || '', c.votes, Number(c.pct).toFixed(1), c.rank, r.final ? (c.winner ? 'Winner' : c.tie ? 'Tie' : '') : 'Provisional'])));
          U.download(`${name}-results-${stamp()}.csv`, U.toCSV(rows));
        } else if (kind === 'turnout') {
          const m = await S.api.getMonitor(e.id);
          const rows = [['Class', 'Eligible', 'Voted', 'Did not vote', 'Turnout %']];
          m.by_class.forEach((c) => rows.push([c.class_name, c.eligible, c.voted, c.eligible - c.voted, U.pct(c.voted, c.eligible).toFixed(1)]));
          rows.push(['TOTAL', m.eligible, m.cast, m.remaining, Number(m.turnout).toFixed(1)]);
          U.download(`${name}-turnout-${stamp()}.csv`, U.toCSV(rows));
        } else if (kind === 'audit') {
          const list = await S.api.listAudit(e.id, 5000);
          U.download(`${name}-audit-log-${stamp()}.csv`, U.toCSV([['Time', 'Administrator', 'Action', 'Details'],
            ...list.map((a) => [new Date(a.created_at).toLocaleString('en-GB'), a.actor_email || 'system', A.actionLabel(a.action), JSON.stringify(a.metadata || {})])]));
        } else if (kind === 'print') {
          S.print.results(r);
          S.api.logAction(e.id, 'report.printed', { final: r.final });
          return;
        }
        S.api.logAction(e.id, 'export.generated', { type: kind });
        UI.toast('Export downloaded.');
      };
      const card = (kind, icon, title, text, label) => html`<article class="report-card">
          <div class="rc-icon">${UI.icon(icon, 24)}</div><div class="rc-body"><h3>${title}</h3><p>${text}</p></div>
          <button class="btn btn-secondary btn-sm" data-export="${kind}" ${canExport && e ? '' : 'disabled'}>${UI.icon(kind === 'print' ? 'printer' : 'download', 16)}<span>${label}</span></button></article>`;
      U.setHtml(el, html`
        ${A.head('Reports', 'Reports & exports', 'Only aggregate information is exported. Ballots can never be linked to students.')}
        ${!canExport ? UI.callout('info', 'Exports are limited to Super Admins', 'You can still view results and the activity log.') : ''}
        ${e ? html`<div class="report-grid">
          ${card('summary', 'file', 'Election summary', 'Name, academic year, eligible voters, votes, turnout, opening and closing times.', 'Download CSV')}
          ${card('results', 'chart', 'Results', 'Position · Candidate · Votes · Percentage · Rank for every position.', 'Download CSV')}
          ${card('turnout', 'users', 'Voter turnout by class', 'Eligible, voted and turnout % per class — no individual voters.', 'Download CSV')}
          ${card('print', 'printer', 'Official results report', 'Branded, printable report with signature lines for certification.', 'Print')}
          ${ctx.can('audit.view') ? card('audit', 'shield', 'Audit log', 'Every administrative action, who did it and when. Never ballot choices.', 'Download CSV') : ''}
        </div>` : A.noElection(ctx)}
        ${audit.length ? html`<section class="card card-pad">
          <div class="card-title">Recent administrative activity</div>
          <div class="table-wrap"><table class="table compact"><thead><tr><th>Time</th><th>Administrator</th><th>Action</th></tr></thead>
          <tbody>${audit.map((a) => html`<tr><td class="tnum">${U.fmtShortDate(a.created_at)} ${U.fmtTime(a.created_at, true)}</td><td>${a.actor_email || 'system'}</td><td>${A.actionLabel(a.action)}${a.metadata && a.metadata.name ? html` <span class="muted">· ${a.metadata.name}</span>` : ''}</td></tr>`)}</tbody></table></div>
        </section>` : ''}
        ${archived.length ? html`<section class="card card-pad">
          <div class="card-title">${UI.icon('archive', 20)} Archived elections</div>
          <ul class="archive-list">${archived.map((x) => html`<li><div><b>${x.name}</b><span class="muted small">${x.academic_year} · closed ${U.fmtDate(x.closed_at)}</span></div>
            <a class="btn btn-secondary btn-sm" href="#/results/${x.id}" target="_blank" rel="noopener noreferrer">${UI.icon('trophy', 16)}<span>Final results</span></a>
            ${canExport ? html`<button class="btn btn-ghost btn-sm" data-print-arch="${x.id}">${UI.icon('printer', 16)}<span>Print</span></button>` : ''}</li>`)}</ul>
        </section>` : ''}`);
      el.addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-export]');
        if (b) return UI.busy(b, () => exportCSV(b.dataset.export).catch(UI.toastError));
        const pa = ev.target.closest('[data-print-arch]');
        if (pa) { try { S.print.results(await S.api.getResults(pa.dataset.printArch)); } catch (err) { UI.toastError(err); } }
      });
    },
  };

  /* ================================================================== Settings */
  A.pages.settings = {
    title: 'Settings', cap: 'monitor.view',
    async render(el, ctx) {
      const tabs = [
        { id: 'branding', label: 'School branding', icon: 'school' },
        ...(ctx.can('admins.manage') ? [{ id: 'admins', label: 'Administrators', icon: 'users' }] : []),
        { id: 'demo', label: 'Demo mode', icon: 'flask' },
        { id: 'system', label: 'System', icon: 'database' },
      ];
      let tab = U.store.get('sge.admin.settingsTab', 'branding');
      if (!tabs.some((t) => t.id === tab)) tab = 'branding';
      U.setHtml(el, html`
        ${A.head('Settings', 'Settings')}
        <div class="tabs" role="tablist">${tabs.map((t) => html`<button role="tab" class="tab" data-tab="${t.id}" aria-selected="${t.id === tab}">${UI.icon(t.icon, 18)}<span>${t.label}</span></button>`)}</div>
        <div id="tab-body"></div>`);
      const body = el.querySelector('#tab-body');
      const show = async () => {
        U.$$('[data-tab]', el).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
        // Fresh container per tab, so a slower tab that finishes late can't overwrite the current one.
        const holder = document.createElement('div');
        body.replaceChildren(holder);
        U.setHtml(holder, UI.loading());
        try { await ({ branding: branding, admins: admins, demo: demo, system: system })[tab](holder, ctx); } catch (e) { U.setHtml(holder, UI.errorState(e)); }
      };
      el.querySelector('.tabs').addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-tab]');
        if (!b) return;
        tab = b.dataset.tab;
        U.store.set('sge.admin.settingsTab', tab);
        show();
      });
      show();
    },
  };

  /* ---- branding (also used by the wizard) */
  A.brandingForm = (school, opts = {}) => {
    const s = { ...S.brand.DEFAULTS, ...(school || {}) };
    const dis = opts.readOnly ? 'disabled' : '';
    return html`
      <div class="brand-layout">
        <div class="brand-fields">
          <div class="field"><label class="label" for="b-name">School name</label><input class="input" id="b-name" name="name" value="${school ? s.name : ''}" maxlength="160" required ${dis} placeholder="e.g. Hillside Academy"></div>
          <div class="grid-2 tight">
            <div class="field"><label class="label" for="b-motto">Motto <span class="opt">optional</span></label><input class="input" id="b-motto" name="motto" value="${s.motto || ''}" maxlength="200" ${dis}></div>
            <div class="field"><label class="label" for="b-year">Academic year</label><input class="input" id="b-year" name="academic_year" value="${s.academic_year || ''}" maxlength="20" ${dis}></div>
          </div>
          <div class="grid-2 tight">
            <div class="field"><span class="label">School logo</span>
              <div class="upload-row"><span class="logo-prev" id="logo-prev">${UI.logo(s, 56)}</span>
                <label class="btn btn-secondary btn-sm ${opts.readOnly ? 'disabled' : ''}">${UI.icon('upload', 16)}<span>Upload</span><input type="file" accept="image/png,image/jpeg,image/webp" id="logo-file" class="sr-only" ${dis}></label>
                <button type="button" class="btn btn-ghost btn-sm" id="logo-clear" ${dis}>Remove</button></div></div>
            <div class="field"><span class="label">Election banner <span class="opt">home page</span></span>
              <div class="upload-row"><span class="banner-prev" id="banner-prev">${U.safeImg(s.banner_url) ? html`<img src="${s.banner_url}" alt="">` : UI.icon('image', 22)}</span>
                <label class="btn btn-secondary btn-sm ${opts.readOnly ? 'disabled' : ''}">${UI.icon('upload', 16)}<span>Upload</span><input type="file" accept="image/png,image/jpeg,image/webp" id="banner-file" class="sr-only" ${dis}></label>
                <button type="button" class="btn btn-ghost btn-sm" id="banner-clear" ${dis}>Remove</button></div></div>
          </div>
          <div class="field"><span class="label">Colours</span>
            <div class="color-row">
              <label class="color-field"><input type="color" name="primary_color" value="${s.primary_color}" ${dis}><span>Primary</span></label>
              <label class="color-field"><input type="color" name="secondary_color" value="${s.secondary_color}" ${dis}><span>Secondary</span></label>
              <label class="color-field"><input type="color" name="accent_color" value="${s.accent_color}" ${dis}><span>Accent</span></label>
            </div>
            <div class="preset-row">${S.brand.PRESETS.map((p, i) => html`<button type="button" class="preset" data-brand-preset="${i}" title="${p.name}" ${dis}><i style="background:${p.primary}"></i><i style="background:${p.secondary}"></i><i style="background:${p.accent}"></i><span>${p.name}</span></button>`)}</div>
          </div>
        </div>
        <div class="brand-preview" aria-label="Preview">
          <div class="bp-label">Preview</div>
          <div class="bp-hero" id="bp-hero"></div>
          <div class="bp-bc" id="bp-bc"></div>
        </div>
      </div>`;
  };
  /* Wires up uploads, presets and the live preview.  Returns getValues(). */
  A.bindBranding = (root, school) => {
    let logo = (school && school.logo_url) || '';
    let banner = (school && school.banner_url) || '';
    const val = () => ({ ...UI.formValues(root.closest('form') || root), logo_url: logo, banner_url: banner });
    const preview = () => {
      if (!root.querySelector('#bp-hero')) return; // the branding fields are no longer on screen
      const v = val();
      const s = { ...v, name: v.name || 'Your School' };
      const p = U.isHex(v.primary_color) ? v.primary_color : '#1d4ed8';
      const a = U.isHex(v.accent_color) ? v.accent_color : '#f59e0b';
      const sec = U.isHex(v.secondary_color) ? v.secondary_color : '#0f172a';
      U.setHtml(root.querySelector('#bp-hero'), html`<div class="bp-hero-in" style="background:linear-gradient(135deg, ${U.mix(p, '#ffffff', 0.9)}, #fff)">
        ${UI.logo(s, 40)}<div class="bp-school">${s.name}</div><div class="bp-title">${v.academic_year || ''} Student Government Elections</div>
        <span class="bp-btn" style="background:${p};color:${U.readableOn(p)}">Cast your vote</span></div>`);
      U.setHtml(root.querySelector('#bp-bc'), html`<div class="bp-bc-in" style="background:${U.luminance(sec) < 0.06 ? sec : U.mix(p, '#000000', 0.78)}">
        <div class="bp-bc-t">LIVE RESULTS</div>
        <div class="bp-bar"><i style="width:72%;background:${p}"></i></div><div class="bp-bar"><i style="width:48%;background:${p}"></i></div>
        <span class="bp-acc" style="background:${a};color:${U.readableOn(a)}">Leading</span></div>`);
      U.setHtml(root.querySelector('#logo-prev'), UI.logo({ ...s, logo_url: logo }, 56));
      U.setHtml(root.querySelector('#banner-prev'), U.safeImg(banner) ? html`<img src="${banner}" alt="">` : UI.icon('image', 22));
    };
    root.addEventListener('input', U.debounce(preview, 80));
    root.addEventListener('click', (e) => {
      const pr = e.target.closest("[data-brand-preset]");
      if (pr) {
        const p = S.brand.PRESETS[Number(pr.dataset.brandPreset)];
        root.querySelector('[name=primary_color]').value = p.primary;
        root.querySelector('[name=secondary_color]').value = p.secondary;
        root.querySelector('[name=accent_color]').value = p.accent;
        preview();
      }
      if (e.target.closest('#logo-clear')) { logo = ''; preview(); }
      if (e.target.closest('#banner-clear')) { banner = ''; preview(); }
    });
    root.querySelector('#logo-file').addEventListener('change', async (e) => {
      try { logo = await U.resizeImage(e.target.files[0], 360, 0.9); preview(); } catch (err) { UI.toast(err.message, 'error'); }
    });
    root.querySelector('#banner-file').addEventListener('change', async (e) => {
      try { banner = await U.resizeImage(e.target.files[0], 1600, 0.82); preview(); } catch (err) { UI.toast(err.message, 'error'); }
    });
    preview();
    return async () => {
      const v = val();
      if (!v.name) throw UI.fieldError({ name: 'Enter the school name.' });
      return {
        name: v.name, motto: v.motto, academic_year: v.academic_year,
        primary_color: v.primary_color, secondary_color: v.secondary_color, accent_color: v.accent_color,
        logo_url: /^data:/.test(logo) ? await S.api.uploadImage(logo, 'branding') : logo || null,
        banner_url: /^data:/.test(banner) ? await S.api.uploadImage(banner, 'branding') : banner || null,
      };
    };
  };

  async function branding(body, ctx) {
    const ro = !ctx.can('school.edit');
    U.setHtml(body, html`<form class="form card card-pad" novalidate>
      ${ro ? UI.callout('info', 'Read only', 'Only Super Admins can change the school branding.') : ''}
      ${A.brandingForm(ctx.school, { readOnly: ro })}
      <div class="form-error" role="alert" hidden></div>
      ${ro ? '' : html`<div class="form-actions"><button class="btn btn-primary btn-lg" type="submit">${UI.icon('check', 18)}<span>Save branding</span></button></div>`}
    </form>`);
    const form = body.querySelector('form');
    const getValues = A.bindBranding(form, ctx.school);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      UI.clearFieldErrors(form);
      const errBox = form.querySelector('.form-error');
      errBox.hidden = true;
      await UI.busy(form.querySelector('[type=submit]'), async () => {
        try { const v = await getValues(); await S.api.saveSchool(v); await ctx.reload(); UI.toast('Branding saved.'); ctx.refreshPage(); }
        catch (err) { if (err.fields) UI.showFieldErrors(form, err.fields); else { errBox.textContent = R.message(err).text; errBox.hidden = false; } }
      });
    });
  }

  async function admins(body, ctx) {
    const list = await S.api.listAdmins();
    const local = S.api.mode === 'local';
    U.setHtml(body, html`
      <section class="card card-pad">
        <div class="card-title">Administrators</div>
        <div class="roles-help">
          <div><b>Super Admin</b><span>Everything: settings, open/close, voters, candidates, exports, administrators.</span></div>
          <div><b>Election Admin</b><span>Candidates, voters and codes; monitor the election; view results.</span></div>
          <div><b>Results Viewer</b><span>View live results and the monitor. Cannot change anything.</span></div>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Email</th><th>Role</th><th>Added</th><th class="actions-col"></th></tr></thead>
          <tbody>${list.map((a) => html`<tr data-id="${a.id}" data-email="${a.email}">
            <td><b>${a.email}</b>${a.id === ctx.me.id ? html` ${UI.badge('You', 'info')}` : ''}</td>
            <td><select class="input input-sm" data-role ${a.id === ctx.me.id ? 'disabled' : ''} aria-label="Role for ${a.email}">${Object.entries(R.ROLES).map(([k, r]) => html`<option value="${k}" ${raw(a.role === k ? 'selected' : '')}>${r.label}</option>`)}</select></td>
            <td class="muted">${U.fmtDate(a.created_at)}</td>
            <td class="actions-col">${a.id === ctx.me.id ? '' : html`<button class="btn btn-icon btn-ghost danger" data-revoke aria-label="Remove ${a.email}">${UI.icon('trash', 16)}</button>`}</td></tr>`)}</tbody></table></div>
      </section>
      <form class="card card-pad form" id="grant" novalidate>
        <div class="card-title">Add an administrator</div>
        ${local ? '' : html`<p class="muted small">The person needs a login first: in Supabase go to <b>Authentication → Users → Add user</b> (email + password). Then grant their role here.</p>`}
        <div class="grid-3 tight">
          <div class="field"><label class="label" for="g-email">Email</label><input class="input" id="g-email" name="email" type="email" required></div>
          <div class="field"><label class="label" for="g-role">Role</label><select class="input" id="g-role" name="role">${Object.entries(R.ROLES).map(([k, r]) => html`<option value="${k}" ${raw(k === 'election_admin' ? 'selected' : '')}>${r.label}</option>`)}</select></div>
          ${local ? html`<div class="field"><label class="label" for="g-pw">Temporary password</label><input class="input" id="g-pw" name="password" type="password" minlength="8" autocomplete="new-password"></div>` : ''}
        </div>
        <div class="form-error" role="alert" hidden></div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">${UI.icon('plus', 18)}<span>Grant access</span></button></div>
      </form>`);
    const refresh = () => admins(body, ctx);
    body.querySelector('#grant').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = UI.formValues(e.target);
      const errBox = e.target.querySelector('.form-error');
      errBox.hidden = true;
      await UI.busy(e.target.querySelector('[type=submit]'), async () => {
        try { await S.api.grantAdmin(v.email, v.role, v.password); UI.toast('Access granted.'); refresh(); }
        catch (err) { errBox.textContent = R.message(err).text; errBox.hidden = false; }
      });
    });
    body.addEventListener('change', async (e) => {
      const sel = e.target.closest('[data-role]');
      if (!sel) return;
      const tr = sel.closest('tr');
      try { await S.api.grantAdmin(tr.dataset.email, sel.value); UI.toast('Role updated.'); } catch (err) { UI.toastError(err); refresh(); }
    });
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-revoke]');
      if (!b) return;
      const tr = b.closest('tr');
      if (!(await UI.confirm({ title: `Remove ${tr.dataset.email}?`, message: 'They will immediately lose access to the election administration.', confirmLabel: 'Remove access', danger: true }))) return;
      try { await S.api.revokeAdmin(tr.dataset.id); UI.toast('Access removed.'); refresh(); } catch (err) { UI.toastError(err); }
    });
  }

  async function demo(body, ctx) {
    const pub = await S.refreshPublic();
    const d = pub.demo;
    const canManage = ctx.can('demo.manage');
    if (!d) {
      U.setHtml(body, html`<section class="card card-pad">${UI.empty({ icon: 'flask', title: 'Practice before the real election',
        text: 'The demo election has sample positions, candidates and 60 demo voters. Use it to train staff and test stations and the projector. Demo votes are stored in a completely separate election and can never affect the real one.',
        action: canManage ? html`<button class="btn btn-primary" data-act="create-demo">${UI.icon('sparkles', 18)}<span>Create demo election</span></button>` : html`<p class="muted">Ask a Super Admin to create it.</p>` })}</section>`);
      return;
    }
    const r = await S.api.getResults(d.id);
    U.setHtml(body, html`
      <section class="card card-pad demo-card">
        <div class="demo-head"><span class="mode-badge demo">${UI.icon('flask', 14)} DEMO</span><h2>${d.name}</h2>${UI.statusPill(R.votingState(d))}</div>
        <p class="muted">${U.fmtInt(r.stats.cast)} demo votes from ${U.fmtInt(r.stats.eligible)} demo voters · Turnout ${U.fmtPct(r.stats.turnout)}</p>
        <div class="demo-actions">
          <a class="btn btn-secondary" href="#/vote/demo" target="_blank" rel="noopener noreferrer">${UI.icon('ballot', 18)}<span>Open demo station</span></a>
          <a class="btn btn-secondary" href="#/results/demo" target="_blank" rel="noopener noreferrer">${UI.icon('monitor', 18)}<span>Open demo results</span></a>
          ${canManage && d.status !== 'closed' ? html`
            <button class="btn btn-secondary" data-demo="codes">${UI.icon('key', 18)}<span>Get 10 demo codes</span></button>
            <button class="btn btn-secondary" data-demo="simulate">${UI.icon('activity', 18)}<span>Simulate 10 votes</span></button>` : ''}
        </div>
      </section>
      ${canManage ? html`<section class="card card-pad danger-zone">
        <div class="card-title">${UI.icon('alert', 20)} Demo controls</div>
        <p class="muted">Closing the demo lets you rehearse the official winner display. Resetting clears demo ballots only — the live election is never affected and cannot be reset.</p>
        <div class="demo-actions">
          ${d.status !== 'closed' ? html`<button class="btn btn-secondary" data-demo="close">${UI.icon('stop', 18)}<span>Close demo election</span></button>` : ''}
          <button class="btn btn-danger-outline" data-demo="reset">${UI.icon('refresh', 18)}<span>Reset demo votes…</span></button>
        </div></section>` : ''}`);
    body.onclick = async (e) => {
      const b = e.target.closest('[data-demo]');
      if (!b) return;
      const act = b.dataset.demo;
      const dctx = { ...ctx, election: d };
      try {
        if (act === 'codes') {
          const codes = await S.api.regenerateCodes(d.id, { allUnused: true, limit: 10 });
          if (!codes.length) return UI.toast('All demo voters have voted. Reset the demo to get fresh codes.', 'info');
          await A.showCodes(dctx, codes, 'Demo voting codes', d);
        } else if (act === 'simulate') {
          await UI.busy(b, async () => {
            const n = await S.demo.simulateVotes(S.api, d, 10, (done, total) => { b.querySelector('span').textContent = `Voting… ${done}/${total}`; });
            S.api.logAction(d.id, 'demo.simulated', { count: n });
            UI.toast(n ? `${n} demo votes cast.` : 'No unused demo voters left — reset the demo.', n ? 'ok' : 'info');
          });
          demo(body, ctx);
        } else if (act === 'close') {
          const phrase = await UI.confirm({ title: 'Close the demo election?', phrase: R.PHRASES.close, confirmLabel: 'Close demo', icon: 'stop', message: 'Shows the official winner display on the demo results screen. You can reset the demo afterwards.' });
          if (!phrase) return;
          await S.api.setStatus(d.id, 'closed', phrase); UI.toast('Demo election closed.'); await ctx.reload(); demo(body, ctx);
        } else if (act === 'reset') {
          const phrase = await UI.confirm({ title: 'Reset the demo election?', danger: true, phrase: R.PHRASES.resetDemo, confirmLabel: 'Reset demo', icon: 'refresh', message: 'All DEMO ballots are deleted and the demo reopens. The live election is not touched.' });
          if (!phrase) return;
          await S.api.resetDemo(d.id, phrase); UI.toast('Demo reset.'); await ctx.reload(); demo(body, ctx);
        }
      } catch (err) { UI.toastError(err); b.querySelector('span') && demo(body, ctx); }
    };
  }

  async function system(body, ctx) {
    const local = S.api.mode === 'local';
    U.setHtml(body, html`
      <section class="card card-pad">
        <div class="card-title">${UI.icon('database', 20)} Data connection</div>
        <p><span class="badge tone-${local ? 'warn' : 'ok'}">${local ? 'Local demo engine' : 'Supabase connected'}</span> <span class="muted">${S.api.label}</span></p>
        ${local ? UI.callout('warn', 'Not for the real election', 'In local mode all data lives in this one browser, and voting stations on other computers cannot connect. Follow README.md to connect Supabase (about 15 minutes) before election day.')
          : html`<ul class="checklist compact">
              <li class="ok">${UI.icon('check', 16)}<span>Only the publishable key is used in the browser</span></li>
              <li class="ok">${UI.icon('check', 16)}<span>Every vote goes through the database's <code>submit_ballot</code> transaction</span></li>
              <li class="ok">${UI.icon('check', 16)}<span>Row Level Security on every table · ballots unreadable by any browser</span></li>
              <li class="ok">${UI.icon('check', 16)}<span>Live updates via Supabase Realtime (aggregate counts only)</span></li></ul>`}
      </section>
      <section class="card card-pad">
        <div class="card-title">${UI.icon('monitor', 20)} Setting up voting stations</div>
        <ol class="howto">
          <li>On each lab computer open <code>${location.origin + location.pathname}#/vote</code>.</li>
          <li>For a locked-down kiosk, start Chrome with <code>--kiosk --incognito</code> and that address (see README).</li>
          <li>Press the full-screen button. After each vote the station resets itself for the next student.</li>
          <li>Never sign in as an administrator on a voting station.</li>
        </ol>
      </section>
      ${local && ctx.can('admins.manage') ? html`<section class="card card-pad danger-zone">
        <div class="card-title">${UI.icon('trash', 20)} Erase local demo data</div>
        <p class="muted">Removes everything this browser has stored for the local demo engine — school, elections, voters, votes and accounts. This has no effect on Supabase.</p>
        <button class="btn btn-danger-outline" data-erase>${UI.icon('trash', 18)}<span>Erase all local data…</span></button>
      </section>` : ''}`);
    const er = body.querySelector('[data-erase]');
    if (er) er.addEventListener('click', async () => {
      const phrase = await UI.confirm({ title: 'Erase all local data?', danger: true, phrase: R.PHRASES.erase, confirmLabel: 'Erase everything', icon: 'trash', message: 'This permanently deletes the local demo data in this browser.' });
      if (!phrase) return;
      try { await S.api.eraseEverything(phrase); S.vault.clear(); location.hash = '#/'; location.reload(); } catch (err) { UI.toastError(err); }
    });
  }
})(window.SGE);
