/* FIRST-RUN SETUP WIZARD  (#/admin/setup)
   1 School · 2 Election · 3 Positions · 4 Candidates · 5 Voters · 6 Rules · 7 Preview · 8 Open
   Every step saves straight to the backend, so the wizard can be left and resumed. */
(function (S) {
  'use strict';
  const U = S.util, UI = S.ui, R = S.rules, html = U.html, raw = U.raw;
  const A = S.admin;
  const STEPS = ['School', 'Election', 'Positions', 'Candidates', 'Voters', 'Rules', 'Preview', 'Open'];

  A.pages.setup = {
    title: 'Setup wizard', cap: 'election.edit',
    async render(el, ctx) {
      if (ctx.workspace === 'demo') {
        U.setHtml(el, html`${A.head('Setup wizard', 'Set up the live election')}${UI.empty({ icon: 'sparkles', title: 'The wizard sets up the LIVE election',
          text: 'You are in demo mode. Switch to the live election to continue.', action: html`<button class="btn btn-primary" data-ws="live">${UI.icon('live', 18)}<span>Switch to live election</span></button>` })}`);
        return;
      }
      if (ctx.election && !['draft', 'scheduled'].includes(ctx.election.status)) {
        U.setHtml(el, html`${A.head('Setup wizard', 'Your election is already running')}${UI.empty({ icon: 'check', title: `The election is ${R.STATUS[ctx.election.status].label.toLowerCase()}`,
          text: 'Use the Dashboard to monitor it. The wizard is only for elections that have not opened yet.', action: html`<a class="btn btn-primary" href="#/admin/dashboard">Go to dashboard</a>` })}`);
        return;
      }
      const guess = () => {
        if (!ctx.school) return 0;
        if (!ctx.election) return 1;
        const b = ctx.bundle;
        if (!b.positions.length) return 2;
        if (b.positions.some((p) => p.active && !b.candidates.some((c) => c.position_id === p.id && c.active))) return 3;
        if (!b.voters.total) return 4;
        return 5;
      };
      let step = Number(U.store.get('sge.wizard.step', -1));
      if (!(step >= 0 && step < STEPS.length) || step > guess() + 1) step = guess();
      let getBranding = null;

      U.setHtml(el, html`
        <div class="wizard">
          <div class="wz-head"><div class="eyebrow">${UI.icon('sparkles', 16)} Setup wizard</div><h1>Let's set up your election</h1>
            <p class="page-sub">Eight short steps. Everything is saved as you go — you can stop and come back at any time.</p></div>
          <ol class="wz-steps" id="wz-steps" aria-label="Setup steps"></ol>
          <form class="card wz-card" id="wz-form" novalidate>
            <div class="wz-body" id="wz-body"></div>
            <div class="form-error" role="alert" hidden></div>
            <div class="wz-nav" id="wz-nav"></div>
          </form>
        </div>`);
      const stepsEl = el.querySelector('#wz-steps');
      const body = el.querySelector('#wz-body');
      const nav = el.querySelector('#wz-nav');
      const form = el.querySelector('#wz-form');
      const errBox = form.querySelector('.form-error');
      const maxReach = () => (ctx.school ? (ctx.election ? STEPS.length - 1 : 1) : 0);

      const drawSteps = () => U.setHtml(stepsEl, STEPS.map((s, i) => html`
        <li class="${i < step ? 'done' : ''} ${i === step ? 'current' : ''}">
          <button type="button" data-goto="${i}" ${i > maxReach() ? 'disabled' : ''} ${i === step ? raw('aria-current="step"') : ''}>
            <span class="wz-n">${i < step ? UI.icon('check', 14) : i + 1}</span><span class="wz-l">${s}</span></button></li>`));

      const field = (id, label, value, attrs = '', opt = '') => html`<div class="field"><label class="label" for="${id}">${label}${opt ? html` <span class="opt">${opt}</span>` : ''}</label><input class="input" id="${id}" name="${id}" value="${value || ''}" ${raw(attrs)}></div>`;

      /* ------------------------------------------------------------ steps */
      const views = [
        /* 1 School */ {
          title: 'School information', sub: 'Your school name, logo and colours appear on every screen — ballots, results and printouts.',
          draw() { U.setHtml(body, A.brandingForm(ctx.school)); getBranding = A.bindBranding(form, ctx.school); },
          async next() { const v = await getBranding(); await S.api.saveSchool(v); await ctx.reload(); return true; },
        },
        /* 2 Election */ {
          title: 'Election information', sub: 'Name the election and, optionally, set when voting opens and closes.',
          draw() {
            const e = ctx.election || { name: 'Student Government Elections', academic_year: (ctx.school && ctx.school.academic_year) || String(new Date().getFullYear()) };
            U.setHtml(body, html`
              ${field('name', 'Election name', e.name, 'maxlength="120" required')}
              <div class="grid-2 tight">${field('subtitle', 'Subtitle', e.subtitle, 'maxlength="160" placeholder="Your Voice. Your Choice. Your School."', 'optional')}${field('academic_year', 'Academic year', e.academic_year, 'maxlength="20"')}</div>
              <div class="field"><label class="label" for="description">Short message for the home page <span class="opt">optional</span></label><textarea class="input" id="description" name="description" rows="2" maxlength="2000">${e.description || ''}</textarea></div>
              <div class="grid-4 tight">
                <div class="field"><label class="label" for="sd">Start date</label><input class="input" type="date" id="sd" name="sd" value="${U.toDateInput(e.starts_at)}"></div>
                <div class="field"><label class="label" for="stime">Start time</label><input class="input" type="time" id="stime" name="stime" value="${U.toTimeInput(e.starts_at)}"></div>
                <div class="field"><label class="label" for="ed">End date</label><input class="input" type="date" id="ed" name="ed" value="${U.toDateInput(e.ends_at)}"></div>
                <div class="field"><label class="label" for="etime">End time</label><input class="input" type="time" id="etime" name="etime" value="${U.toTimeInput(e.ends_at)}"></div>
              </div>
              <p class="help">Leave the dates empty to open and close voting manually from the Dashboard.</p>`);
          },
          async next() {
            const v = UI.formValues(form);
            const data = { name: v.name, subtitle: v.subtitle, academic_year: v.academic_year, description: v.description,
              starts_at: U.fromDateTimeInputs(v.sd, v.stime), ends_at: U.fromDateTimeInputs(v.ed, v.etime) };
            const errs = R.validateElection(data);
            if (errs.ends_at) { errs.ed = errs.ends_at; delete errs.ends_at; }
            if (!errs.ed && data.ends_at && Date.parse(data.ends_at) < Date.now()) errs.ed = 'The end time is in the past.';
            if (Object.keys(errs).length) throw UI.fieldError(errs);
            if (ctx.election) await S.api.updateElection(ctx.election.id, data);
            else await S.api.createElection({ ...data, is_demo: false, results_visibility: 'live', rotation_seconds: 12 });
            await ctx.reload();
            return true;
          },
        },
        /* 3 Positions */ {
          title: 'Positions', sub: 'Which roles are students voting for? Click a suggestion or add your own. Ballot order follows this list.',
          draw() {
            const ps = ctx.bundle.positions;
            const have = new Set(ps.map((p) => p.name.toLowerCase()));
            U.setHtml(body, html`
              <div class="preset-chips">${A.POSITION_PRESETS.filter((n) => !have.has(n.toLowerCase())).map((n) => html`<button type="button" class="chip" data-preset="${n}">${UI.icon('plus', 14)} ${n}</button>`)}
                <button type="button" class="chip chip-strong" data-addpos>${UI.icon('edit', 14)} Custom position…</button></div>
              ${ps.length ? html`<ol class="pos-list compact">${ps.map((p, i) => html`<li class="pos-row" data-id="${p.id}">
                <span class="pos-n tnum">${i + 1}</span><div class="pos-main"><div class="pos-name">${p.name}</div></div>
                <span class="rule-pill">${U.selectionRule(p)}</span>
                <div class="row-actions"><button type="button" class="btn btn-icon btn-ghost" data-editpos aria-label="Edit ${p.name}">${UI.icon('edit', 16)}</button>
                <button type="button" class="btn btn-icon btn-ghost danger" data-delpos aria-label="Remove ${p.name}">${UI.icon('trash', 16)}</button></div></li>`)}</ol>`
                : html`<p class="muted wz-empty">No positions yet — pick from the suggestions above.</p>`}`);
          },
          async next() { if (!ctx.bundle.positions.length) throw new S.ApiError('VALIDATION', 'Add at least one position.'); return true; },
        },
        /* 4 Candidates */ {
          title: 'Candidates', sub: 'Add the candidates for each position. You can add photos, slogans and manifestos now or later.',
          draw() {
            const { positions, candidates } = ctx.bundle;
            U.setHtml(body, html`<div class="wz-cands">${positions.map((p) => {
              const list = candidates.filter((c) => c.position_id === p.id);
              return html`<section class="wz-pos ${list.length ? '' : 'needs'}">
                <header><h3>${p.name}</h3><span class="muted small">${U.plural(list.length, 'candidate')}</span>
                  <button type="button" class="btn btn-secondary btn-sm" data-addcand="${p.id}">${UI.icon('plus', 16)}<span>Add candidate</span></button></header>
                ${list.length ? html`<div class="mini-cands">${list.map((c) => html`<button type="button" class="mini-cand" data-editcand="${c.id}">${UI.avatar(c, 40)}<span><b>${c.name}</b><small>${c.class_name || ''}</small></span></button>`)}</div>`
                  : html`<p class="muted small">No candidates yet.</p>`}
              </section>`;
            })}</div>`);
          },
          async next() {
            const b = ctx.bundle;
            const missing = b.positions.filter((p) => p.active && !b.candidates.some((c) => c.position_id === p.id && c.active));
            if (missing.length) {
              const ok = await UI.confirm({ title: 'Some positions have no candidates', message: `${missing.map((p) => p.name).join(', ')} — you won't be able to open voting until every active position has a candidate. Continue anyway?`, confirmLabel: 'Continue' });
              if (!ok) return false;
            }
            return true;
          },
        },
        /* 5 Voters */ {
          title: 'Voters & voting codes', sub: 'Import your student list to create one secure voting code per student.',
          draw() {
            const v = ctx.bundle.voters;
            U.setHtml(body, html`
              <div class="wz-voters">
                <div class="big-count"><span class="tnum">${U.fmtInt(v.total)}</span><small>voters registered</small></div>
                <div class="wz-options">
                  <article class="option-card"><h3>${UI.icon('upload', 20)} Import a student list</h3>
                    <p class="muted small">CSV with <code>student_reference,class_name</code>. Best when you can hand each code to a named student.</p>
                    <button type="button" class="btn btn-primary" data-import>${UI.icon('upload', 18)}<span>Import CSV</span></button></article>
                  <article class="option-card"><h3>${UI.icon('key', 20)} Generate codes without a list</h3>
                    <p class="muted small">Creates anonymous voters (e.g. 10A-001…) — useful for handing out codes by class.</p>
                    <div class="grid-2 tight">
                      <div class="field"><label class="label" for="gen-n">How many</label><input class="input" type="number" min="1" max="2000" id="gen-n" value="30"></div>
                      <div class="field"><label class="label" for="gen-cls">Class</label><input class="input" id="gen-cls" maxlength="40" placeholder="10A"></div>
                    </div>
                    <button type="button" class="btn btn-secondary" data-generate>${UI.icon('key', 18)}<span>Generate codes</span></button></article>
                </div>
                ${UI.callout('info', 'Codes are shown only once', 'Print or download them straight away. If a code is lost later, issue a new one from the Voters page.')}
              </div>`);
          },
          async next() {
            if (!ctx.bundle.voters.total) {
              const ok = await UI.confirm({ title: 'No voters yet', message: 'You can add voters later from the Voters page, but voting cannot open without them. Continue?', confirmLabel: 'Continue' });
              if (!ok) return false;
            }
            return true;
          },
        },
        /* 6 Rules */ {
          title: 'Voting rules & messages', sub: 'Check how many candidates students choose for each position, and what they see on screen.',
          draw() {
            const e = ctx.election;
            U.setHtml(body, html`
              <div class="table-wrap"><table class="table compact rules-table">
                <thead><tr><th>Position</th><th>Minimum</th><th>Maximum (seats)</th><th>Rule shown to students</th></tr></thead>
                <tbody>${ctx.bundle.positions.map((p) => html`<tr data-id="${p.id}"><td><b>${p.name}</b></td>
                  <td><input class="input input-sm" type="number" min="0" max="20" name="min_${p.id}" value="${p.min_selections}" aria-label="Minimum for ${p.name}"></td>
                  <td><input class="input input-sm" type="number" min="1" max="20" name="max_${p.id}" value="${p.max_selections}" aria-label="Maximum for ${p.name}"></td>
                  <td class="muted">${U.selectionRule(p)}</td></tr>`)}</tbody></table></div>
              <div class="field"><label class="label" for="instructions">Instructions at the top of the ballot</label><textarea class="input" id="instructions" name="instructions" rows="2" maxlength="2000" placeholder="Choose your candidates for each position, then review your vote.">${e.instructions}</textarea></div>
              <div class="field"><label class="label" for="confirmation_message">Message after voting <span class="opt">optional</span></label><input class="input" id="confirmation_message" name="confirmation_message" value="${e.confirmation_message}" maxlength="500" placeholder="Results will be announced in assembly."></div>
              <div class="field"><span class="label">Who can see results during voting?</span>
                <div class="radio-cards">${[['live', 'Everyone, live', 'The projector shows results as votes arrive.'], ['after_close', 'After closing', 'Only turnout until voting closes.'], ['hidden', 'Admins only', 'Results stay private to administrators.']].map(([v, t, d]) => html`
                  <label class="radio-card"><input type="radio" name="results_visibility" value="${v}" ${raw(e.results_visibility === v ? 'checked' : '')}><span><b>${t}</b><small>${d}</small></span></label>`)}</div></div>`);
          },
          async next() {
            const v = UI.formValues(form);
            for (const p of ctx.bundle.positions) {
              const min = Number(v['min_' + p.id]), max = Number(v['max_' + p.id]);
              if (min === p.min_selections && max === p.max_selections) continue;
              const errs = R.validatePosition({ ...p, min_selections: min, max_selections: max });
              if (Object.keys(errs).length) throw UI.fieldError({ ['min_' + p.id]: `${p.name}: ${Object.values(errs)[0]}` });
              await S.api.savePosition({ ...p, min_selections: min, max_selections: max });
            }
            await S.api.updateElection(ctx.election.id, { instructions: v.instructions, confirmation_message: v.confirmation_message, results_visibility: v.results_visibility });
            await ctx.reload();
            return true;
          },
        },
        /* 7 Preview */ {
          title: 'Preview', sub: 'A final check before voting opens.',
          draw() {
            const e = ctx.election, b = ctx.bundle;
            const ready = R.readiness({ school: ctx.school, election: e, positions: b.positions, candidates: b.candidates, eligible: b.voters.active });
            U.setHtml(body, html`
              <div class="ready-card ${ready.ok ? 'ok' : 'todo'}">
                <div class="rc-title">${UI.icon(ready.ok ? 'check' : 'alert', 26)} ${ready.ok ? 'Election ready' : 'Almost ready'}</div>
                <dl class="ready-grid">
                  <div><dt>School</dt><dd>${(ctx.school && ctx.school.name) || '—'}</dd></div>
                  <div><dt>Election</dt><dd>${S.brand.title(e, ctx.school)}</dd></div>
                  <div><dt>Eligible voters</dt><dd class="tnum">${U.fmtInt(b.voters.active)}</dd></div>
                  <div><dt>Positions</dt><dd class="tnum">${b.positions.filter((p) => p.active).length}</dd></div>
                  <div><dt>Candidates</dt><dd class="tnum">${b.candidates.filter((c) => c.active).length}</dd></div>
                  <div><dt>Results</dt><dd>${{ live: 'Live for everyone', after_close: 'After closing', hidden: 'Admins only' }[e.results_visibility]}</dd></div>
                  <div><dt>Start</dt><dd>${e.starts_at ? U.fmtDateTime(e.starts_at) : 'Manual'}</dd></div>
                  <div><dt>End</dt><dd>${e.ends_at ? U.fmtDateTime(e.ends_at) : 'Manual'}</dd></div>
                </dl>
              </div>
              <ul class="checklist">${ready.checks.map((c) => html`<li class="${c.ok ? 'ok' : 'todo'}">${UI.icon(c.ok ? 'check' : 'alert', 18)}<strong>${c.label}</strong><span>${c.detail}</span></li>`)}</ul>
              <p class="muted small">Tip: open <a href="#/vote" target="_blank" rel="noopener noreferrer">a voting station</a> to see the ballot — codes won't work until the election opens. To rehearse end-to-end, use Settings → Demo mode.</p>`);
          },
          async next() { return true; },
        },
        /* 8 Open */ {
          title: 'Open the election', sub: 'Choose when voting starts. You can pause or close it at any time from the Dashboard.',
          draw() {
            const e = ctx.election, b = ctx.bundle;
            const ready = R.readiness({ school: ctx.school, election: e, positions: b.positions, candidates: b.candidates, eligible: b.voters.active });
            U.setHtml(body, html`
              ${!ready.ok ? UI.callout('warn', 'Not ready yet', `Still needed: ${ready.checks.filter((c) => !c.ok).map((c) => c.label).join(', ')}.`) : ''}
              <div class="wz-options three">
                <article class="option-card"><h3>${UI.icon('play', 20)} Open now</h3><p class="muted small">Students can vote immediately.</p>
                  <button type="button" class="btn btn-success" data-open ${ready.ok ? '' : 'disabled'}>${UI.icon('play', 18)}<span>Open election</span></button></article>
                <article class="option-card"><h3>${UI.icon('calendar', 20)} Schedule</h3><p class="muted small">${e.starts_at ? `Opens automatically at ${U.fmtDateTime(e.starts_at)}.` : 'Set a start time in step 2 first.'}</p>
                  <button type="button" class="btn btn-secondary" data-schedule ${ready.ok && e.starts_at && e.status !== 'scheduled' ? '' : 'disabled'}>${UI.icon('calendar', 18)}<span>${e.status === 'scheduled' ? 'Scheduled' : 'Schedule'}</span></button></article>
                <article class="option-card"><h3>${UI.icon('clock', 20)} Later</h3><p class="muted small">Keep it as a ${e.status}. Open it from the Dashboard when you're ready.</p>
                  <a class="btn btn-secondary" href="#/admin/dashboard">Finish setup</a></article>
              </div>`);
          },
          async next() { S.go('/admin/dashboard'); return false; },
        },
      ];

      const draw = () => {
        U.store.set('sge.wizard.step', step);
        drawSteps();
        errBox.hidden = true;
        const v = views[step];
        U.setHtml(body, '');
        v.draw();
        body.insertAdjacentHTML('afterbegin', U.toHtml(html`<div class="wz-title"><span class="wz-count">Step ${step + 1} of ${STEPS.length}</span><h2>${v.title}</h2><p class="muted">${v.sub}</p></div>`));
        U.setHtml(nav, html`
          ${step > 0 ? html`<button type="button" class="btn btn-secondary" data-back>${UI.icon('arrow-left', 18)}<span>Back</span></button>` : html`<span></span>`}
          <span class="spacer"></span>
          <button type="submit" class="btn btn-primary btn-lg">${step === STEPS.length - 1 ? html`<span>Finish</span>${UI.icon('check', 18)}` : html`<span>Save &amp; continue</span>${UI.icon('arrow-right', 18)}`}</button>`);
        const first = body.querySelector('input:not([type=hidden]):not([type=file]), textarea');
        if (first && step <= 1) first.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'start' });
      };

      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        errBox.hidden = true;
        UI.clearFieldErrors(form);
        const btn = nav.querySelector('[type=submit]');
        await UI.busy(btn, async () => {
          try {
            const ok = await views[step].next();
            if (ok) { step = Math.min(STEPS.length - 1, step + 1); draw(); }
          } catch (err) {
            if (err.fields) UI.showFieldErrors(form, err.fields);
            else { errBox.textContent = R.message(err).text; errBox.hidden = false; }
          }
        });
      });
      el.addEventListener('click', async (ev) => {
        const t = ev.target;
        try {
          if (t.closest('[data-back]')) { step = Math.max(0, step - 1); draw(); }
          else if (t.closest('[data-goto]')) { step = Number(t.closest('[data-goto]').dataset.goto); draw(); }
          else if (t.closest('[data-preset]')) {
            const name = t.closest('[data-preset]').dataset.preset;
            await S.api.savePosition({ election_id: ctx.election.id, name, description: '', min_selections: 1, max_selections: /representatives/i.test(name) ? 3 : 1, active: true });
            await ctx.reload(); draw();
          } else if (t.closest('[data-addpos]')) { if (await A.editPosition(ctx)) draw(); }
          else if (t.closest('[data-editpos]')) { const p = ctx.bundle.positions.find((x) => x.id === t.closest('[data-id]').dataset.id); if (await A.editPosition(ctx, p)) draw(); }
          else if (t.closest('[data-delpos]')) {
            const p = ctx.bundle.positions.find((x) => x.id === t.closest('[data-id]').dataset.id);
            if (await UI.confirm({ title: `Remove ${p.name}?`, message: 'Its candidates are removed too.', confirmLabel: 'Remove', danger: true })) { await S.api.deletePosition(p.id); await ctx.reload(); draw(); }
          } else if (t.closest('[data-addcand]')) { if (await A.editCandidate(ctx, null, t.closest('[data-addcand]').dataset.addcand)) draw(); }
          else if (t.closest('[data-editcand]')) { const c = ctx.bundle.candidates.find((x) => x.id === t.closest('[data-editcand]').dataset.editcand); if (await A.editCandidate(ctx, c)) draw(); }
          else if (t.closest('[data-import]')) { await A.importVoters(ctx); await ctx.reload(); draw(); }
          else if (t.closest('[data-generate]')) {
            const n = Number(body.querySelector('#gen-n').value);
            const cls = body.querySelector('#gen-cls').value.trim();
            await UI.busy(t.closest('[data-generate]'), async () => {
              try { await A.generateVoters(ctx, cls, n); }
              catch (err) { if (err.fields) UI.toast(Object.values(err.fields)[0], 'error'); else throw err; }
              draw();
            });
          } else if (t.closest('[data-open]')) { if (await A.changeStatus(ctx, 'open')) S.go('/admin/dashboard'); }
          else if (t.closest('[data-schedule]')) { if (await A.changeStatus(ctx, 'scheduled')) S.go('/admin/dashboard'); }
        } catch (err) { UI.toastError(err); }
      });
      draw();
    },
  };
})(window.SGE);
