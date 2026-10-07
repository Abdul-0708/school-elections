/* ADMINISTRATION  (#/admin/<page>)
   Shell (sign-in, sidebar, LIVE/DEMO workspace switch) + Dashboard + Live Monitor,
   plus helpers shared by the other admin pages (admin-*.js). */
(function (S) {
  'use strict';
  const U = S.util, UI = S.ui, R = S.rules, html = U.html, raw = U.raw;
  const A = (S.admin = { pages: {} });

  A.NAV = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', cap: 'monitor.view' },
    { id: 'election', label: 'Election', icon: 'calendar', cap: 'monitor.view' },
    { id: 'positions', label: 'Positions', icon: 'list', cap: 'monitor.view' },
    { id: 'candidates', label: 'Candidates', icon: 'award', cap: 'monitor.view' },
    { id: 'voters', label: 'Voters', icon: 'users', cap: 'voters.manage' },
    { id: 'codes', label: 'Voting Codes', icon: 'key', cap: 'voters.manage' },
    { id: 'monitor', label: 'Live Monitor', icon: 'activity', cap: 'monitor.view' },
    { id: 'results', label: 'Results', icon: 'chart', cap: 'results.view' },
    { id: 'reports', label: 'Reports', icon: 'file', cap: 'monitor.view' },
    { id: 'settings', label: 'Settings', icon: 'settings', cap: 'monitor.view' },
  ];

  /* In-memory only: voting codes generated during this admin session (never persisted). */
  S.vault = { items: [], add(list, label, electionId) { if (list && list.length) this.items.unshift({ label, electionId, list, at: new Date().toISOString() }); }, clear() { this.items = []; } };
  window.addEventListener('pagehide', () => S.vault.clear());

  /* ------------------------------------------------------------ shared helpers */
  A.head = (eyebrow, title, sub, actions) => html`
    <div class="page-head">
      <div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${sub ? html`<p class="page-sub">${sub}</p>` : ''}</div>
      ${actions ? html`<div class="ph-actions">${actions}</div>` : ''}
    </div>`;

  A.noElection = (ctx) => {
    if (ctx.workspace === 'demo') {
      return UI.empty({ icon: 'flask', title: 'No demo election yet',
        text: 'Create a practice election with sample positions, candidates and voting codes. Demo votes never touch the real election.',
        action: ctx.can('demo.manage') ? html`<button class="btn btn-primary" data-act="create-demo">${UI.icon('sparkles', 18)}<span>Create demo election</span></button>` : html`<p class="muted">Ask a Super Admin to create the demo election.</p>` });
    }
    return UI.empty({ icon: 'sparkles', title: 'No election set up yet',
      text: 'The setup wizard walks you through the school details, positions, candidates and voters.',
      action: ctx.can('election.edit') ? html`<a class="btn btn-primary" href="#/admin/setup">${UI.icon('sparkles', 18)}<span>Start setup wizard</span></a>` : html`<p class="muted">Ask a Super Admin to set up the election.</p>` });
  };

  A.createDemo = async (ctx) => {
    const btns = U.$$('[data-act="create-demo"]');
    btns.forEach((b) => { b.disabled = true; b.classList.add('is-busy'); });
    try {
      const out = await S.demo.create(S.api, ctx.school);
      await ctx.reload();
      UI.toast('Demo election created and open for practice voting.', 'ok');
      if (out.codes && out.codes.length) await A.showCodes(ctx, out.codes, 'Demo voting codes', out.election);
      ctx.refreshPage();
    } catch (e) { UI.toastError(e); btns.forEach((b) => { b.disabled = false; b.classList.remove('is-busy'); }); }
  };

  /* Shows freshly generated codes ONCE, with print + download.  Requires a deliberate close. */
  A.showCodes = (ctx, list, title, election) => {
    const e = election || ctx.election;
    S.vault.add(list, title, e && e.id);
    let saved = false;
    const m = UI.modal({
      title: title || 'New voting codes', size: 'lg', dismissible: false,
      body: html`
        ${UI.callout('warn', `${U.plural(list.length, 'code')} generated — shown only now`, 'Codes are stored as secure fingerprints and cannot be displayed again. Print or download them before closing. (They stay available under Voting Codes until you sign out or close this tab.)')}
        <div class="table-wrap codes-preview"><table class="table">
          <thead><tr><th>Student reference</th><th>Class</th><th>Voting code</th></tr></thead>
          <tbody>${list.slice(0, 8).map((c) => html`<tr><td>${c.student_reference}</td><td>${c.class_name || '—'}</td><td class="mono code-cell">${c.code}</td></tr>`)}</tbody>
        </table></div>
        ${list.length > 8 ? html`<p class="muted small">…and ${U.fmtInt(list.length - 8)} more in the printout / download.</p>` : ''}`,
      footer: html`
        <button class="btn btn-secondary" data-dl>${UI.icon('download', 18)}<span>Download CSV</span></button>
        <button class="btn btn-secondary" data-print>${UI.icon('printer', 18)}<span>Print code cards</span></button>
        <button class="btn btn-primary" data-done>Done</button>`,
    });
    m.el.querySelector('[data-dl]').onclick = () => { S.print.codesCSV(list, e); saved = true; S.api.logAction(e && e.id, 'codes.downloaded', { count: list.length }); };
    m.el.querySelector('[data-print]').onclick = () => { S.print.codes(list, { school: ctx.school, election: e }); saved = true; S.api.logAction(e && e.id, 'codes.printed', { count: list.length }); };
    m.el.querySelector('[data-done]').onclick = async () => {
      if (!saved) {
        const ok = await UI.confirm({ title: 'Close without saving?', message: 'You have not printed or downloaded these codes. They cannot be shown again after you leave this page.', confirmLabel: 'Close anyway', danger: true });
        if (!ok) return;
      }
      m.close(true);
    };
    return m.result;
  };

  /* Election status controls (Open / Pause / Close …). */
  A.statusControls = (ctx) => {
    const e = ctx.election;
    if (!e || !ctx.can('election.status')) return '';
    const vs = R.votingState(e);
    const b = (to, label, icon, cls) => html`<button class="btn ${cls}" data-status="${to}">${UI.icon(icon, 18)}<span>${label}</span></button>`;
    switch (e.status) {
      case 'draft': return html`${b('scheduled', 'Schedule', 'calendar', 'btn-secondary')}${b('open', 'Open election', 'play', 'btn-success')}`;
      case 'scheduled': return vs.state === 'open'
        ? html`${b('paused', 'Pause election', 'pause', 'btn-warn')}${b('closed', 'Close election', 'stop', 'btn-danger')}`
        : html`${b('draft', 'Back to draft', 'arrow-left', 'btn-secondary')}${b('open', 'Open now', 'play', 'btn-success')}`;
      case 'open': return html`${b('paused', 'Pause election', 'pause', 'btn-warn')}${b('closed', 'Close election', 'stop', 'btn-danger')}`;
      case 'paused': return html`${b('open', 'Resume voting', 'play', 'btn-success')}${b('closed', 'Close election', 'stop', 'btn-danger')}`;
      default: return html`<span class="badge tone-danger">${UI.icon('lock', 14)} Final results locked</span>`;
    }
  };

  A.changeStatus = async (ctx, to) => {
    const e = ctx.election;
    let phrase = null;
    if (to === 'closed') {
      phrase = await UI.confirm({
        title: 'Close the election?', danger: true, icon: 'lock', confirmLabel: 'Close election', phrase: R.PHRASES.close, size: 'md',
        message: html`<p><strong>Are you sure you want to close the election?</strong> Voting will immediately stop and final results will be locked.</p><p class="muted">This cannot be undone. Winners will be declared from the recorded ballots.</p>`,
      });
      if (!phrase) return false;
    } else if (to === 'open') {
      const ok = await UI.confirm({
        title: e.status === 'paused' ? 'Resume voting?' : 'Open the election?', icon: 'play', confirmLabel: e.status === 'paused' ? 'Resume voting' : 'Open election',
        message: html`<p>Students will be able to vote immediately at every voting station.</p>${e.is_demo ? '' : html`<p class="muted">This is the <strong>live election</strong>. Every vote counts.</p>`}`,
      });
      if (!ok) return false;
    } else if (to === 'paused') {
      const ok = await UI.confirm({ title: 'Pause voting?', icon: 'pause', confirmLabel: 'Pause voting', message: 'Stations stop accepting codes and ballots until you resume. Votes already cast are safe.' });
      if (!ok) return false;
    } else if (to === 'scheduled') {
      if (!e.starts_at) { await UI.alert('Set a start time first', 'Go to Election and set the start date and time, then schedule the election.'); return false; }
      const ok = await UI.confirm({ title: 'Schedule the election?', icon: 'calendar', confirmLabel: 'Schedule', message: `Voting will open automatically at ${U.fmtDateTime(e.starts_at)}${e.ends_at ? ` and stop at ${U.fmtDateTime(e.ends_at)}` : ''}.` });
      if (!ok) return false;
    } else if (to === 'draft') {
      const ok = await UI.confirm({ title: 'Return to draft?', confirmLabel: 'Return to draft', message: 'The election will no longer open automatically.' });
      if (!ok) return false;
    }
    try {
      await S.api.setStatus(e.id, to, phrase);
      UI.toast({ open: 'Election is open. Voting has started.', paused: 'Voting paused.', closed: 'Election closed. Final results are locked.', scheduled: 'Election scheduled.', draft: 'Election returned to draft.' }[to], to === 'closed' ? 'info' : 'ok');
      await ctx.reload();
      ctx.refreshPage();
      return true;
    } catch (err) {
      if (err.code === 'NOT_READY') await UI.alert('Not ready to open', err.message, 'warn');
      else UI.toastError(err);
      return false;
    }
  };

  /* ------------------------------------------------------------ sign-in */
  async function renderLogin(root, onDone) {
    const bootstrap = await S.api.auth.needsBootstrap();
    const school = S.state.pub && S.state.pub.school;
    U.setHtml(root, html`
      <div class="auth">
        <section class="auth-card">
          <a class="back-link" href="#/">${UI.icon('arrow-left', 16)} Election home</a>
          <div class="auth-logo">${UI.logo(school, 64)}</div>
          <h1>${bootstrap ? 'Create the first administrator' : 'Administrator sign in'}</h1>
          <p class="muted">${bootstrap ? 'This account becomes the Super Admin for this election system.' : `Election management${school ? ' for ' + school.name : ''}`}</p>
          <form class="form" novalidate>
            <div class="field"><label class="label" for="em">Email</label><input class="input input-lg" id="em" name="email" type="email" autocomplete="username" required autofocus></div>
            <div class="field"><label class="label" for="pw">Password</label><input class="input input-lg" id="pw" name="password" type="password" autocomplete="${bootstrap ? 'new-password' : 'current-password'}" required minlength="8"></div>
            ${bootstrap ? html`<div class="field"><label class="label" for="pw2">Confirm password</label><input class="input input-lg" id="pw2" name="password2" type="password" autocomplete="new-password" required></div>` : ''}
            <div class="form-error" role="alert" hidden></div>
            <button class="btn btn-primary btn-lg btn-block" type="submit">${UI.icon(bootstrap ? 'shield' : 'lock', 18)}<span>${bootstrap ? 'Create account & continue' : 'Sign in'}</span></button>
          </form>
          ${S.api.mode === 'local'
            ? UI.callout('warn', 'Local demo mode', 'Accounts and data live only in this browser. Connect Supabase (see README) for the real election.')
            : html`<p class="muted small">Accounts are managed in Supabase Authentication. New administrators must be granted a role by a Super Admin.</p>`}
        </section>
        <aside class="auth-side" aria-hidden="true">
          <div class="as-inner">
            <div class="as-mark">${UI.icon('ballot', 40)}</div>
            <p class="as-line">Every student gets one voice.</p>
            <p class="as-line">Every vote counts.</p>
            <p class="as-line">Every result is transparent.</p>
          </div>
        </aside>
      </div>`);
    const form = root.querySelector('form');
    const errBox = form.querySelector('.form-error');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      errBox.hidden = true;
      const v = UI.formValues(form);
      const btn = form.querySelector('button[type=submit]');
      await UI.busy(btn, async () => {
        try {
          if (bootstrap) {
            if (v.password !== v.password2) throw new S.ApiError('VALIDATION', 'The passwords do not match.');
            await S.api.auth.bootstrap(v.email, v.password);
          } else await S.api.auth.signIn(v.email, v.password);
          onDone();
        } catch (e) {
          errBox.textContent = R.message(e).text;
          errBox.hidden = false;
          form.querySelector('#pw').select();
        }
      });
    });
  }

  /* ------------------------------------------------------------ shell */
  S.views.admin = {
    async mount(root, params) {
      const pageId = params[0] || 'dashboard';
      root.className = 'view-admin';
      S.brand.setDocTitle('Administration');
      let me = await S.api.auth.current();
      if (!me) return renderLogin(root, () => S.rerender());
      if (!me.role) {
        U.setHtml(root, html`<div class="page-center">${UI.empty({ icon: 'lock', title: 'No administrator access', text: `${me.email} is signed in but has not been given an election role. Ask a Super Admin to grant access.`, action: html`<button class="btn btn-secondary" data-signout>${UI.icon('logout', 18)}<span>Sign out</span></button>` })}</div>`);
        root.querySelector('[data-signout]').onclick = async () => { await S.api.auth.signOut(); S.rerender(); };
        return;
      }

      const can = (cap) => R.can(me.role, cap);
      let workspace = U.store.get('sge.admin.workspace', 'live') === 'demo' ? 'demo' : 'live';
      let pageCleanup = null;
      let unsub = null;
      const ctx = {
        me, can, workspace, school: null, election: null, bundle: null,
        async reload() {
          const pub = await S.refreshPublic();
          ctx.school = pub.school;
          ctx.workspace = workspace;
          ctx.election = pub[workspace] || null;
          ctx.bundle = ctx.election ? await S.api.getBundle(ctx.election.id) : null;
          renderTopbar();
          return ctx;
        },
        refreshPage: () => showPage(),
        go: (id) => S.go('/admin/' + id),
      };
      await ctx.reload();

      // First run: no school yet → straight to the setup wizard.
      if (!ctx.school && can('school.edit') && pageId === 'dashboard') { S.go('/admin/setup'); return; }

      U.setHtml(root, html`
        <div class="admin" id="admin">
          <aside class="sidebar" id="sidebar" aria-label="Administration menu">
            <div class="sb-head"><span id="sb-logo"></span><div class="sb-head-t"><div class="sb-school" id="sb-school"></div><div class="sb-app">Election control</div></div>
              <button class="btn btn-icon btn-ghost sb-close" data-act="nav-close" aria-label="Close menu">${UI.icon('x')}</button></div>
            <div class="ws" role="group" aria-label="Workspace">
              <button class="ws-btn" data-ws="live">${UI.icon('live', 16)}<span>Live election</span></button>
              <button class="ws-btn demo" data-ws="demo">${UI.icon('flask', 16)}<span>Demo</span></button>
            </div>
            <nav class="nav" id="nav"></nav>
            <div class="sb-foot">
              <div class="me"><span class="me-av">${U.initials(me.email)}</span><div class="me-t"><div class="me-email" title="${me.email}">${me.email}</div><div class="me-role">${R.ROLES[me.role].label}</div></div></div>
              <button class="btn btn-ghost btn-sm btn-block" data-act="signout">${UI.icon('logout', 16)}<span>Sign out</span></button>
              <div class="sb-mode">${S.api.label}</div>
            </div>
          </aside>
          <div class="admin-main">
            <header class="topbar" id="topbar"></header>
            <div class="demo-banner" id="demo-banner" role="note">${UI.icon('flask', 18)}<span><strong>DEMO MODE · NO REAL VOTES.</strong> Everything here is practice data, completely separate from the live election.</span></div>
            <main class="page" id="page" tabindex="-1"></main>
          </div>
          <div class="scrim" data-act="nav-close"></div>
        </div>`);
      let page = root.querySelector('#page');

      function renderNav() {
        U.setHtml(root.querySelector('#nav'), html`${A.NAV.filter((n) => can(n.cap)).map((n) => html`
          <a class="nav-link ${n.id === current ? 'active' : ''}" href="#/admin/${n.id}" ${n.id === current ? raw('aria-current="page"') : ''}>${UI.icon(n.icon, 20)}<span>${n.label}</span></a>`)}
          ${can('election.edit') ? html`<a class="nav-link subtle ${current === 'setup' ? 'active' : ''}" href="#/admin/setup">${UI.icon('sparkles', 20)}<span>Setup wizard</span></a>` : ''}`);
        U.$$('.ws-btn', root).forEach((b) => { b.classList.toggle('on', b.dataset.ws === workspace); b.setAttribute('aria-pressed', String(b.dataset.ws === workspace)); });
        U.setHtml(root.querySelector('#sb-logo'), UI.logo(ctx.school, 38));
        root.querySelector('#sb-school').textContent = (ctx.school && ctx.school.name) || 'Student Elections';
      }
      function renderTopbar() {
        const tb = root.querySelector('#topbar');
        if (!tb) return;
        const e = ctx.election;
        const sfx = workspace === 'demo' ? '/demo' : '';
        root.querySelector('#admin').classList.toggle('is-demo', workspace === 'demo');
        U.setHtml(tb, html`
          <button class="btn btn-icon btn-ghost menu-btn" data-act="nav-open" aria-label="Open menu">${UI.icon('menu')}</button>
          <div class="tb-title">
            <span class="mode-badge ${workspace}">${workspace === 'demo' ? html`${UI.icon('flask', 14)} DEMO` : html`<span class="dot"></span> LIVE ELECTION`}</span>
            <span class="tb-election">${e ? e.name : 'No election yet'}</span>
            ${e ? UI.statusPill(R.votingState(e)) : ''}
          </div>
          <div class="tb-actions">
            <a class="btn btn-secondary btn-sm" href="#/vote${sfx}" target="_blank" rel="noopener noreferrer">${UI.icon('ballot', 16)}<span>Voting station</span></a>
            <a class="btn btn-secondary btn-sm" href="#/results${sfx}" target="_blank" rel="noopener noreferrer">${UI.icon('monitor', 16)}<span>Results screen</span></a>
          </div>`);
      }

      let current = pageId;
      async function showPage() {
        if (pageCleanup) { try { pageCleanup(); } catch (e) { console.error(e); } pageCleanup = null; }
        // A fresh container per render, so listeners from a previous render can never fire twice.
        const fresh = page.cloneNode(false);
        page.replaceWith(fresh);
        page = fresh;
        const def = current === 'setup' ? S.admin.pages.setup : A.pages[current];
        renderNav();
        renderTopbar();
        if (!def || (def.cap && !can(def.cap))) {
          U.setHtml(page, UI.empty({ icon: 'lock', title: 'Not available', text: 'Your role does not include this section.', action: html`<a class="btn btn-secondary" href="#/admin/dashboard">Go to dashboard</a>` }));
          return;
        }
        S.brand.setDocTitle(def.title, ctx.school);
        if (def.needsElection && !ctx.election) { U.setHtml(page, html`${A.head(def.title, def.title)}${A.noElection(ctx)}`); return; }
        U.setHtml(page, UI.skeleton(4));
        try {
          pageCleanup = (await def.render(page, ctx)) || null;
        } catch (e) {
          console.error(e);
          U.setHtml(page, UI.errorState(e));
          const r = page.querySelector('[data-retry]');
          if (r) r.onclick = () => ctx.reload().then(showPage).catch(UI.toastError);
        }
      }

      const onClick = async (e) => {
        const t = e.target;
        const ws = t.closest('[data-ws]');
        if (ws && ws.dataset.ws !== workspace) {
          workspace = ws.dataset.ws;
          U.store.set('sge.admin.workspace', workspace);
          try { await ctx.reload(); } catch (err) { UI.toastError(err); }
          UI.toast(workspace === 'demo' ? 'Switched to DEMO mode — no real votes.' : 'Switched to the LIVE election.', workspace === 'demo' ? 'warn' : 'info');
          watch();
          showPage();
          return;
        }
        const act = t.closest('[data-act]');
        if (act) {
          const a = act.dataset.act;
          if (a === 'signout') { await S.api.auth.signOut(); S.vault.clear(); S.go('/'); }
          else if (a === 'nav-open') root.querySelector('#admin').classList.add('nav-open');
          else if (a === 'nav-close') root.querySelector('#admin').classList.remove('nav-open');
          else if (a === 'create-demo') A.createDemo(ctx);
          return;
        }
        const st = t.closest('[data-status]');
        if (st) { A.changeStatus(ctx, st.dataset.status); return; }
        if (t.closest('.nav-link')) root.querySelector('#admin').classList.remove('nav-open');
      };
      root.addEventListener('click', onClick);

      // Keep the top bar status in sync with changes made elsewhere.
      function watch() {
        if (unsub) unsub();
        unsub = null;
        if (!ctx.election) return;
        let lastKey = `${ctx.election.status}`;
        unsub = S.api.subscribe(ctx.election.id, U.throttle(async (evt) => {
          if (evt.type === 'vote' || evt.type === 'station' || evt.type === 'realtime') return;
          const status = evt.pulse ? evt.pulse.status : null;
          if (status && status === lastKey && evt.type === 'pulse') return;
          lastKey = status || lastKey;
          try { const pub = await S.refreshPublic(); ctx.election = pub[workspace]; renderTopbar(); } catch (e) { /* ignore */ }
        }, 2000));
      }
      watch();
      await showPage();

      return () => {
        if (pageCleanup) try { pageCleanup(); } catch (e) { /* ignore */ }
        if (unsub) unsub();
        root.removeEventListener('click', onClick);
      };
    },
  };

  /* ================================================================== Dashboard */
  A.pages.dashboard = {
    title: 'Dashboard', cap: 'monitor.view', needsElection: true,
    async render(el, ctx) {
      const e = ctx.election, b = ctx.bundle;
      const draw = async () => {
        const mon = await S.api.getMonitor(e.id);
        const audit = ctx.can('audit.view') ? await S.api.listAudit(e.id, 8) : [];
        const vs = R.votingState(e);
        const ready = R.readiness({ school: ctx.school, election: e, positions: b.positions, candidates: b.candidates, eligible: b.voters.active });
        const sfx = e.is_demo ? '/demo' : '';
        U.setHtml(el, html`
          ${A.head(e.is_demo ? 'Demo election' : 'Live election', e.name, html`${e.academic_year || ''} · ${vs.label}${e.opened_at ? ` · opened ${U.fmtDateTime(e.opened_at)}` : ''}`, A.statusControls(ctx))}
          ${(e.status === 'draft' || e.status === 'scheduled') && !ready.ok ? html`
            <section class="card card-pad readiness">
              <div class="card-title">${UI.icon('info', 20)} Before you can open voting</div>
              <ul class="checklist">${ready.checks.map((c) => html`<li class="${c.ok ? 'ok' : 'todo'}">${UI.icon(c.ok ? 'check' : 'alert', 18)}<strong>${c.label}</strong><span>${c.detail}</span></li>`)}</ul>
              ${ctx.can('election.edit') ? html`<a class="btn btn-primary" href="#/admin/setup">${UI.icon('sparkles', 18)}<span>Continue setup wizard</span></a>` : ''}
            </section>` : ''}
          <div class="stat-grid">
            ${UI.statCard({ label: 'Eligible voters', value: U.fmtInt(mon.eligible), icon: 'users', id: 'st-eligible' })}
            ${UI.statCard({ label: 'Votes cast', value: U.fmtInt(mon.cast), icon: 'ballot', tone: 'brand', id: 'st-cast' })}
            ${UI.statCard({ label: 'Remaining', value: U.fmtInt(mon.remaining), icon: 'clock', id: 'st-remaining' })}
            ${UI.statCard({ label: 'Turnout', value: U.fmtPct(mon.turnout), icon: 'activity', tone: 'ok', id: 'st-turnout' })}
            ${UI.statCard({ label: 'Positions', value: U.fmtInt(b.positions.filter((p) => p.active).length), icon: 'list' })}
            ${UI.statCard({ label: 'Candidates', value: U.fmtInt(b.candidates.filter((c) => c.active).length), icon: 'award' })}
            ${UI.statCard({ label: 'Election status', value: html`<span class="stat-status tone-${vs.tone}">${R.STATUS[e.status].label}</span>`, icon: 'shield', sub: vs.state === 'open' ? 'Accepting votes' : vs.label })}
          </div>
          <section class="card card-pad turnout-card">
            <div class="tc-top"><div><div class="card-title">Turnout</div><div class="muted">${U.fmtInt(mon.cast)} of ${U.fmtInt(mon.eligible)} eligible voters</div></div>
              <div class="tc-big tnum">${U.fmtPct(mon.turnout)}</div></div>
            ${UI.progress(mon.turnout, { big: true, label: 'Turnout' })}
            <div class="tc-meta"><span>${UI.icon('clock', 16)} Last vote: <b>${mon.last_vote_at ? U.fmtTime(mon.last_vote_at, true) : '—'}</b></span>
              <span>${UI.icon('monitor', 16)} Active voting stations: <b>${mon.active_stations}</b></span>
              <span>${UI.icon('ballot', 16)} Votes today: <b>${U.fmtInt(mon.votes_today)}</b></span></div>
          </section>
          <div class="grid-2">
            <section class="card card-pad">
              <div class="card-title">Quick actions</div>
              <div class="quick">
                <a class="quick-item" href="#/vote${sfx}" target="_blank" rel="noopener noreferrer">${UI.icon('ballot', 22)}<div><b>Open a voting station</b><span>Full-screen ballot for the computer lab</span></div>${UI.icon('external', 16)}</a>
                <a class="quick-item" href="#/results${sfx}" target="_blank" rel="noopener noreferrer">${UI.icon('monitor', 22)}<div><b>Open the results screen</b><span>For the projector or Smartboard</span></div>${UI.icon('external', 16)}</a>
                ${ctx.can('voters.manage') ? html`<a class="quick-item" href="#/admin/codes">${UI.icon('printer', 22)}<div><b>Print voting codes</b><span>Code cards for each class</span></div>${UI.icon('chevron-right', 16)}</a>` : ''}
                <a class="quick-item" href="#/admin/monitor">${UI.icon('activity', 22)}<div><b>Live monitor</b><span>Turnout by class and stations</span></div>${UI.icon('chevron-right', 16)}</a>
              </div>
            </section>
            <section class="card card-pad">
              <div class="card-title">Recent activity</div>
              ${audit.length ? html`<ul class="activity">${audit.map((a) => html`<li><span class="act-dot"></span><div><b>${A.actionLabel(a.action)}</b><span>${a.actor_email || 'system'} · ${U.relTime(a.created_at)}</span></div></li>`)}</ul>`
                : html`<p class="muted">${ctx.can('audit.view') ? 'No activity yet.' : 'Activity is visible to election administrators.'}</p>`}
            </section>
          </div>`);
      };
      await draw();
      const live = U.throttle(async () => {
        try {
          const mon = await S.api.getMonitor(e.id);
          U.animateNumber(el.querySelector('#st-cast'), mon.cast);
          U.animateNumber(el.querySelector('#st-remaining'), mon.remaining);
          U.animateNumber(el.querySelector('#st-eligible'), mon.eligible);
          const t = el.querySelector('#st-turnout'); if (t) t.textContent = U.fmtPct(mon.turnout);
          const big = el.querySelector('.tc-big'); if (big) big.textContent = U.fmtPct(mon.turnout);
          const f = el.querySelector('.turnout-card .progress-fill'); if (f) f.style.width = `${U.clamp(mon.turnout, 0, 100)}%`;
          const meta = el.querySelector('.tc-meta');
          if (meta) U.setHtml(meta, html`<span>${UI.icon('clock', 16)} Last vote: <b>${mon.last_vote_at ? U.fmtTime(mon.last_vote_at, true) : '—'}</b></span><span>${UI.icon('monitor', 16)} Active voting stations: <b>${mon.active_stations}</b></span><span>${UI.icon('ballot', 16)} Votes today: <b>${U.fmtInt(mon.votes_today)}</b></span>`);
        } catch (err) { /* keep last values */ }
      }, 2000);
      const unsub = S.api.subscribe(e.id, (evt) => { if (evt.type !== 'realtime') live(); });
      const t = setInterval(live, 20000);
      return () => { unsub(); clearInterval(t); };
    },
  };

  A.actionLabel = (a) => ({
    'election.created': 'Election created', 'election.updated': 'Election settings changed', 'election.opened': 'Election opened',
    'election.paused': 'Election paused', 'election.closed': 'Election closed', 'election.scheduled': 'Election scheduled',
    'election.returned_to_draft': 'Returned to draft', 'election.archived': 'Election archived',
    'position.added': 'Position added', 'position.edited': 'Position edited', 'position.removed': 'Position removed',
    'candidate.added': 'Candidate added', 'candidate.edited': 'Candidate edited', 'candidate.removed': 'Candidate removed',
    'voters.imported': 'Voters imported', 'voter.removed': 'Voter removed', 'voter.activated': 'Voter activated', 'voter.deactivated': 'Voter deactivated',
    'codes.regenerated': 'New voting codes issued', 'codes.printed': 'Voting codes printed', 'codes.downloaded': 'Voting codes downloaded',
    'results.viewed': 'Results viewed', 'export.generated': 'Export generated', 'report.printed': 'Results report printed',
    'school.updated': 'School branding updated', 'admin.role_granted': 'Administrator role granted', 'admin.revoked': 'Administrator removed',
    'admin.signed_in': 'Administrator signed in', 'admin.bootstrap': 'First administrator created', 'demo.reset': 'Demo election reset', 'demo.simulated': 'Demo votes simulated',
  }[a] || a);

  /* ================================================================== Live monitor */
  A.pages.monitor = {
    title: 'Live Monitor', cap: 'monitor.view', needsElection: true,
    async render(el, ctx) {
      const e = ctx.election;
      async function draw() {
        const m = await S.api.getMonitor(e.id);
        const vs = R.votingState(m.election || e);
        const maxHour = Math.max(1, ...m.by_hour.map((h) => h.votes));
        U.setHtml(el, html`
          ${A.head('Live monitor', 'Election monitor', 'Updates automatically as votes arrive. No individual choices are ever shown.', A.statusControls(ctx))}
          <section class="monitor-hero tone-${vs.tone}">
            <div class="mh-status"><span class="mh-dot"></span><div><div class="mh-label">Election</div><div class="mh-value">${vs.label.replace(/^Election /i, '').toUpperCase()}</div></div></div>
            <div class="mh-item"><div class="mh-label">Votes today</div><div class="mh-value tnum">${U.fmtInt(m.votes_today)}</div></div>
            <div class="mh-item"><div class="mh-label">Last vote</div><div class="mh-value tnum">${m.last_vote_at ? U.fmtTime(m.last_vote_at, true) : '—'}</div></div>
            <div class="mh-item"><div class="mh-label">Turnout</div><div class="mh-value tnum">${U.fmtPct(m.turnout)}</div></div>
            <div class="mh-item"><div class="mh-label">Active voting stations</div><div class="mh-value tnum">${m.active_stations}</div></div>
          </section>
          <div class="grid-2">
            <section class="card card-pad">
              <div class="card-title">Votes per hour</div>
              ${m.by_hour.length ? html`<div class="hour-chart" role="img" aria-label="Votes per hour">${m.by_hour.map((h) => html`
                <div class="hc-col"><span class="hc-n tnum">${h.votes}</span><div class="hc-bar" style="height:${(h.votes / maxHour) * 100}%"></div><span class="hc-l">${U.fmtTime(h.hour)}</span></div>`)}</div>`
                : html`<p class="muted">No votes yet.</p>`}
              <p class="muted small">Ballot times are stored to the hour only, to protect secrecy.</p>
            </section>
            <section class="card card-pad">
              <div class="card-title">Voting stations</div>
              ${m.stations.length ? html`<ul class="stations">${m.stations.slice(0, 30).map((s) => {
                const on = Date.now() - Date.parse(s.last_seen_at) < 90e3;
                return html`<li><span class="st-dot ${on ? 'on' : ''}"></span><b>${s.label || s.id}</b><span class="muted">${on ? 'Online' : 'Last seen ' + U.relTime(s.last_seen_at)}</span></li>`;
              })}</ul>` : html`<p class="muted">No stations have connected yet. Open <b>#/vote</b> on each lab computer.</p>`}
            </section>
          </div>
          <section class="card card-pad">
            <div class="card-title">Turnout by class</div>
            ${m.by_class.length ? html`<div class="table-wrap"><table class="table">
              <thead><tr><th>Class</th><th class="num">Eligible</th><th class="num">Voted</th><th class="num">Remaining</th><th style="width:40%">Turnout</th></tr></thead>
              <tbody>${m.by_class.map((c) => { const p = U.pct(c.voted, c.eligible); return html`<tr><td><b>${c.class_name}</b></td><td class="num">${U.fmtInt(c.eligible)}</td><td class="num">${U.fmtInt(c.voted)}</td><td class="num">${U.fmtInt(c.eligible - c.voted)}</td>
                <td><div class="inline-bar">${UI.progress(p)}<span class="tnum">${U.fmtPct(p)}</span></div></td></tr>`; })}</tbody></table></div>`
              : html`<p class="muted">No voters registered yet.</p>`}
          </section>`);
      }
      await draw();
      const redraw = U.throttle(() => draw().catch(() => {}), 2500);
      const unsub = S.api.subscribe(e.id, (evt) => { if (evt.type !== 'realtime') redraw(); });
      const t = setInterval(redraw, 15000);
      return () => { unsub(); clearInterval(t); };
    },
  };
})(window.SGE);
