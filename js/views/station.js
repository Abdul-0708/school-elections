/* STUDENT VOTING STATION  (#/vote, #/vote/demo)
   Ready → Ballot → Review → Confirm → Submitting → Complete → (auto-reset) Ready
   One computer serves many students.  Nothing about a voter or their choices is kept in the
   browser after submission; the success screen only appears once the server confirms. */
(function (S) {
  'use strict';
  const U = S.util, UI = S.ui, R = S.rules, html = U.html, raw = U.raw;

  function stationId() {
    let id = U.store.get('sge.station.id');
    if (!id || !/^[A-Za-z0-9-]{6,40}$/.test(id)) {
      id = 'ST-' + U.randomHex(3).toUpperCase();
      U.store.set('sge.station.id', id);
    }
    return id;
  }

  const STEPS = ['Start', 'Ballot', 'Review', 'Submit', 'Complete'];
  const STEP_OF = { ready: 0, ballot: 1, review: 2, submitting: 3, failed: 3, success: 4 };

  S.views.station = {
    async mount(root, params) {
      const kind = params[0] === 'demo' ? 'demo' : 'live';
      const cfg = window.SGE_CONFIG || {};
      const IDLE_MS = Math.max(30, cfg.STATION_IDLE_SECONDS || 120) * 1000;
      const RESET_S = Math.max(3, cfg.STATION_RESET_SECONDS || 10);
      const sid = stationId();
      const st = { phase: 'ready', election: null, school: null, positions: [], token: null, sel: {}, error: null };
      const timers = new Set();
      const unsubs = [];
      let idleTimer = null, idleModal = null, countdown = null;

      const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
      const every = (fn, ms) => { const t = setInterval(fn, ms); timers.add(t); return t; };

      // A voting station must never carry an administrator session.
      try { await S.api.auth.signOutLocal(); } catch (e) { /* ignore */ }
      document.body.classList.add('mode-station');
      root.className = 'view-station';
      U.setHtml(root, html`
        <div class="station ${kind === 'demo' ? 'is-demo' : ''}">
          ${kind === 'demo' ? html`<div class="demo-ribbon" role="note">${UI.icon('flask', 18)}<span>DEMO MODE · NO REAL VOTES</span></div>` : ''}
          <header class="station-bar" id="st-bar"></header>
          <main class="station-main" id="st-main" tabindex="-1"></main>
          <footer class="station-foot">
            <span class="sf-secret">${UI.icon('lock', 16)}<span>Your vote is secret. Nobody — not even the administrators — can see who you voted for.</span></span>
            <span class="station-id">Station ${sid}</span>
          </footer>
        </div>`);
      const bar = root.querySelector('#st-bar');
      const main = root.querySelector('#st-main');

      async function loadElection() {
        const pub = await S.refreshPublic();
        st.school = pub.school;
        st.election = pub[kind];
        S.brand.setDocTitle(kind === 'demo' ? 'Demo voting station' : 'Voting station', st.school);
      }

      /* ------------------------------------------------------------ header */
      function renderBar() {
        const e = st.election, s = st.school;
        const step = STEP_OF[st.phase];
        const showSteps = !!e && R.votingState(e).canVote || ['ballot', 'review', 'submitting', 'failed', 'success'].includes(st.phase);
        U.setHtml(bar, html`
          <div class="sb-brand">${UI.logo(s, 46)}<div class="sb-text"><div class="sb-school">${(s && s.name) || 'Student Elections'}</div><div class="sb-title">${S.brand.title(e, s)}</div></div></div>
          ${showSteps ? html`<ol class="steps" aria-label="Voting progress">${STEPS.map((l, i) => html`
            <li class="${i < step ? 'done' : ''} ${i === step ? 'current' : ''}" ${i === step ? raw('aria-current="step"') : ''}>
              <span class="step-n">${i < step ? UI.icon('check', 14) : i + 1}</span><span class="step-l">${l}</span></li>`)}</ol>` : html`<span></span>`}
          <div class="sb-right">${UI.statusPill(R.votingState(e))}
            <button class="btn btn-icon btn-ghost" data-act="fullscreen" aria-label="Toggle full screen" title="Full screen">${UI.icon(UI.fullscreen.active() ? 'minimize' : 'maximize')}</button></div>`);
      }

      function go(phase) {
        st.phase = phase;
        renderBar();
        ({ ready: renderReady, ballot: renderBallot, review: renderReview, submitting: renderSubmitting, success: renderSuccess, failed: renderFailed })[phase]();
        if (phase !== 'ballot') main.scrollTop = 0;
        window.scrollTo(0, 0);
        if (phase === 'ballot' || phase === 'review') bumpIdle(); else stopIdle();
      }

      /* ------------------------------------------------------------ ready */
      function renderReady() {
        st.token = null; st.sel = {}; st.positions = []; st.error = null;
        const vs = R.votingState(st.election);
        if (!vs.canVote) return renderUnavailable(vs);
        U.setHtml(main, html`
          <section class="code-entry">
            <div class="eyebrow">${UI.icon('ballot', 16)} Ready for next voter</div>
            <h1 class="display">Enter your voting code</h1>
            <p class="lead">Type the 8-character code printed on your voting slip.</p>
            <form class="code-form" novalidate>
              <label for="code" class="sr-only">Voting code</label>
              <input id="code" class="code-input" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false"
                maxlength="9" placeholder="XXXX-XXXX" aria-describedby="code-help code-err" autofocus>
              <button class="btn btn-primary btn-xl" type="submit"><span>Continue</span>${UI.icon('arrow-right', 22)}</button>
            </form>
            <div id="code-err" class="code-error" role="alert" aria-live="assertive"></div>
            <p id="code-help" class="help">Capital or small letters both work. Each code can be used only once.</p>
          </section>`);
        const form = main.querySelector('form');
        const input = main.querySelector('#code');
        const errBox = main.querySelector('#code-err');
        const showErr = (m) => {
          U.setHtml(errBox, html`${UI.icon('alert', 20)}<div><strong>${m.title}</strong><span>${m.text}</span></div>`);
          errBox.classList.add('show');
          input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
          input.setAttribute('aria-invalid', 'true');
        };
        input.addEventListener('input', () => {
          input.value = U.formatCodeTyping(input.value);
          errBox.classList.remove('show');
          input.removeAttribute('aria-invalid');
        });
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const code = U.normalizeCode(input.value);
          if (!code) return showErr({ title: 'Check your code', text: 'Voting codes have 8 letters and numbers, like M7K9-P2Q4.' });
          const btn = form.querySelector('button');
          await UI.busy(btn, async () => {
            try {
              const r = await S.api.beginVoting(st.election.id, code);
              st.token = r.token;
              st.positions = r.positions || [];
              st.sel = {};
              if (!st.positions.length) throw new S.ApiError('NOT_OPEN', 'This ballot has no positions yet. Please contact the election administrator.');
              go('ballot');
            } catch (e) {
              showErr(R.message(e));
              if (e.code === 'CODE_USED') input.select();
              if (['CLOSED', 'PAUSED', 'NOT_OPEN', 'ENDED'].includes(e.code)) later(() => refreshAndRender(), 2500);
            }
          });
        });
        requestAnimationFrame(() => input.focus());
      }

      function renderUnavailable(vs) {
        const e = st.election;
        const map = {
          none: { icon: 'info', title: 'This voting station is not ready', text: kind === 'demo' ? 'The demo election has not been created yet.' : 'The election has not been set up yet. Please contact the election administrator.' },
          not_open: { icon: 'clock', title: 'Voting has not opened yet', text: e && e.starts_at && e.status === 'scheduled' ? `Voting opens at ${U.fmtTime(e.starts_at)} on ${U.fmtDate(e.starts_at)}.` : 'Please wait for the election administrator to open voting.' },
          paused: { icon: 'pause', title: 'Voting is paused', text: 'Please wait. Voting will continue shortly.' },
          closed: { icon: 'lock', title: 'Voting has now closed', text: 'Thank you to everyone who voted.' },
          ended: { icon: 'lock', title: 'Voting has now closed', text: 'The voting period has ended. Thank you.' },
        };
        const m = map[vs.state] || map.not_open;
        U.setHtml(main, html`
          <section class="station-state tone-${vs.tone}">
            <div class="ss-icon">${UI.icon(m.icon, 44)}</div>
            <h1 class="display">${m.title}</h1>
            <p class="lead">${m.text}</p>
            <p class="help">This screen updates automatically.</p>
          </section>`);
      }

      /* ------------------------------------------------------------ ballot */
      const selCount = (p) => (st.sel[p.id] || []).length;
      const isDone = (p) => selCount(p) >= p.min_selections && selCount(p) <= p.max_selections && (p.min_selections > 0 || selCount(p) > 0);
      const isSatisfied = (p) => selCount(p) >= p.min_selections && selCount(p) <= p.max_selections;

      function renderBallot() {
        const total = st.positions.length;
        U.setHtml(main, html`
          <div class="ballot">
            <div class="ballot-head">
              <div>
                <div class="eyebrow">${UI.icon('ballot', 16)} Official ballot${kind === 'demo' ? ' · DEMO' : ''}</div>
                <h1 class="display-sm">${S.brand.title(st.election, st.school)}</h1>
                ${st.election.instructions ? html`<p class="ballot-instructions">${st.election.instructions}</p>` : html`<p class="ballot-instructions">Choose your candidates for each position, then review your vote.</p>`}
              </div>
              <button class="btn btn-secondary" data-act="cancel">${UI.icon('x', 18)}<span>Cancel</span></button>
            </div>
            <nav class="ballot-chips" aria-label="Positions on this ballot">
              ${st.positions.map((p, i) => html`<button class="chip" data-jump="${p.id}"><span class="chip-n">${i + 1}</span><span>${p.name}</span></button>`)}
            </nav>
            ${st.positions.map((p, i) => html`
              <section class="ballot-section" id="pos-${p.id}" data-pos="${p.id}" aria-labelledby="h-${p.id}">
                <header class="bs-head">
                  <div class="eyebrow">Position ${i + 1} of ${total}</div>
                  <h2 id="h-${p.id}">${p.name}</h2>
                  ${p.description ? html`<p class="bs-desc">${p.description}</p>` : ''}
                  <div class="bs-rule"><span class="rule-pill">${U.selectionRule(p)}</span><span class="bs-count" aria-live="polite"></span></div>
                </header>
                <div class="cand-grid" role="${p.max_selections === 1 ? 'radiogroup' : 'group'}" aria-labelledby="h-${p.id}">
                  ${p.candidates.map((c) => html`
                    <article class="cand-card" data-cand="${c.id}" data-pos="${p.id}">
                      <span class="cand-check" aria-hidden="true">${UI.icon('check', 20)}</span>
                      <div class="cand-photo">${UI.avatar(c, 112)}</div>
                      <div class="cand-body">
                        <h3 class="cand-name">${c.name}</h3>
                        <div class="cand-meta">${[c.class_name, c.house].filter(Boolean).join(' · ')}</div>
                        ${c.slogan ? html`<p class="cand-slogan">“${c.slogan}”</p>` : ''}
                      </div>
                      <div class="cand-actions">
                        <button class="btn-select" data-select role="${p.max_selections === 1 ? 'radio' : 'checkbox'}" aria-checked="false" aria-label="Select ${c.name} for ${p.name}">
                          <span class="sel-off">Select</span><span class="sel-on">${UI.icon('check', 18)} Selected</span>
                        </button>
                        ${c.manifesto || c.biography ? html`<button class="btn-link" data-manifesto>Read manifesto</button>` : ''}
                      </div>
                    </article>`)}
                </div>
              </section>`)}
            <div class="ballot-foot">
              <div class="bf-inner">
                <div class="bf-status" aria-live="polite"></div>
                <button class="btn btn-primary btn-xl" data-act="review"><span>Review my vote</span>${UI.icon('arrow-right', 22)}</button>
              </div>
            </div>
          </div>`);
        st.positions.forEach((p) => syncPosition(p));
        syncFooter();
        main.focus({ preventScroll: true });
      }

      function syncPosition(p) {
        const sec = main.querySelector(`[data-pos="${p.id}"].ballot-section`);
        if (!sec) return;
        const chosen = st.sel[p.id] || [];
        U.$$('.cand-card', sec).forEach((card) => {
          const on = chosen.includes(card.dataset.cand);
          card.classList.toggle('is-selected', on);
          card.classList.toggle('is-dimmed', !on && chosen.length >= p.max_selections);
          card.querySelector('[data-select]').setAttribute('aria-checked', String(on));
        });
        const n = chosen.length;
        sec.querySelector('.bs-count').textContent = `${n} of ${p.max_selections} selected`;
        sec.classList.toggle('is-complete', isDone(p));
        const chip = main.querySelector(`[data-jump="${p.id}"]`);
        if (chip) {
          chip.classList.toggle('done', isDone(p));
          chip.querySelector('.chip-n').innerHTML = isDone(p) ? U.toHtml(UI.icon('check', 14)) : String(st.positions.indexOf(p) + 1);
        }
      }
      function syncFooter() {
        const done = st.positions.filter(isSatisfied).length;
        const el = main.querySelector('.bf-status');
        if (el) U.setHtml(el, html`<strong>${done} of ${st.positions.length}</strong> positions ready ${UI.progress(U.pct(done, st.positions.length), { label: 'Ballot completion' })}`);
      }

      function toggle(posId, candId) {
        const p = st.positions.find((x) => x.id === posId);
        if (!p) return;
        const cur = st.sel[p.id] || [];
        if (cur.includes(candId)) st.sel[p.id] = cur.filter((x) => x !== candId);
        else if (p.max_selections === 1) st.sel[p.id] = [candId];
        else if (cur.length >= p.max_selections) {
          UI.toast(`You can choose up to ${p.max_selections} for ${p.name}. Remove a choice first.`, 'warn');
          return;
        } else st.sel[p.id] = [...cur, candId];
        if (!st.sel[p.id].length) delete st.sel[p.id];
        syncPosition(p);
        syncFooter();
      }

      function showManifesto(posId, candId) {
        const p = st.positions.find((x) => x.id === posId);
        const c = p && p.candidates.find((x) => x.id === candId);
        if (!c) return;
        const chosen = (st.sel[p.id] || []).includes(c.id);
        const m = UI.modal({
          title: c.name, size: 'lg',
          body: html`<div class="manifesto">
              <div class="mf-side">${UI.avatar(c, 160)}<div class="cand-meta">${p.name}</div><div class="cand-meta">${[c.class_name, c.house].filter(Boolean).join(' · ')}</div></div>
              <div class="mf-main">
                ${c.slogan ? html`<p class="mf-slogan">“${c.slogan}”</p>` : ''}
                ${c.biography ? html`<h3>About ${c.name}</h3><p class="prewrap">${c.biography}</p>` : ''}
                ${c.manifesto ? html`<h3>Manifesto</h3><div class="prewrap">${c.manifesto}</div>` : ''}
              </div></div>`,
          footer: html`<button class="btn btn-secondary" data-close>Close</button>
            <button class="btn btn-primary" data-pick>${chosen ? 'Remove selection' : html`${UI.icon('check', 18)} Select ${c.name}`}</button>`,
        });
        m.el.querySelector('[data-pick]').addEventListener('click', () => { m.close(); toggle(p.id, c.id); });
      }

      async function goReview() {
        const problems = R.validateBallot(st.positions, st.sel);
        if (problems.length) {
          await UI.modal({
            title: 'Your ballot is incomplete', size: 'sm', tone: 'warn',
            body: html`<p>Please make a selection for:</p><ul class="problem-list">${problems.map((x) => html`<li>${UI.icon('alert', 18)} ${x.text}</li>`)}</ul>`,
            footer: html`<button class="btn btn-primary" data-close autofocus>Go back to my ballot</button>`,
          }).result;
          const first = main.querySelector(`#pos-${CSS.escape(problems[0].position.id)}`);
          if (first) { first.scrollIntoView({ behavior: U.reducedMotion() ? 'auto' : 'smooth', block: 'start' }); first.classList.add('flash'); later(() => first.classList.remove('flash'), 1600); }
          return;
        }
        go('review');
      }

      /* ------------------------------------------------------------ review */
      function renderReview() {
        U.setHtml(main, html`
          <section class="review">
            <div class="eyebrow">${UI.icon('eye', 16)} Check before you submit</div>
            <h1 class="display">Review your vote</h1>
            <p class="lead">Make sure these are the candidates you want.</p>
            <ol class="review-list">
              ${st.positions.map((p) => {
                const chosen = (st.sel[p.id] || []).map((id) => p.candidates.find((c) => c.id === id)).filter(Boolean);
                return html`<li class="review-item">
                  <div class="rv-pos">${p.name}</div>
                  <div class="rv-choices">${chosen.length ? chosen.map((c) => html`<div class="rv-choice">${UI.avatar(c, 52)}<span class="rv-tick">${UI.icon('check', 18)}</span><span class="rv-name">${c.name}</span></div>`)
                    : html`<div class="rv-none">No selection — you skipped this optional position</div>`}</div>
                  <button class="btn btn-ghost btn-sm" data-edit="${p.id}">${UI.icon('edit', 16)} Change</button>
                </li>`;
              })}
            </ol>
            ${UI.callout('warn', 'Once submitted, your vote cannot be changed.', 'Check every position carefully before you continue.')}
            <div class="review-actions">
              <button class="btn btn-secondary btn-lg" data-act="back">${UI.icon('arrow-left', 20)}<span>Edit ballot</span></button>
              <button class="btn btn-success btn-xl" data-act="submit">${UI.icon('check', 22)}<span>Submit final vote</span></button>
            </div>
          </section>`);
        main.focus({ preventScroll: true });
      }

      async function submit() {
        const problems = R.validateBallot(st.positions, st.sel);
        if (problems.length) return go('ballot');
        const ok = await UI.confirm({
          title: 'Submit your final vote?',
          message: html`<p class="confirm-big">Your vote <strong>cannot be changed</strong> after submission.</p>`,
          confirmLabel: 'Confirm vote', cancelLabel: 'Cancel', icon: 'check', armDelay: 1000, size: 'md',
        });
        if (!ok || st.phase !== 'review') return;
        go('submitting');
        try {
          const started = Date.now();
          await S.api.submitBallot(st.token, st.sel);
          // Wipe every trace of the choices before showing success.
          st.sel = {}; st.token = null; st.positions = [];
          const wait = 700 - (Date.now() - started);
          if (wait > 0) await U.sleep(wait);
          go('success');
        } catch (e) {
          st.error = e;
          go('failed');
        }
      }

      function renderSubmitting() {
        U.setHtml(main, html`
          <section class="station-state submitting" role="status" aria-live="assertive">
            <div class="big-spinner" aria-hidden="true"></div>
            <h1 class="display">Recording your vote securely…</h1>
            <p class="lead">Please wait. Do not close this window.</p>
          </section>`);
      }

      function renderSuccess() {
        const e = st.election;
        U.setHtml(main, html`
          <section class="success" role="status" aria-live="assertive">
            <div class="success-mark" aria-hidden="true">
              <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="54"/><path d="M36 62l16 16 34-36"/></svg>
            </div>
            <div class="eyebrow ok">Vote successfully submitted</div>
            <h1 class="display">Thank you for voting!</h1>
            <p class="lead">Thank you for participating in the ${S.brand.title(e, st.school)}.<br>Your vote has been securely recorded.</p>
            ${e && e.confirmation_message ? html`<p class="success-note">${e.confirmation_message}</p>` : ''}
            <p class="leave">${UI.icon('arrow-right', 20)} Please leave the voting station.</p>
            <button class="btn btn-secondary btn-lg" data-act="restart">Return to start</button>
            <p class="countdown" aria-live="off">Ready for the next voter in <b>${RESET_S}</b>s</p>
          </section>`);
        let left = RESET_S;
        clearInterval(countdown);
        countdown = every(() => {
          left -= 1;
          const b = main.querySelector('.countdown b');
          if (b) b.textContent = String(Math.max(0, left));
          if (left <= 0) { clearInterval(countdown); timers.delete(countdown); if (st.phase === 'success') go('ready'); }
        }, 1000);
      }

      function renderFailed() {
        const e = st.error || {};
        const retryable = e.code === 'NETWORK' || e.code === 'SUBMIT_FAILED' || e.code === 'ERROR';
        const stateErr = ['PAUSED', 'CLOSED', 'ENDED', 'NOT_OPEN'].includes(e.code);
        const uncertain = e.code === 'SESSION_EXPIRED' || e.code === 'CODE_USED';
        const detail = stateErr ? R.message(e).text
          : uncertain ? 'We could not confirm your vote. It may already have been recorded, or your session expired.'
          : e.code === 'BALLOT_INVALID' ? R.message(e).text
          : R.message(e).text;
        U.setHtml(main, html`
          <section class="failure" role="alert">
            <div class="ss-icon">${UI.icon('alert', 48)}</div>
            <h1 class="display">${uncertain ? 'Your vote could not be confirmed' : 'Your vote was NOT submitted'}</h1>
            <p class="lead strong">Please do not leave the station. Contact the election administrator.</p>
            <p class="failure-detail">${detail}</p>
            <div class="review-actions">
              ${retryable && st.token ? html`<button class="btn btn-primary btn-lg" data-act="retry">${UI.icon('refresh', 20)}<span>Try again</span></button>` : ''}
              ${e.code === 'BALLOT_INVALID' && st.token ? html`<button class="btn btn-primary btn-lg" data-act="back">${UI.icon('arrow-left', 20)}<span>Back to my ballot</span></button>` : ''}
              <button class="btn btn-secondary btn-lg" data-act="restart">Start over</button>
            </div>
          </section>`);
      }

      /* ------------------------------------------------------------ idle handling */
      function stopIdle() {
        clearTimeout(idleTimer); timers.delete(idleTimer); idleTimer = null;
        if (idleModal) { idleModal.close('keep'); idleModal = null; }
      }
      function bumpIdle() {
        if (idleModal) return;
        clearTimeout(idleTimer); timers.delete(idleTimer);
        if (st.phase !== 'ballot' && st.phase !== 'review') return;
        idleTimer = later(askStillThere, IDLE_MS);
      }
      function askStillThere() {
        let left = 30;
        idleModal = UI.modal({
          title: 'Are you still voting?', size: 'sm', dismissible: false, tone: 'warn',
          body: html`<p>For your privacy this ballot will close in <b class="idle-left">${left}</b> seconds.</p><p class="help">Your code has not been used yet.</p>`,
          footer: html`<button class="btn btn-primary btn-lg" data-keep autofocus>I'm still voting</button>`,
        });
        const m = idleModal;
        m.el.querySelector('[data-keep]').addEventListener('click', () => m.close('keep'));
        const t = every(() => {
          left -= 1;
          const b = m.el.querySelector('.idle-left');
          if (b) b.textContent = String(left);
          if (left <= 0) m.close('timeout');
        }, 1000);
        m.result.then((v) => {
          clearInterval(t); timers.delete(t);
          idleModal = null;
          if (v === 'timeout') { UI.toast('The ballot closed because nobody was using it. That code was not used.', 'info', 7000); go('ready'); }
          else bumpIdle();
        });
      }

      /* ------------------------------------------------------------ events */
      const onClick = async (e) => {
        const t = e.target;
        const act = t.closest('[data-act]');
        if (act) {
          const a = act.dataset.act;
          if (a === 'fullscreen') { await UI.fullscreen.toggle(); later(renderBar, 300); }
          else if (a === 'review') goReview();
          else if (a === 'back') go('ballot');
          else if (a === 'submit') submit();
          else if (a === 'restart') { clearInterval(countdown); go('ready'); }
          else if (a === 'retry') { go('submitting'); try { await S.api.submitBallot(st.token, st.sel); st.sel = {}; st.token = null; st.positions = []; go('success'); } catch (err) { st.error = err; go('failed'); } }
          else if (a === 'cancel') {
            const ok = await UI.confirm({ title: 'Cancel your ballot?', message: 'Your choices will be cleared. Your code has not been used, so you can start again.', confirmLabel: 'Yes, cancel', cancelLabel: 'Keep voting', danger: true });
            if (ok) go('ready');
          }
          return;
        }
        const jump = t.closest('[data-jump]');
        if (jump) {
          const sec = main.querySelector(`#pos-${CSS.escape(jump.dataset.jump)}`);
          if (sec) sec.scrollIntoView({ behavior: U.reducedMotion() ? 'auto' : 'smooth', block: 'start' });
          return;
        }
        const edit = t.closest('[data-edit]');
        if (edit) {
          const id = edit.dataset.edit;
          go('ballot');
          const sec = main.querySelector(`#pos-${CSS.escape(id)}`);
          if (sec) sec.scrollIntoView({ block: 'start' });
          return;
        }
        const card = t.closest('.cand-card');
        if (card && st.phase === 'ballot') {
          if (t.closest('[data-manifesto]')) return showManifesto(card.dataset.pos, card.dataset.cand);
          toggle(card.dataset.pos, card.dataset.cand);
        }
      };
      root.addEventListener('click', onClick);
      const onActivity = () => { if (st.phase === 'ballot' || st.phase === 'review') bumpIdle(); };
      ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => root.addEventListener(ev, onActivity, { passive: true }));
      const onUnload = (e) => { if (['ballot', 'review', 'submitting'].includes(st.phase)) { e.preventDefault(); e.returnValue = ''; } };
      window.addEventListener('beforeunload', onUnload);
      const onFs = () => renderBar();
      document.addEventListener('fullscreenchange', onFs);

      /* ------------------------------------------------------------ live state */
      let lastState = null;
      async function refreshAndRender() {
        try { await loadElection(); } catch (e) { return; }
        const vs = R.votingState(st.election);
        if (st.phase === 'ready' && vs.state !== lastState) { lastState = vs.state; go('ready'); }
        else renderBar();
      }
      const refreshSoon = U.throttle(refreshAndRender, 1500);

      await loadElection();
      lastState = R.votingState(st.election).state;
      go('ready');

      if (st.election) {
        unsubs.push(S.api.subscribe(st.election.id, (evt) => { if (evt.type !== 'vote' && evt.type !== 'station' && evt.type !== 'realtime') refreshSoon(); }));
        const beat = () => st.election && S.api.stationHeartbeat(st.election.id, sid, sid);
        beat();
        every(beat, 30000);
      } else {
        unsubs.push(S.api.subscribe(null, () => refreshSoon()));
      }
      // Time-based changes (scheduled opening / end time) and a polling safety net.
      every(() => {
        const vs = R.votingState(st.election);
        if (st.phase === 'ready' && vs.state !== lastState) { lastState = vs.state; go('ready'); }
      }, 5000);
      every(() => { if (st.phase === 'ready') refreshAndRender(); }, 30000);

      this.canLeave = () => {
        if (['ballot', 'review', 'submitting'].includes(st.phase)) {
          UI.toast('Please finish or cancel your ballot first.', 'warn');
          return false;
        }
        return true;
      };

      return () => {
        timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
        unsubs.forEach((u) => u());
        stopIdle();
        root.removeEventListener('click', onClick);
        window.removeEventListener('beforeunload', onUnload);
        document.removeEventListener('fullscreenchange', onFs);
        document.body.classList.remove('mode-station');
        this.canLeave = null;
        st.sel = {}; st.token = null;
      };
    },
  };
})(window.SGE);
