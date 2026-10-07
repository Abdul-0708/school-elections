/* ADMIN: Election settings · Positions · Candidates (+ editors reused by the wizard). */
(function (S) {
  'use strict';
  const U = S.util, UI = S.ui, R = S.rules, html = U.html, raw = U.raw;
  const A = S.admin;

  A.POSITION_PRESETS = ['President', 'Vice President', 'General Secretary', 'Treasurer', 'Sports Leader', 'Academic Leader', 'Welfare Leader', 'Prefect Representatives'];

  const lockedBanner = (ctx) => {
    if (!ctx.bundle) return '';
    if (ctx.election.status === 'closed') return UI.callout('danger', 'This election is closed', 'Final results are locked. Nothing here can be changed.', 'lock');
    if (ctx.bundle.locked) return UI.callout('warn', 'Voting has started', 'Positions, candidates and selection rules are frozen. You can still correct names, descriptions, photos and slogans.', 'lock');
    return '';
  };

  /* ---------------------------------------------------------------- editors */
  A.editPosition = (ctx, pos) => {
    const p = pos || { name: '', description: '', min_selections: 1, max_selections: 1, active: true };
    const locked = ctx.bundle && ctx.bundle.locked;
    const activeCands = pos ? ctx.bundle.candidates.filter((c) => c.position_id === pos.id && c.active).length : null;
    return UI.formModal({
      title: pos ? `Edit ${pos.name}` : 'Add position', submitLabel: pos ? 'Save changes' : 'Add position',
      body: html`
        <div class="field"><label class="label" for="p-name">Position name</label>
          <input class="input" id="p-name" name="name" value="${p.name}" list="p-presets" maxlength="120" required autofocus>
          <datalist id="p-presets">${A.POSITION_PRESETS.map((n) => html`<option value="${n}">`)}</datalist></div>
        <div class="field"><label class="label" for="p-desc">Description <span class="opt">optional</span></label>
          <textarea class="input" id="p-desc" name="description" rows="2" maxlength="1000" placeholder="What does this role do?">${p.description}</textarea></div>
        <div class="grid-2 tight">
          <div class="field"><label class="label" for="p-min">Minimum selections</label>
            <input class="input" id="p-min" name="min_selections" type="number" min="0" max="20" value="${p.min_selections}" ${locked ? 'disabled' : ''}>
            <p class="help">0 makes the position optional.</p></div>
          <div class="field"><label class="label" for="p-max">Maximum selections</label>
            <input class="input" id="p-max" name="max_selections" type="number" min="1" max="20" value="${p.max_selections}" ${locked ? 'disabled' : ''}>
            <p class="help">Also the number of seats (winners).</p></div>
        </div>
        <label class="switch"><input type="checkbox" name="active" ${p.active ? 'checked' : ''} ${locked ? 'disabled' : ''}><span class="switch-ui"></span><span>Active — appears on the ballot</span></label>
        ${locked ? UI.callout('warn', '', 'Voting has started: only the name and description can be changed.', 'lock') : ''}`,
      onSubmit: async (v) => {
        const row = { ...p, ...v, election_id: ctx.election.id };
        if (locked) { row.min_selections = p.min_selections; row.max_selections = p.max_selections; row.active = p.active; }
        const errs = R.validatePosition(row, activeCands);
        if (Object.keys(errs).length) throw UI.fieldError(errs);
        if (pos && ['open', 'paused'].includes(ctx.election.status) && !ctx.election.is_demo) {
          const ok = await UI.confirm({ title: 'Change an open election?', message: 'Voting is open. Students will see this change on their ballots immediately.', confirmLabel: 'Save change' });
          if (!ok) return false;
        }
        const saved = await S.api.savePosition(row);
        UI.toast(pos ? 'Position updated.' : `${saved.name} added.`);
        await ctx.reload();
        return saved;
      },
    }).result;
  };

  A.editCandidate = (ctx, cand, positionId) => {
    const c = cand || { name: '', candidate_code: '', class_name: '', house: '', photo_url: '', slogan: '', biography: '', manifesto: '', position_id: positionId || '', active: true };
    const positions = ctx.bundle.positions;
    const locked = ctx.bundle.locked;
    let photo = c.photo_url || '';
    const m = UI.formModal({
      title: cand ? `Edit ${cand.name}` : 'Add candidate', size: 'lg', submitLabel: cand ? 'Save changes' : 'Add candidate',
      body: html`
        <div class="cand-form">
          <div class="photo-field">
            <div class="photo-preview" id="ph-prev">${UI.avatar({ name: c.name || '?', photo_url: photo }, 132)}</div>
            <label class="btn btn-secondary btn-sm">${UI.icon('upload', 16)}<span>Upload photo</span><input type="file" accept="image/png,image/jpeg,image/webp" id="ph-file" hidden></label>
            <button type="button" class="btn btn-ghost btn-sm" id="ph-clear" ${photo ? '' : 'hidden'}>Remove photo</button>
            <p class="help">Square photos look best. Resized automatically.</p>
          </div>
          <div class="cf-fields">
            <div class="field"><label class="label" for="c-name">Full name</label><input class="input" id="c-name" name="name" value="${c.name}" maxlength="120" required autofocus></div>
            <div class="grid-2 tight">
              <div class="field"><label class="label" for="c-pos">Position</label>
                <select class="input" id="c-pos" name="position_id" ${locked ? 'disabled' : ''}>
                  <option value="">Choose a position…</option>
                  ${positions.map((p) => html`<option value="${p.id}" ${raw(p.id === c.position_id ? 'selected' : '')}>${p.name}${p.active ? '' : ' (inactive)'}</option>`)}
                </select></div>
              <div class="field"><label class="label" for="c-code">Candidate ID <span class="opt">optional</span></label><input class="input" id="c-code" name="candidate_code" value="${c.candidate_code || ''}" maxlength="40"></div>
            </div>
            <div class="grid-2 tight">
              <div class="field"><label class="label" for="c-class">Class / year</label><input class="input" id="c-class" name="class_name" value="${c.class_name}" maxlength="60" placeholder="e.g. Year 10"></div>
              <div class="field"><label class="label" for="c-house">House / team <span class="opt">optional</span></label><input class="input" id="c-house" name="house" value="${c.house}" maxlength="60"></div>
            </div>
            <div class="field"><label class="label" for="c-slogan">Campaign slogan</label><input class="input" id="c-slogan" name="slogan" value="${c.slogan}" maxlength="160" placeholder="Together We Lead"></div>
            <div class="field"><label class="label" for="c-bio">Short biography <span class="opt">optional</span></label><textarea class="input" id="c-bio" name="biography" rows="2" maxlength="2000">${c.biography}</textarea></div>
            <div class="field"><label class="label" for="c-man">Manifesto <span class="opt">optional</span></label><textarea class="input" id="c-man" name="manifesto" rows="5" maxlength="5000" placeholder="One promise per line">${c.manifesto}</textarea></div>
            <label class="switch"><input type="checkbox" name="active" ${c.active ? 'checked' : ''} ${locked ? 'disabled' : ''}><span class="switch-ui"></span><span>Active — appears on the ballot</span></label>
          </div>
        </div>`,
      onMount: (el) => {
        const prev = el.querySelector('#ph-prev');
        const clear = el.querySelector('#ph-clear');
        const nameInput = el.querySelector('#c-name');
        const paint = () => U.setHtml(prev, UI.avatar({ name: nameInput.value || '?', photo_url: photo }, 132));
        el.querySelector('#ph-file').addEventListener('change', async (ev) => {
          const f = ev.target.files[0];
          if (!f) return;
          try { photo = await U.resizeImage(f, 480, 0.85); paint(); clear.hidden = false; } catch (e) { UI.toast(e.message, 'error'); }
        });
        clear.addEventListener('click', () => { photo = ''; paint(); clear.hidden = true; });
        nameInput.addEventListener('input', () => { if (!photo) paint(); });
      },
      onSubmit: async (v) => {
        const row = { ...c, ...v, election_id: ctx.election.id };
        if (locked) { row.position_id = c.position_id; row.active = c.active; }
        const errs = R.validateCandidate(row, ctx.bundle.candidates, positions);
        if (Object.keys(errs).length) throw UI.fieldError(errs);
        if (cand && ['open', 'paused'].includes(ctx.election.status) && !ctx.election.is_demo) {
          const ok = await UI.confirm({ title: 'Change an open election?', message: 'Voting is open. Students will see this change on their ballots immediately.', confirmLabel: 'Save change' });
          if (!ok) return false;
        }
        row.photo_url = /^data:/.test(photo) ? await S.api.uploadImage(photo, 'candidates') : photo;
        const saved = await S.api.saveCandidate(row);
        UI.toast(cand ? 'Candidate updated.' : `${saved.name} added.`);
        await ctx.reload();
        return saved;
      },
    });
    return m.result;
  };

  /* Drag-and-drop reordering for a list of [data-id] rows, with keyboard buttons as a fallback. */
  A.sortable = (list, onDrop) => {
    let dragging = null;
    list.addEventListener('dragstart', (e) => {
      const row = e.target.closest('[data-id][draggable="true"]');
      if (!row) return;
      dragging = row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.id);
    });
    list.addEventListener('dragover', (e) => {
      if (!dragging) return;
      e.preventDefault();
      const over = e.target.closest('[data-id]');
      if (!over || over === dragging || over.parentElement !== dragging.parentElement) return;
      const r = over.getBoundingClientRect();
      const after = (r.width > r.height * 2) ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
      over.parentElement.insertBefore(dragging, after ? over.nextSibling : over);
    });
    list.addEventListener('dragend', () => {
      if (!dragging) return;
      dragging.classList.remove('dragging');
      const parent = dragging.parentElement;
      dragging = null;
      onDrop(U.$$(':scope > [data-id]', parent).map((x) => x.dataset.id), parent);
    });
  };

  /* ================================================================== Election */
  A.pages.election = {
    title: 'Election', cap: 'monitor.view', needsElection: true,
    async render(el, ctx) {
      const e = ctx.election;
      const editable = ctx.can('election.edit') && e.status !== 'closed';
      const dis = editable ? '' : 'disabled';
      const vis = [
        { v: 'live', t: 'Live', d: 'Everyone sees results update during voting.' },
        { v: 'after_close', t: 'After closing', d: 'Turnout only until the election closes.' },
        { v: 'hidden', t: 'Admins only', d: 'Only administrators see results.' },
      ];
      U.setHtml(el, html`
        ${A.head('Election setup', e.name, `${e.is_demo ? 'Demo election' : 'Live election'} · created ${U.fmtDate(e.created_at)}`, A.statusControls(ctx))}
        <section class="card card-pad status-timeline">
          ${['draft', 'scheduled', 'open', 'paused', 'closed'].map((s) => html`<div class="tl-step ${e.status === s ? 'on' : ''}"><span class="tl-dot tone-${R.STATUS[s].tone}"></span><span>${R.STATUS[s].label}</span></div>`)}
          <div class="tl-meta">
            <span>Opened: <b>${e.opened_at ? U.fmtDateTime(e.opened_at) : '—'}</b></span>
            <span>Closed: <b>${e.closed_at ? U.fmtDateTime(e.closed_at) : '—'}</b></span>
          </div>
        </section>
        ${e.status === 'closed' ? UI.callout('danger', 'This election is closed', 'Its configuration and final results are locked. You can still change how results are displayed.', 'lock') : ''}
        ${!ctx.can('election.edit') ? UI.callout('info', 'Read only', 'Only Super Admins can change election settings.') : ''}
        <form class="form settings-form" id="el-form" novalidate>
          <section class="card card-pad">
            <div class="card-title">Election details</div>
            <div class="field"><label class="label" for="e-name">Election name</label><input class="input" id="e-name" name="name" value="${e.name}" maxlength="120" ${dis}></div>
            <div class="grid-2 tight">
              <div class="field"><label class="label" for="e-sub">Subtitle <span class="opt">optional</span></label><input class="input" id="e-sub" name="subtitle" value="${e.subtitle}" maxlength="160" ${dis}></div>
              <div class="field"><label class="label" for="e-year">Academic year</label><input class="input" id="e-year" name="academic_year" value="${e.academic_year}" maxlength="20" ${dis}></div>
            </div>
            <div class="field"><label class="label" for="e-desc">Description <span class="opt">shown on the home page</span></label><textarea class="input" id="e-desc" name="description" rows="2" maxlength="2000" ${dis}>${e.description}</textarea></div>
          </section>
          <section class="card card-pad">
            <div class="card-title">Voting window</div>
            <p class="muted small">Optional. A <b>scheduled</b> election opens automatically at the start time. Voting always stops at the end time; you then close the election to lock the results.</p>
            <div class="grid-4 tight">
              <div class="field"><label class="label" for="e-sd">Start date</label><input class="input" type="date" id="e-sd" name="sd" value="${U.toDateInput(e.starts_at)}" ${dis}></div>
              <div class="field"><label class="label" for="e-st">Start time</label><input class="input" type="time" id="e-st" name="stime" value="${U.toTimeInput(e.starts_at)}" ${dis}></div>
              <div class="field"><label class="label" for="e-ed">End date</label><input class="input" type="date" id="e-ed" name="ed" value="${U.toDateInput(e.ends_at)}" ${dis}></div>
              <div class="field"><label class="label" for="e-et">End time</label><input class="input" type="time" id="e-et" name="etime" value="${U.toTimeInput(e.ends_at)}" ${dis}></div>
            </div>
          </section>
          <section class="card card-pad">
            <div class="card-title">Messages for voters</div>
            <div class="field"><label class="label" for="e-ins">Voting instructions <span class="opt">top of the ballot</span></label><textarea class="input" id="e-ins" name="instructions" rows="2" maxlength="2000" ${dis} placeholder="Choose your candidates for each position, then review your vote.">${e.instructions}</textarea></div>
            <div class="field"><label class="label" for="e-conf">Confirmation message <span class="opt">after voting</span></label><input class="input" id="e-conf" name="confirmation_message" value="${e.confirmation_message}" maxlength="500" ${dis} placeholder="Results will be announced in assembly."></div>
          </section>
          <section class="card card-pad">
            <div class="card-title">Results display</div>
            <div class="radio-cards">${vis.map((o) => html`<label class="radio-card"><input type="radio" name="results_visibility" value="${o.v}" ${raw(e.results_visibility === o.v ? 'checked' : '')} ${ctx.can('results.settings') ? '' : 'disabled'}><span><b>${o.t}</b><small>${o.d}</small></span></label>`)}</div>
            <div class="field narrow"><label class="label" for="e-rot">Projector rotation (seconds per position)</label><input class="input" type="number" min="5" max="300" id="e-rot" name="rotation_seconds" value="${e.rotation_seconds}" ${ctx.can('results.settings') ? '' : 'disabled'}></div>
          </section>
          <div class="form-error" role="alert" hidden></div>
          ${ctx.can('results.settings') ? html`<div class="form-actions sticky-actions"><button class="btn btn-primary btn-lg" type="submit">${UI.icon('check', 18)}<span>Save election settings</span></button></div>` : ''}
        </form>
        ${e.status === 'closed' && ctx.can('election.status') && !e.is_demo ? html`
          <section class="card card-pad danger-zone">
            <div class="card-title">${UI.icon('archive', 20)} Archive this election</div>
            <p class="muted">Archiving keeps the final results and audit log forever, and lets you start a new election. Ballots are never deleted.</p>
            <button class="btn btn-danger-outline" data-archive>${UI.icon('archive', 18)}<span>Archive election…</span></button>
          </section>` : ''}`);
      const form = el.querySelector('#el-form');
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const v = UI.formValues(form);
        const errBox = form.querySelector('.form-error');
        errBox.hidden = true;
        UI.clearFieldErrors(form);
        let patch;
        if (e.status === 'closed' || !ctx.can('election.edit')) patch = { results_visibility: v.results_visibility, rotation_seconds: v.rotation_seconds };
        else {
          patch = {
            name: v.name, subtitle: v.subtitle, academic_year: v.academic_year, description: v.description,
            instructions: v.instructions, confirmation_message: v.confirmation_message,
            results_visibility: v.results_visibility, rotation_seconds: v.rotation_seconds,
            starts_at: U.fromDateTimeInputs(v.sd, v.stime), ends_at: U.fromDateTimeInputs(v.ed, v.etime),
          };
          const errs = R.validateElection(patch);
          if (errs.ends_at) { errs.ed = errs.ends_at; delete errs.ends_at; }
          if (Object.keys(errs).length) return UI.showFieldErrors(form, errs);
          if (['open', 'paused'].includes(e.status) && !e.is_demo) {
            const ok = await UI.confirm({ title: 'Change an open election?', message: 'Voting is in progress. Changes to the voting window or messages take effect immediately at every station.', confirmLabel: 'Save changes' });
            if (!ok) return;
          }
        }
        await UI.busy(form.querySelector('[type=submit]'), async () => {
          try { await S.api.updateElection(e.id, patch); await ctx.reload(); UI.toast('Election settings saved.'); ctx.refreshPage(); }
          catch (err) { errBox.textContent = R.message(err).text; errBox.hidden = false; }
        });
      });
      const arch = el.querySelector('[data-archive]');
      if (arch) arch.addEventListener('click', async () => {
        const phrase = await UI.confirm({ title: 'Archive this election?', danger: true, phrase: R.PHRASES.archive, confirmLabel: 'Archive', icon: 'archive', message: 'The election moves to the archive with its final results and audit log. You can then create the next election.' });
        if (!phrase) return;
        try { await S.api.archiveElection(e.id, phrase); await ctx.reload(); UI.toast('Election archived.'); ctx.go('reports'); } catch (err) { UI.toastError(err); }
      });
    },
  };

  /* ================================================================== Positions */
  A.pages.positions = {
    title: 'Positions', cap: 'monitor.view', needsElection: true,
    async render(el, ctx) {
      const draw = () => {
        const { positions, candidates } = ctx.bundle;
        const canEdit = ctx.can('positions.edit') && ctx.election.status !== 'closed';
        const canStruct = canEdit && !ctx.bundle.locked;
        U.setHtml(el, html`
          ${A.head('Ballot structure', 'Positions', 'The roles students vote for, in ballot order. Drag to reorder.',
            canStruct ? html`<button class="btn btn-primary" data-add>${UI.icon('plus', 18)}<span>Add position</span></button>` : '')}
          ${lockedBanner(ctx)}
          ${positions.length ? html`<ol class="pos-list" id="pos-list">${positions.map((p, i) => {
            const n = candidates.filter((c) => c.position_id === p.id && c.active).length;
            return html`<li class="pos-row ${p.active ? '' : 'inactive'}" data-id="${p.id}" draggable="${canStruct ? 'true' : 'false'}">
              ${canStruct ? html`<span class="grip" title="Drag to reorder">${UI.icon('grip', 18)}</span>` : ''}
              <span class="pos-n tnum">${i + 1}</span>
              <div class="pos-main"><div class="pos-name">${p.name}${p.active ? '' : html` ${UI.badge('Inactive')}`}</div>${p.description ? html`<div class="pos-desc">${p.description}</div>` : ''}</div>
              <span class="rule-pill">${U.selectionRule(p)}</span>
              <span class="pos-cands ${n ? '' : 'warn'}">${UI.icon('award', 16)} ${U.plural(n, 'candidate')}</span>
              <div class="row-actions">
                ${canStruct ? html`<button class="btn btn-icon btn-ghost" data-move="-1" aria-label="Move ${p.name} up" ${i === 0 ? 'disabled' : ''}>${UI.icon('arrow-up', 16)}</button>
                  <button class="btn btn-icon btn-ghost" data-move="1" aria-label="Move ${p.name} down" ${i === positions.length - 1 ? 'disabled' : ''}>${UI.icon('arrow-down', 16)}</button>` : ''}
                ${canEdit ? html`<button class="btn btn-icon btn-ghost" data-edit aria-label="Edit ${p.name}">${UI.icon('edit', 18)}</button>` : ''}
                ${canStruct ? html`<button class="btn btn-icon btn-ghost danger" data-del aria-label="Delete ${p.name}">${UI.icon('trash', 18)}</button>` : ''}
              </div></li>`;
          })}</ol>` : UI.empty({ icon: 'list', title: 'No positions yet', text: 'Add the roles students will vote for — for example President, Treasurer or Sports Leader.',
            action: canStruct ? html`<div class="preset-chips">${A.POSITION_PRESETS.map((n) => html`<button class="chip" data-preset="${n}">${UI.icon('plus', 14)} ${n}</button>`)}</div>` : '' })}`);
        const list = el.querySelector('#pos-list');
        if (list && canStruct) A.sortable(list, (ids) => reorder(ids));
      };
      const reorder = async (ids) => {
        try { await S.api.reorderPositions(ctx.election.id, ids); await ctx.reload(); draw(); } catch (e) { UI.toastError(e); await ctx.reload(); draw(); }
      };
      el.addEventListener('click', async (ev) => {
        const t = ev.target;
        const row = t.closest('[data-id]');
        const p = row && ctx.bundle.positions.find((x) => x.id === row.dataset.id);
        if (t.closest('[data-add]')) { if (await A.editPosition(ctx)) draw(); }
        else if (t.closest('[data-preset]')) {
          const name = t.closest('[data-preset]').dataset.preset;
          try { await S.api.savePosition({ election_id: ctx.election.id, name, description: '', min_selections: 1, max_selections: name.includes('Representatives') ? 3 : 1, active: true }); await ctx.reload(); UI.toast(`${name} added.`); draw(); } catch (e) { UI.toastError(e); }
        } else if (p && t.closest('[data-edit]')) { if (await A.editPosition(ctx, p)) draw(); }
        else if (p && t.closest('[data-move]')) {
          const ids = ctx.bundle.positions.map((x) => x.id);
          const i = ids.indexOf(p.id), j = i + Number(t.closest('[data-move]').dataset.move);
          [ids[i], ids[j]] = [ids[j], ids[i]];
          reorder(ids);
        } else if (p && t.closest('[data-del]')) {
          const n = ctx.bundle.candidates.filter((c) => c.position_id === p.id).length;
          const ok = await UI.confirm({ title: `Delete ${p.name}?`, danger: true, confirmLabel: 'Delete position', icon: 'trash',
            message: n ? html`<p>This also deletes <strong>${U.plural(n, 'candidate')}</strong> standing for this position.</p>` : 'This position will be removed from the ballot.' });
          if (!ok) return;
          try { await S.api.deletePosition(p.id); await ctx.reload(); UI.toast('Position deleted.'); draw(); } catch (e) { UI.toastError(e); }
        }
      });
      draw();
    },
  };

  /* ================================================================== Candidates */
  A.pages.candidates = {
    title: 'Candidates', cap: 'monitor.view', needsElection: true,
    async render(el, ctx) {
      let filter = 'all';
      const draw = () => {
        const { positions, candidates } = ctx.bundle;
        const canEdit = ctx.can('candidates.edit') && ctx.election.status !== 'closed';
        const canStruct = canEdit && !ctx.bundle.locked;
        const shown = positions.filter((p) => filter === 'all' || p.id === filter);
        U.setHtml(el, html`
          ${A.head('Ballot', 'Candidates', 'Photos, slogans and manifestos exactly as students will see them. Vote counts are never shown here.',
            canStruct && positions.length ? html`<button class="btn btn-primary" data-add>${UI.icon('plus', 18)}<span>Add candidate</span></button>` : '')}
          ${lockedBanner(ctx)}
          ${!positions.length ? UI.empty({ icon: 'list', title: 'Add positions first', text: 'Candidates stand for a position. Create the positions, then add candidates.', action: html`<a class="btn btn-primary" href="#/admin/positions">Go to positions</a>` }) : html`
          <div class="filter-chips" role="tablist" aria-label="Filter by position">
            <button class="chip ${filter === 'all' ? 'on' : ''}" data-filter="all">All <span class="chip-count">${candidates.length}</span></button>
            ${positions.map((p) => html`<button class="chip ${filter === p.id ? 'on' : ''}" data-filter="${p.id}">${p.name} <span class="chip-count">${candidates.filter((c) => c.position_id === p.id).length}</span></button>`)}
          </div>
          ${!candidates.length ? UI.empty({ icon: 'award', title: 'No candidates yet', text: 'Add candidates to begin building this election.', action: canStruct ? html`<button class="btn btn-primary" data-add>${UI.icon('plus', 18)}<span>Add candidate</span></button>` : '' }) : ''}
          ${shown.map((p) => {
            const list = candidates.filter((c) => c.position_id === p.id);
            if (!list.length && filter === 'all' && candidates.length) return html`<section class="gallery-group"><header><h2>${p.name}</h2><span class="muted">No candidates yet</span>${canStruct ? html`<button class="btn btn-ghost btn-sm" data-add="${p.id}">${UI.icon('plus', 16)} Add</button>` : ''}</header></section>`;
            if (!list.length) return '';
            return html`<section class="gallery-group">
              <header><h2>${p.name}</h2><span class="muted">${U.plural(list.length, 'candidate')} · ${U.selectionRule(p)}</span>${canStruct ? html`<button class="btn btn-ghost btn-sm" data-add="${p.id}">${UI.icon('plus', 16)} Add</button>` : ''}</header>
              <div class="gallery" data-pos="${p.id}">${list.map((c) => html`
                <article class="g-card ${c.active ? '' : 'inactive'}" data-id="${c.id}" draggable="${canStruct ? 'true' : 'false'}">
                  ${canStruct ? html`<span class="grip" title="Drag to reorder">${UI.icon('grip', 16)}</span>` : ''}
                  <div class="g-photo">${UI.avatar(c, 120)}</div>
                  <h3 class="g-name">${c.name}</h3>
                  <div class="g-meta">${p.name}${c.class_name ? ' · ' + c.class_name : ''}</div>
                  ${c.slogan ? html`<p class="g-slogan">“${c.slogan}”</p>` : ''}
                  <div class="g-foot">${c.active ? UI.badge('Active', 'ok') : UI.badge('Inactive')}${c.candidate_code ? html`<span class="mono small muted">${c.candidate_code}</span>` : ''}
                    <span class="spacer"></span>
                    ${canEdit ? html`<button class="btn btn-icon btn-ghost" data-edit aria-label="Edit ${c.name}">${UI.icon('edit', 16)}</button>` : ''}
                    ${canStruct ? html`<button class="btn btn-icon btn-ghost danger" data-del aria-label="Delete ${c.name}">${UI.icon('trash', 16)}</button>` : ''}
                  </div>
                </article>`)}</div>
            </section>`;
          })}`}`);
        if (canStruct) U.$$('.gallery', el).forEach((g) => A.sortable(g, async (ids) => {
          try { await S.api.reorderCandidates(g.dataset.pos, ids); await ctx.reload(); } catch (e) { UI.toastError(e); await ctx.reload(); draw(); }
        }));
      };
      el.addEventListener('click', async (ev) => {
        const t = ev.target;
        const f = t.closest('[data-filter]');
        if (f) { filter = f.dataset.filter; draw(); return; }
        const add = t.closest('[data-add]');
        if (add) { if (await A.editCandidate(ctx, null, add.dataset.add || (filter !== 'all' ? filter : ''))) draw(); return; }
        const card = t.closest('.g-card');
        const c = card && ctx.bundle.candidates.find((x) => x.id === card.dataset.id);
        if (!c) return;
        if (t.closest('[data-edit]')) { if (await A.editCandidate(ctx, c)) draw(); }
        else if (t.closest('[data-del]')) {
          const ok = await UI.confirm({ title: `Delete ${c.name}?`, danger: true, confirmLabel: 'Delete candidate', icon: 'trash', message: 'The candidate will be removed from the ballot.' });
          if (!ok) return;
          try { await S.api.deleteCandidate(c.id); await ctx.reload(); UI.toast('Candidate deleted.'); draw(); } catch (e) { UI.toastError(e); }
        }
      });
      draw();
    },
  };
})(window.SGE);
