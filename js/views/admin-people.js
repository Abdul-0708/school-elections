/* ADMIN: Voters (register, CSV import) · Voting codes (issue, print, download). */
(function (S) {
  'use strict';
  const U = S.util, UI = S.ui, R = S.rules, html = U.html, raw = U.raw;
  const A = S.admin;

  /* ---------------------------------------------------------------- CSV import */
  A.parseVoterCSV = (text) => {
    const rows = U.parseCSV(text);
    if (!rows.length) return { valid: [], problems: [], total: 0 };
    let refCol = 0, clsCol = 1, start = 0;
    const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    if (head.some((h) => /student_?ref|reference|admission|student_?id/.test(h))) {
      refCol = head.findIndex((h) => /student_?ref|reference|admission|student_?id/.test(h));
      clsCol = head.findIndex((h) => /class|form|year|grade|stream/.test(h));
      start = 1;
    }
    const seen = new Set(), valid = [], problems = [];
    rows.slice(start).forEach((r, i) => {
      const ref = String(r[refCol] || '').trim(), cls = clsCol >= 0 ? String(r[clsCol] || '').trim() : '';
      const line = i + start + 1;
      if (!ref) return problems.push({ line, ref: '(blank)', reason: 'Missing student reference' });
      if (ref.length > 64 || cls.length > 40) return problems.push({ line, ref, reason: 'Value too long' });
      if (seen.has(ref.toLowerCase())) return problems.push({ line, ref, reason: 'Duplicate in this file' });
      seen.add(ref.toLowerCase());
      valid.push({ student_reference: ref, class_name: cls });
    });
    return { valid, problems, total: rows.length - start };
  };

  A.importVoters = (ctx) => {
    let parsed = { valid: [], problems: [], total: 0 };
    const m = UI.modal({
      title: 'Import voters', size: 'lg',
      body: html`
        <p class="muted">Use a CSV file with the columns <code>student_reference,class_name</code>. A secure, unique voting code is generated for every student.</p>
        ${UI.callout('info', 'Keep personal data to a minimum', 'Use admission numbers or another school ID as the student reference — names are not needed for voting.')}
        <label class="dropzone" id="dz">
          <input type="file" accept=".csv,text/csv,text/plain" id="csv-file" class="sr-only">
          ${UI.icon('upload', 28)}<b>Choose a CSV file</b><span>or drop it here</span>
        </label>
        <details class="paste"><summary>…or paste the rows instead</summary>
          <textarea class="input mono" id="csv-text" rows="5" placeholder="student_reference,class_name&#10;ADM-1001,10A&#10;ADM-1002,10B"></textarea>
        </details>
        <div id="csv-preview" aria-live="polite"></div>`,
      footer: html`
        <button class="btn btn-ghost" data-template>${UI.icon('download', 16)}<span>CSV template</span></button>
        <span class="spacer"></span>
        <button class="btn btn-secondary" data-close>Cancel</button>
        <button class="btn btn-primary" data-import disabled>${UI.icon('key', 18)}<span>Import &amp; generate codes</span></button>`,
    });
    const el = m.el;
    const preview = el.querySelector('#csv-preview');
    const btn = el.querySelector('[data-import]');
    const show = (text) => {
      parsed = A.parseVoterCSV(text);
      btn.disabled = !parsed.valid.length;
      btn.querySelector('span').textContent = parsed.valid.length ? `Import ${U.fmtInt(parsed.valid.length)} voters & generate codes` : 'Import & generate codes';
      if (!parsed.total) { U.setHtml(preview, ''); return; }
      U.setHtml(preview, html`
        <div class="import-summary">
          <span class="badge tone-ok">${UI.icon('check', 14)} ${U.plural(parsed.valid.length, 'voter')} ready</span>
          ${parsed.problems.length ? html`<span class="badge tone-warn">${UI.icon('alert', 14)} ${U.plural(parsed.problems.length, 'row')} skipped</span>` : ''}
          <span class="muted small">Existing voters with the same reference are skipped automatically.</span>
        </div>
        <div class="table-wrap"><table class="table compact"><thead><tr><th>Student reference</th><th>Class</th></tr></thead>
          <tbody>${parsed.valid.slice(0, 6).map((r) => html`<tr><td>${r.student_reference}</td><td>${r.class_name || '—'}</td></tr>`)}</tbody></table></div>
        ${parsed.valid.length > 6 ? html`<p class="muted small">…and ${U.fmtInt(parsed.valid.length - 6)} more</p>` : ''}
        ${parsed.problems.length ? html`<details class="problems"><summary>Show skipped rows</summary><ul>${parsed.problems.slice(0, 50).map((p) => html`<li>Line ${p.line}: <b>${p.ref}</b> — ${p.reason}</li>`)}</ul></details>` : ''}`);
    };
    const readFile = (f) => {
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) return UI.toast('That file is larger than 5 MB.', 'error');
      const reader = new FileReader();
      reader.onload = () => show(String(reader.result || ''));
      reader.readAsText(f);
    };
    el.querySelector('#csv-file').addEventListener('change', (e) => readFile(e.target.files[0]));
    const dz = el.querySelector('#dz');
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); readFile(e.dataTransfer.files[0]); });
    el.querySelector('#csv-text').addEventListener('input', U.debounce((e) => show(e.target.value), 250));
    el.querySelector('[data-template]').addEventListener('click', () => U.download('voters-template.csv', U.toCSV([['student_reference', 'class_name'], ['ADM-1001', '10A'], ['ADM-1002', '10A'], ['ADM-1003', '10B']])));
    btn.addEventListener('click', () => UI.busy(btn, async () => {
      try {
        const out = await S.api.importVoters(ctx.election.id, parsed.valid);
        m.close(true);
        await ctx.reload();
        UI.toast(`${U.plural(out.created.length, 'voter')} imported${out.skipped.length ? `, ${out.skipped.length} skipped` : ''}.`);
        if (out.created.length) await A.showCodes(ctx, out.created, `${U.plural(out.created.length, 'new voting code')}`);
        ctx.refreshPage();
      } catch (e) { UI.toastError(e); }
    }));
    return m.result;
  };

  A.addVoter = (ctx) => UI.formModal({
    title: 'Add a voter', submitLabel: 'Add & generate code',
    body: html`
      <div class="field"><label class="label" for="v-ref">Student reference</label><input class="input" id="v-ref" name="student_reference" maxlength="64" required autofocus placeholder="Admission number"></div>
      <div class="field"><label class="label" for="v-cls">Class</label><input class="input" id="v-cls" name="class_name" maxlength="40" placeholder="e.g. 10A"></div>`,
    onSubmit: async (v) => {
      if (!v.student_reference) throw UI.fieldError({ student_reference: 'Enter the student reference.' });
      const out = await S.api.importVoters(ctx.election.id, [v]);
      if (!out.created.length) throw UI.fieldError({ student_reference: (out.skipped[0] && out.skipped[0].reason) || 'This voter could not be added.' });
      return out.created;
    },
  }).result.then(async (created) => {
    if (!created || created === true) return false;
    await ctx.reload();
    await A.showCodes(ctx, created, 'New voting code');
    return true;
  });

  /* Creates `count` new voters in a class, each with a fresh code (for schools without a
     student list).  References continue after the highest existing number for that class,
     e.g. 10A-001, 10A-002 …, so deleting voters never causes clashes. */
  A.generateVoters = async (ctx, className, count) => {
    const cls = String(className || '').trim();
    const n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n < 1 || n > 2000) throw UI.fieldError({ count: 'Enter a number from 1 to 2000.' });
    if (cls.length > 40) throw UI.fieldError({ class_name: 'Keep the class name under 40 characters.' });
    const prefix = (cls.replace(/[^A-Za-z0-9]+/g, '').toUpperCase() || 'V').slice(0, 20);
    const existing = await S.api.listVoters(ctx.election.id, { q: prefix + '-', page: 0, pageSize: 5000 });
    const re = new RegExp('^' + prefix + '-(\\d+)$', 'i');
    let max = 0;
    existing.rows.forEach((v) => { const m = re.exec(v.student_reference); if (m) max = Math.max(max, Number(m[1])); });
    const rows = Array.from({ length: n }, (_, i) => ({ student_reference: `${prefix}-${String(max + i + 1).padStart(3, '0')}`, class_name: cls }));
    const out = await S.api.importVoters(ctx.election.id, rows);
    await ctx.reload();
    if (!out.created.length) {
      UI.toast(`No codes were created${out.skipped[0] ? ` (${out.skipped[0].reason})` : ''}.`, 'warn', 7000);
      return out;
    }
    await A.showCodes(ctx, out.created, `${U.plural(out.created.length, 'voting code')} — ${cls || 'no class'}`);
    return out;
  };

  /* ================================================================== Voters */
  A.pages.voters = {
    title: 'Voters', cap: 'voters.manage', needsElection: true,
    async render(el, ctx) {
      const e = ctx.election;
      const st = { q: '', cls: '', status: '', page: 0, pageSize: 50 };
      const editable = e.status !== 'closed';
      const classes = await S.api.listClasses(e.id);
      U.setHtml(el, html`
        ${A.head('Voter register', 'Voters', 'Eligible students and whether they have voted. How anyone voted is never recorded against them.',
          editable ? html`<button class="btn btn-secondary" data-act-add>${UI.icon('plus', 18)}<span>Add voter</span></button>
            <button class="btn btn-primary" data-act-import>${UI.icon('upload', 18)}<span>Import CSV</span></button>` : '')}
        ${!editable ? UI.callout('danger', 'Election closed', 'The voter register is locked.', 'lock') : ''}
        <div class="stat-grid four" id="v-stats"></div>
        <section class="card">
          <div class="toolbar">
            <div class="search">${UI.icon('search', 18)}<input class="input" type="search" placeholder="Search reference or class…" aria-label="Search voters" id="v-q"></div>
            <select class="input" id="v-cls" aria-label="Filter by class"><option value="">All classes</option>${classes.map((c) => html`<option value="${c}">${c || '(no class)'}</option>`)}</select>
            <select class="input" id="v-status" aria-label="Filter by status"><option value="">Everyone</option><option value="voted">Voted</option><option value="not_voted">Not voted yet</option><option value="inactive">Inactive</option></select>
          </div>
          <div id="v-table">${UI.loading('Loading voters…')}</div>
        </section>`);
      const tableEl = el.querySelector('#v-table');
      const drawStats = () => {
        const v = ctx.bundle.voters;
        U.setHtml(el.querySelector('#v-stats'), html`
          ${UI.statCard({ label: 'Registered', value: U.fmtInt(v.total), icon: 'users' })}
          ${UI.statCard({ label: 'Active', value: U.fmtInt(v.active), icon: 'check' })}
          ${UI.statCard({ label: 'Voted', value: U.fmtInt(v.voted), icon: 'ballot', tone: 'brand' })}
          ${UI.statCard({ label: 'Not voted yet', value: U.fmtInt(Math.max(0, v.eligible - v.voted)), icon: 'clock' })}`);
      };
      let loadSeq = 0;
      const load = async () => {
        const seq = ++loadSeq;
        try {
          const { rows, total } = await S.api.listVoters(e.id, st);
          if (seq !== loadSeq) return; // a newer search has started; drop this stale response
          const pages = Math.max(1, Math.ceil(total / st.pageSize));
          if (!total) {
            U.setHtml(tableEl, UI.empty({ icon: 'users', title: st.q || st.cls || st.status ? 'No voters match' : 'No voters yet',
              text: st.q || st.cls || st.status ? 'Try a different search or filter.' : 'Import your student list, or create a number of codes per class.',
              action: !st.q && !st.cls && !st.status && editable ? html`<div class="empty-actions">
                <button class="btn btn-primary" data-act-import>${UI.icon('upload', 18)}<span>Import CSV</span></button>
                <a class="btn btn-secondary" href="#/admin/codes">${UI.icon('key', 18)}<span>Create codes for a class</span></a></div>` : '' }));
            return;
          }
          U.setHtml(tableEl, html`
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Student reference</th><th>Class</th><th>Status</th><th>Voted</th><th class="actions-col"><span class="sr-only">Actions</span></th></tr></thead>
              <tbody>${rows.map((v) => html`<tr data-id="${v.id}">
                <td><b>${v.student_reference}</b></td><td>${v.class_name || '—'}</td>
                <td>${v.active ? UI.badge('Active', 'ok') : UI.badge('Inactive')}</td>
                <td>${v.has_voted ? html`<span class="voted yes">${UI.icon('check', 16)} Voted</span>` : html`<span class="voted">Not yet</span>`}</td>
                <td class="actions-col">${editable && !v.has_voted ? html`
                  <button class="btn btn-ghost btn-sm" data-code title="Issue a new code (the old one stops working)">${UI.icon('key', 16)}<span>New code</span></button>
                  <button class="btn btn-ghost btn-sm" data-toggle="${v.active ? '0' : '1'}">${v.active ? 'Deactivate' : 'Activate'}</button>
                  <button class="btn btn-icon btn-ghost danger" data-remove aria-label="Remove ${v.student_reference}">${UI.icon('trash', 16)}</button>` : ''}</td>
              </tr>`)}</tbody></table></div>
            <div class="pager">
              <span class="muted">${U.fmtInt(st.page * st.pageSize + 1)}–${U.fmtInt(Math.min(total, (st.page + 1) * st.pageSize))} of ${U.fmtInt(total)}</span>
              <button class="btn btn-secondary btn-sm" data-page="-1" ${st.page === 0 ? 'disabled' : ''}>${UI.icon('chevron-left', 16)} Previous</button>
              <button class="btn btn-secondary btn-sm" data-page="1" ${st.page >= pages - 1 ? 'disabled' : ''}>Next ${UI.icon('chevron-right', 16)}</button>
            </div>`);
        } catch (err) { U.setHtml(tableEl, UI.errorState(err)); }
      };
      drawStats();
      load();
      const reloadAll = async () => { await ctx.reload(); drawStats(); load(); };
      el.querySelector('#v-q').addEventListener('input', U.debounce((ev) => { st.q = ev.target.value; st.page = 0; load(); }, 300));
      el.querySelector('#v-cls').addEventListener('change', (ev) => { st.cls = ev.target.value; st.page = 0; load(); });
      el.querySelector('#v-status').addEventListener('change', (ev) => { st.status = ev.target.value; st.page = 0; load(); });
      el.addEventListener('click', async (ev) => {
        const t = ev.target;
        if (t.closest('[data-act-import]')) { await A.importVoters(ctx); return; }
        if (t.closest('[data-act-add]')) { if (await A.addVoter(ctx)) ctx.refreshPage(); return; }
        if (t.closest('[data-retry]')) return load();
        const pg = t.closest('[data-page]');
        if (pg) { st.page += Number(pg.dataset.page); load(); return; }
        const row = t.closest('tr[data-id]');
        if (!row) return;
        const id = row.dataset.id, ref = row.querySelector('b').textContent;
        try {
          if (t.closest('[data-toggle]')) {
            const on = t.closest('[data-toggle]').dataset.toggle === '1';
            if (!on && !(await UI.confirm({ title: `Deactivate ${ref}?`, message: 'Their voting code will stop working until you activate them again.', confirmLabel: 'Deactivate', danger: true }))) return;
            await S.api.setVoterActive(id, on); UI.toast(on ? 'Voter activated.' : 'Voter deactivated.'); reloadAll();
          } else if (t.closest('[data-remove]')) {
            if (!(await UI.confirm({ title: `Remove ${ref}?`, message: 'They will be removed from the voter register and their code will stop working.', confirmLabel: 'Remove voter', danger: true, icon: 'trash' }))) return;
            await S.api.removeVoter(id); UI.toast('Voter removed.'); reloadAll();
          } else if (t.closest('[data-code]')) {
            if (!(await UI.confirm({ title: `Issue a new code for ${ref}?`, message: 'Use this if a code was lost or seen by someone else. The old code stops working immediately.', confirmLabel: 'Issue new code', icon: 'key' }))) return;
            const codes = await S.api.regenerateCodes(e.id, { voterIds: [id] });
            await A.showCodes(ctx, codes, 'Replacement voting code');
          }
        } catch (err) { UI.toastError(err); }
      });
      const unsub = S.api.subscribe(e.id, U.throttle((evt) => { if (evt.type === 'vote' || (evt.pulse && evt.type === 'pulse')) ctx.reload().then(() => { drawStats(); }).catch(() => {}); }, 3000));
      return () => unsub();
    },
  };

  /* ================================================================== Voting codes */
  A.pages.codes = {
    title: 'Voting Codes', cap: 'voters.manage', needsElection: true,
    async render(el, ctx) {
      const e = ctx.election;
      let classes = await S.api.listClasses(e.id);
      const draw = () => {
        const mine = S.vault.items.filter((x) => x.electionId === e.id);
        U.setHtml(el, html`
          ${A.head('Voting codes', 'Voting codes', 'Each eligible student has one private code. Codes are random, unique and work exactly once.')}
          ${e.status === 'closed' ? '' : html`
          <section class="card card-pad create-codes">
            <div class="card-title">${UI.icon('plus', 20)} Create new voting codes for a class</div>
            <p class="muted small">Adds new voters to a class and gives each one a code — use this when you hand out codes by class instead of importing a student list. They are numbered automatically (e.g. 10A-001, 10A-002…), continuing after any that already exist.</p>
            <form class="form create-codes-form" id="gen" novalidate>
              <div class="field"><label class="label" for="gen-cls">Class</label>
                <input class="input" id="gen-cls" name="class_name" maxlength="40" list="gen-cls-list" placeholder="e.g. 10A" autocomplete="off">
                <datalist id="gen-cls-list">${classes.filter(Boolean).map((c) => html`<option value="${c}">`)}</datalist></div>
              <div class="field"><label class="label" for="gen-n">How many codes</label>
                <input class="input" id="gen-n" name="count" type="number" min="1" max="2000" value="30"></div>
              <div class="field"><span class="label">&nbsp;</span>
                <button class="btn btn-primary" type="submit">${UI.icon('key', 18)}<span>Create codes</span></button></div>
            </form>
          </section>`}
          <section class="card card-pad how-codes">
            <div class="hc-icon">${UI.icon('shield', 28)}</div>
            <div><div class="card-title">How codes are protected</div>
              <p>Codes look like <span class="mono code-chip">M7K9-P2Q4</span> — 8 characters with no look-alike letters (no I, L, O, 0 or 1). The system stores only a secure fingerprint of each code, so <b>a code can be shown only once, right after it is generated</b>. If a student loses their slip, issue them a new code from the Voters page — the old one stops working.</p></div>
          </section>
          <div class="grid-2">
            <section class="card card-pad">
              <div class="card-title">Codes generated in this session</div>
              ${mine.length ? html`<ul class="vault">${mine.map((v, i) => html`<li>
                  <div><b>${v.label}</b><span class="muted small">${U.plural(v.list.length, 'code')} · ${U.fmtTime(v.at)}</span></div>
                  <button class="btn btn-secondary btn-sm" data-vprint="${i}">${UI.icon('printer', 16)}<span>Print</span></button>
                  <button class="btn btn-ghost btn-sm" data-vcsv="${i}">${UI.icon('download', 16)}<span>CSV</span></button></li>`)}</ul>
                  <button class="btn btn-ghost btn-sm danger" data-vclear>${UI.icon('trash', 16)}<span>Forget these codes now</span></button>`
                : html`<p class="muted">Codes you generate (by importing voters or issuing new codes) appear here until you sign out or close this tab. They are never saved in the browser.</p>`}
            </section>
            <section class="card card-pad">
              <div class="card-title">Replace lost or leaked codes</div>
              ${e.status === 'closed' ? html`<p class="muted">The election is closed.</p>` : !classes.length ? html`<p class="muted small">There are no voters yet. Create codes above or import a student list on the Voters page.</p>` : html`
              <p class="muted small">Gives <b>existing</b> students who have <b>not voted yet</b> a new code. Their previous codes stop working immediately. Use this if slips were lost or seen by others.</p>
              <form class="form" id="regen" novalidate>
                <label class="radio-row"><input type="radio" name="target" value="class" checked><span>Everyone in class</span>
                  <select class="input input-sm" name="cls" aria-label="Class">${classes.map((c) => html`<option value="${c}">${c || '(no class)'}</option>`)}</select></label>
                <label class="radio-row"><input type="radio" name="target" value="all"><span>All students who have not voted yet</span></label>
                <button class="btn btn-primary" type="submit" ${classes.length ? '' : 'disabled'}>${UI.icon('key', 18)}<span>Generate new codes…</span></button>
              </form>`}
            </section>
          </div>
          <section class="card card-pad">
            <div class="card-title">What a printed code card looks like</div>
            <div class="pc-sample">
              <div class="pc-card"><div class="pc-top">${UI.logo(ctx.school, 22)}<span>${S.brand.title(e, ctx.school)}</span></div>
                <div class="pc-label">Your voting code</div><div class="pc-code">M7K9-P2Q4</div>
                <div class="pc-note">Keep this code private. It works only once.</div>
                <div class="pc-foot"><span>ADM-1001 · 10A</span>${e.is_demo ? html`<b class="pc-demo">DEMO — NOT VALID</b>` : html`<span>${(ctx.school && ctx.school.name) || ''}</span>`}</div></div>
            </div>
            <p class="muted small">Cards print 3 across on A4/Letter with cut lines. Hand each card to the named student only.</p>
          </section>`);
      };
      draw();
      el.addEventListener('click', (ev) => {
        const t = ev.target;
        const mine = S.vault.items.filter((x) => x.electionId === e.id);
        const p = t.closest('[data-vprint]'), c = t.closest('[data-vcsv]');
        if (p) { const v = mine[Number(p.dataset.vprint)]; S.print.codes(v.list, { school: ctx.school, election: e }); S.api.logAction(e.id, 'codes.printed', { count: v.list.length }); }
        if (c) { const v = mine[Number(c.dataset.vcsv)]; S.print.codesCSV(v.list, e); S.api.logAction(e.id, 'codes.downloaded', { count: v.list.length }); }
        if (t.closest('[data-vclear]')) { S.vault.items = S.vault.items.filter((x) => x.electionId !== e.id); draw(); }
      });
      el.addEventListener('submit', async (ev) => {
        if (ev.target.id === 'gen') {
          ev.preventDefault();
          const form = ev.target;
          UI.clearFieldErrors(form);
          const v = UI.formValues(form);
          await UI.busy(form.querySelector('[type=submit]'), async () => {
            try {
              const out = await A.generateVoters(ctx, v.class_name, v.count);
              if (out.created.length) { classes = await S.api.listClasses(e.id); draw(); }
            } catch (err) {
              if (err.fields) UI.showFieldErrors(form, err.fields); else UI.toastError(err);
            }
          });
          return;
        }
        if (ev.target.id !== 'regen') return;
        ev.preventDefault();
        const v = UI.formValues(ev.target);
        const target = v.target === 'all' ? { allUnused: true } : { className: v.cls };
        const label = v.target === 'all' ? 'all students who have not voted' : `class ${v.cls || '(no class)'}`;
        const phrase = await UI.confirm({ title: 'Issue new codes?', danger: true, phrase: R.PHRASES.newCodes, confirmLabel: 'Generate new codes', icon: 'key',
          message: html`<p>New codes will be generated for <strong>${label}</strong>. Their current codes will <strong>stop working immediately</strong>.</p>` });
        if (!phrase) return;
        try {
          const codes = await S.api.regenerateCodes(e.id, target);
          if (!codes.length) { UI.toast('Nobody matched — everyone selected has already voted or is inactive.', 'info'); return; }
          await A.showCodes(ctx, codes, `New codes — ${label}`);
          draw();
        } catch (err) { UI.toastError(err); }
      });
    },
  };
})(window.SGE);
