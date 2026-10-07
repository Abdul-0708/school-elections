/* LIVE RESULTS / PROJECTOR SCREEN  (#/results, #/results/demo, #/results/<election-id>)
   A broadcast-style display for a hall screen or Smartboard.  It only ever receives
   aggregate counts from the server.  Modes: Overview · Position focus · Rotate · Winners. */
(function (S) {
  'use strict';
  const U = S.util, UI = S.ui, R = S.rules, html = U.html, raw = U.raw;
  const MODES = [
    { id: 'overview', label: 'Overview', icon: 'grid', key: 'o' },
    { id: 'focus', label: 'Position', icon: 'target', key: 'p' },
    { id: 'rotate', label: 'Rotate', icon: 'refresh', key: 'r' },
    { id: 'final', label: 'Winners', icon: 'trophy', key: 'w' },
  ];

  S.views.results = {
    async mount(root, params) {
      const which = params[0] || 'live';
      const prefs = U.store.get('sge.results.prefs', {}) || {};
      const timers = new Set();
      const every = (fn, ms) => { const t = setInterval(fn, ms); timers.add(t); return t; };
      let data = null, failing = false, lastOk = 0, electionId = null;
      let mode = prefs.mode || null, posIndex = 0, rotateTimer = null, signature = '', hideTimer = null;
      let unsub = null;

      document.body.classList.add('mode-broadcast');
      root.className = 'view-results';
      S.brand.setDocTitle('Live Results');

      async function resolveElection() {
        const pub = await S.refreshPublic();
        if (which === 'live' || which === 'demo') return pub[which] ? pub[which].id : null;
        return which;
      }

      function frame() {
        const school = (data && data.school) || (S.state.pub && S.state.pub.school);
        const e = data && data.election;
        U.setHtml(root, html`
          <div class="bc ${e && e.is_demo ? 'is-demo' : ''}" id="bc">
            <div class="bc-bg" aria-hidden="true"><i></i><i></i></div>
            <header class="bc-head">
              <div class="bc-brand">${UI.logo(school, 72, 'bc-logo')}
                <div><div class="bc-school">${(school && school.name) || ''}</div><div class="bc-title">${S.brand.title(e, school)}</div></div>
              </div>
              <div class="bc-badge" id="bc-badge"></div>
            </header>
            ${e && e.is_demo ? html`<div class="demo-ribbon bc-ribbon">${UI.icon('flask', 18)}<span>DEMO MODE · NO REAL VOTES</span></div>` : ''}
            <div class="bc-progress" id="bc-progress" aria-hidden="true"><i></i></div>
            <main class="bc-main" id="bc-main" aria-live="off"></main>
            <footer class="bc-ticker" id="bc-ticker"></footer>
            <div class="bc-toolbar" id="bc-tools" role="toolbar" aria-label="Display controls"></div>
          </div>`);
        renderTicker(true);
        renderTools();
        renderBadge();
      }

      /* ------------------------------------------------------------ helpers */
      const finalAvailable = () => !!(data && data.final);
      function effectiveMode() {
        if (!data || data.sealed) return 'sealed';
        if (!data.positions.length) return 'empty';
        if (mode === 'final' && !finalAvailable()) return 'overview';
        if (!mode) return finalAvailable() ? 'final' : (data.positions.length > 1 ? 'overview' : 'focus');
        return mode;
      }
      const rotationMs = () => 1000 * (prefs.rotate || (data && data.election && data.election.rotation_seconds) || 12);
      const curPos = () => data.positions[((posIndex % data.positions.length) + data.positions.length) % data.positions.length];

      function renderBadge() {
        const el = root.querySelector('#bc-badge');
        if (!el || !data) return;
        const vs = R.votingState(data.election);
        if (data.final) U.setHtml(el, html`<span class="bc-pill final">${UI.icon('trophy', 22)} Official final results</span>`);
        else if (data.sealed) U.setHtml(el, html`<span class="bc-pill sealed">${UI.icon('lock', 20)} Results sealed</span>`);
        else U.setHtml(el, html`<span class="bc-pill live"><span class="live-dot"></span>Live results</span>
          ${vs.state !== 'open' ? html`<span class="bc-pill muted">${vs.label}</span>` : ''}
          ${data.privileged && data.election.results_visibility !== 'live' ? html`<span class="bc-pill muted">Admin preview</span>` : ''}`);
      }

      function renderTicker(force) {
        const el = root.querySelector('#bc-ticker');
        if (!el) return;
        const s = (data && data.stats) || { eligible: 0, cast: 0, remaining: 0, turnout: 0 };
        if (force || !el.firstChild) {
          U.setHtml(el, html`
            <div class="tk"><span class="tk-l">Eligible voters</span><span class="tk-v tnum" id="tk-eligible">${U.fmtInt(s.eligible)}</span></div>
            <div class="tk"><span class="tk-l">Votes cast</span><span class="tk-v tnum" id="tk-cast">${U.fmtInt(s.cast)}</span></div>
            <div class="tk"><span class="tk-l">Remaining</span><span class="tk-v tnum" id="tk-remaining">${U.fmtInt(s.remaining)}</span></div>
            <div class="tk tk-turnout"><span class="tk-l">Turnout</span><span class="tk-v tnum" id="tk-turnout">${U.fmtPct(s.turnout)}</span>
              <div class="tk-bar"><i style="width:${U.clamp(s.turnout, 0, 100)}%"></i></div></div>
            <div class="tk-status" id="tk-status"></div>`);
          ['eligible', 'cast', 'remaining'].forEach((k) => { const n = el.querySelector('#tk-' + k); n.dataset.value = s[k]; });
          el.querySelector('#tk-turnout').dataset.value = s.turnout;
        } else {
          ['eligible', 'cast', 'remaining'].forEach((k) => U.animateNumber(el.querySelector('#tk-' + k), s[k]));
          U.animateNumber(el.querySelector('#tk-turnout'), s.turnout, { format: (v) => U.fmtPct(v) });
          el.querySelector('.tk-bar i').style.width = `${U.clamp(s.turnout, 0, 100)}%`;
        }
        renderStatus();
      }
      function renderStatus() {
        const el = root.querySelector('#tk-status');
        if (!el) return;
        if (failing) U.setHtml(el, html`<span class="dot warn"></span>Reconnecting…`);
        else if (data && data.final) U.setHtml(el, html`${UI.icon('lock', 16)} Closed ${U.fmtTime(data.election.closed_at)}`);
        else U.setHtml(el, html`<span class="dot live"></span>Live · updated ${U.relTime(lastOk)}`);
      }

      function renderTools() {
        const el = root.querySelector('#bc-tools');
        if (!el) return;
        const m = effectiveMode();
        const showPos = data && data.positions && data.positions.length > 0 && (m === 'focus' || m === 'rotate' || m === 'final');
        const secs = rotationMs() / 1000;
        U.setHtml(el, html`
          <div class="seg">${MODES.filter((x) => x.id !== 'final' || finalAvailable()).map((x) => html`
            <button class="${m === x.id ? 'on' : ''}" data-mode="${x.id}" title="${x.label} (${x.key.toUpperCase()})" aria-pressed="${m === x.id}">${UI.icon(x.icon, 18)}<span>${x.label}</span></button>`)}</div>
          ${showPos ? html`<div class="seg">
              <button data-step="-1" aria-label="Previous position">${UI.icon('chevron-left', 18)}</button>
              <select data-pos aria-label="Choose position">${data.positions.map((p, i) => html`<option value="${i}" ${raw(i === ((posIndex % data.positions.length) + data.positions.length) % data.positions.length ? 'selected' : '')}>${p.name}</option>`)}</select>
              <button data-step="1" aria-label="Next position">${UI.icon('chevron-right', 18)}</button></div>` : ''}
          ${m === 'rotate' || m === 'final' ? html`<label class="seg seg-label">${UI.icon('clock', 16)}<select data-rot aria-label="Seconds per position">${[5, 8, 10, 12, 15, 20, 30, 60].map((n) => html`<option value="${n}" ${raw(n === secs ? 'selected' : '')}>${n}s</option>`)}</select></label>` : ''}
          <div class="seg">
            <button data-act="fs" title="Full screen (F)" aria-label="Toggle full screen">${UI.icon(UI.fullscreen.active() ? 'minimize' : 'maximize', 18)}</button>
            <a href="#/" title="Exit" aria-label="Exit results screen">${UI.icon('x', 18)}</a>
          </div>`);
      }

      /* ------------------------------------------------------------ main area */
      function computeSignature() {
        const m = effectiveMode();
        if (!data || m === 'sealed' || m === 'empty') return m + (data ? data.election.status : '');
        const pos = (m === 'overview') ? data.positions : [curPos()];
        return [m, data.final, posIndex % data.positions.length, ...pos.map((p) => p.id + ':' + p.candidates.map((c) => c.id).join(','))].join('|');
      }

      function rowHtml(c, max, big, final) {
        const w = max > 0 ? (c.votes / max) * 100 : 0;
        return html`<div class="r ${c.leading ? 'is-leading' : ''} ${c.winner ? 'is-winner' : ''} ${c.tie && final ? 'is-tie' : ''}" data-cid="${c.id}">
          <span class="r-rank tnum">${c.rank}</span>
          ${UI.avatar(c, big ? 92 : 46, 'r-avatar')}
          <div class="r-body">
            <div class="r-top"><span class="r-name">${c.name}</span>
              <span class="r-flags">${c.winner ? html`<span class="flag win">${UI.icon('trophy', 14)} Winner</span>` : c.tie && final ? html`<span class="flag tie">Tie</span>` : c.leading ? html`<span class="flag lead">Leading</span>` : ''}</span>
              ${big && c.class_name ? html`<span class="r-class">${c.class_name}</span>` : ''}</div>
            <div class="r-track"><div class="r-fill" style="width:${w.toFixed(2)}%"></div></div>
          </div>
          <div class="r-nums"><span class="r-votes tnum" data-value="${c.votes}">${U.fmtInt(c.votes)}</span><span class="r-pct tnum" data-value="${c.pct}">${U.fmtPct(c.pct)}</span></div>
        </div>`;
      }

      function topNote(p) {
        if (!p.total_votes) return html`<span class="pos-note">No votes yet</span>`;
        if (!data.final && p.candidates.some((c) => c.tie)) return html`<span class="pos-note tie">${p.seats > 1 ? 'Tie for the last seat' : 'Tied for first'}</span>`;
        return html`<span class="pos-note">${U.plural(p.total_votes, 'vote')}</span>`;
      }

      function renderMain() {
        const main = root.querySelector('#bc-main');
        if (!main) return;
        const m = effectiveMode();
        signature = computeSignature();
        main.dataset.mode = m;
        const e = data && data.election;
        if (m === 'sealed') {
          U.setHtml(main, html`<section class="bc-splash">
            <div class="splash-icon">${UI.icon('lock', 64)}</div>
            <h1>Results will be announced ${e && e.results_visibility === 'after_close' ? 'when voting closes' : 'by the election committee'}</h1>
            <p>Every vote is being counted securely. Turnout is shown live below.</p></section>`);
          return;
        }
        if (m === 'empty') {
          const vs = R.votingState(e);
          U.setHtml(main, html`<section class="bc-splash">
            <div class="splash-icon">${UI.icon('chart', 64)}</div>
            <h1>${e ? 'Live results will appear here' : 'No election has been set up yet'}</h1>
            <p>${e && vs.state === 'not_open' && e.starts_at ? `Voting opens at ${U.fmtTime(e.starts_at)} on ${U.fmtDate(e.starts_at)}.` : 'Results update automatically as votes are cast.'}</p></section>`);
          return;
        }
        if (m === 'overview') {
          main.style.setProperty('--cols', String(Math.min(3, data.positions.length)));
          U.setHtml(main, html`<div class="ov-grid ${data.positions.length > 6 ? 'dense' : ''}">${data.positions.map((p) => {
            const max = Math.max(0, ...p.candidates.map((c) => c.votes));
            const shown = p.candidates.slice(0, 5);
            return html`<section class="ov-card" data-pid="${p.id}">
              <header><h2>${p.name}</h2>${topNote(p)}</header>
              <div class="rows">${shown.map((c) => rowHtml(c, max, false, data.final))}</div>
              ${p.candidates.length > 5 ? html`<div class="ov-more">+ ${p.candidates.length - 5} more</div>` : ''}
            </section>`;
          })}</div>`);
          return;
        }
        const p = curPos();
        const idx = data.positions.indexOf(p);
        if (m === 'final') return renderWinner(main, p, idx);
        const max = Math.max(0, ...p.candidates.map((c) => c.votes));
        U.setHtml(main, html`<section class="fx enter">
          <header class="fx-head">
            <div class="fx-eyebrow">Position ${idx + 1} of ${data.positions.length}${p.seats > 1 ? ` · ${p.seats} seats` : ''}</div>
            <h1 class="fx-name">${p.name}</h1>
            ${topNote(p)}
          </header>
          <div class="rows big">${p.candidates.map((c) => rowHtml(c, max, true, data.final))}</div>
          ${dots(idx)}
        </section>`);
      }

      const dots = (idx) => (data.positions.length > 1 ? html`<div class="pos-dots" aria-hidden="true">${data.positions.map((_, i) => html`<i class="${i === idx ? 'on' : ''}"></i>`)}</div>` : '');

      function renderWinner(main, p, idx) {
        const winners = p.candidates.filter((c) => c.winner);
        const tied = p.candidates.filter((c) => c.tie);
        const others = p.candidates.filter((c) => !c.winner && !c.tie);
        const sparkles = U.reducedMotion() ? '' : html`<div class="sparkles" aria-hidden="true">${Array.from({ length: 16 }, (_, i) => html`<i style="--x:${(i * 61) % 100}%;--d:${(i % 5) * 0.7}s;--s:${0.6 + (i % 3) * 0.3}"></i>`)}</div>`;
        let body;
        if (p.outcome === 'none') {
          body = html`<div class="win-none">No votes were cast for this position.</div>`;
        } else if (p.outcome === 'tie') {
          body = html`
            ${winners.length ? html`<div class="win-many">${winners.map((c) => winCard(c))}</div>` : ''}
            <div class="win-tie"><div class="tie-word">TIE</div>
              <div class="win-many">${tied.map((c) => winCard(c, true))}</div>
              <p>${U.plural(tied.length, 'candidate')} tied${winners.length ? ' for the remaining seat' : ''} — no winner declared. The tie will be resolved under the school's election rules.</p></div>`;
        } else if (winners.length === 1) {
          const c = winners[0];
          body = html`<div class="win-one">
            <div class="win-photo">${UI.avatar(c, 220)}</div>
            <div class="win-name">${c.name}</div>
            ${c.class_name ? html`<div class="win-class">${c.class_name}</div>` : ''}
            <div class="win-stats"><span><b class="tnum">${U.fmtInt(c.votes)}</b> votes</span><span class="sep"></span><span><b class="tnum">${U.fmtPct(c.pct)}</b></span></div>
            <div class="win-congrats">Congratulations</div></div>`;
        } else {
          body = html`<div class="win-many">${winners.map((c) => winCard(c))}</div><div class="win-congrats">Congratulations</div>`;
        }
        U.setHtml(main, html`<section class="win enter">
          ${p.outcome !== 'none' && p.outcome !== 'tie' ? sparkles : ''}
          <div class="win-eyebrow">${UI.icon('trophy', 26)} Official result</div>
          <h1 class="win-pos">${p.name}</h1>
          ${body}
          ${others.length && p.outcome !== 'none' ? html`<div class="win-others">${others.map((c) => html`<span>${c.name} <b class="tnum">${U.fmtInt(c.votes)}</b> · ${U.fmtPct(c.pct)}</span>`)}</div>` : ''}
          ${dots(idx)}
        </section>`);
      }
      const winCard = (c, tie) => html`<div class="win-card ${tie ? 'tie' : ''}">${UI.avatar(c, 120)}<div class="wc-name">${c.name}</div><div class="wc-stats tnum">${U.fmtInt(c.votes)} votes · ${U.fmtPct(c.pct)}</div></div>`;

      /* In-place update with animated numbers, bars and FLIP re-ordering. */
      function patchMain() {
        const main = root.querySelector('#bc-main');
        const m = effectiveMode();
        if (!main || m === 'final') return renderMain();
        const positions = m === 'overview' ? data.positions : [curPos()];
        positions.forEach((p) => {
          const container = m === 'overview' ? main.querySelector(`[data-pid="${CSS.escape(p.id)}"] .rows`) : main.querySelector('.rows');
          if (!container) return;
          const header = container.parentElement.querySelector('.pos-note');
          if (header) header.outerHTML = U.toHtml(topNote(p));
          const max = Math.max(0, ...p.candidates.map((c) => c.votes));
          const els = new Map(U.$$('[data-cid]', container).map((el) => [el.dataset.cid, el]));
          const before = new Map();
          els.forEach((el, id) => before.set(id, el.getBoundingClientRect().top));
          const list = m === 'overview' ? p.candidates.slice(0, 5) : p.candidates;
          list.forEach((c) => {
            const el = els.get(c.id);
            if (!el) return;
            const prev = Number(el.querySelector('.r-votes').dataset.value || 0);
            U.animateNumber(el.querySelector('.r-votes'), c.votes);
            U.animateNumber(el.querySelector('.r-pct'), c.pct, { format: (v) => U.fmtPct(v) });
            el.querySelector('.r-rank').textContent = c.rank;
            el.querySelector('.r-fill').style.width = `${(max > 0 ? (c.votes / max) * 100 : 0).toFixed(2)}%`;
            el.classList.toggle('is-leading', !!c.leading);
            el.classList.toggle('is-winner', !!c.winner);
            const flags = el.querySelector('.r-flags');
            flags.innerHTML = U.toHtml(c.winner ? html`<span class="flag win">${UI.icon('trophy', 14)} Winner</span>` : c.leading ? html`<span class="flag lead">Leading</span>` : '');
            if (c.votes > prev) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
            container.appendChild(el);
          });
          if (U.reducedMotion()) return;
          els.forEach((el, id) => {
            const dy = before.get(id) - el.getBoundingClientRect().top;
            if (!dy) return;
            el.style.transition = 'none';
            el.style.transform = `translateY(${dy}px)`;
            requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = ''; el.style.transform = ''; }));
          });
        });
      }

      function restartRotation() {
        clearInterval(rotateTimer); timers.delete(rotateTimer); rotateTimer = null;
        const bar = root.querySelector('#bc-progress');
        const m = effectiveMode();
        if (!bar) return;
        if ((m === 'rotate' || m === 'final') && data && data.positions.length > 1) {
          const ms = rotationMs();
          const fill = bar.querySelector('i');
          bar.classList.add('on');
          const kick = () => {
            fill.style.transition = 'none'; fill.style.width = '0%';
            requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.transition = `width ${ms}ms linear`; fill.style.width = '100%'; }));
          };
          kick();
          rotateTimer = every(() => { posIndex += 1; renderMain(); renderTools(); kick(); }, ms);
        } else bar.classList.remove('on');
      }

      function setMode(next) {
        mode = next;
        prefs.mode = next;
        U.store.set('sge.results.prefs', prefs);
        renderMain(); renderTools(); restartRotation();
      }

      /* ------------------------------------------------------------ data */
      async function fetchResults() {
        if (!electionId) return;
        try {
          const next = await S.api.getResults(electionId);
          const firstLoad = !data;
          const finalChanged = data && data.final !== next.final;
          data = next;
          failing = false;
          lastOk = Date.now();
          if (data.school) S.brand.apply(data.school);
          if (firstLoad || finalChanged) {
            if (finalChanged && next.final) mode = 'final';
            frame(); renderMain(); restartRotation();
            return;
          }
          renderBadge();
          renderTicker(false);
          if (computeSignature() !== signature) { renderMain(); renderTools(); restartRotation(); }
          else patchMain();
        } catch (e) {
          failing = true;
          if (!data) {
            U.setHtml(root, html`<div class="bc"><main class="bc-main"><section class="bc-splash">${UI.errorState(e)}</section></main></div>`);
            const b = root.querySelector('[data-retry]');
            if (b) b.onclick = () => fetchResults();
          } else renderStatus();
        }
      }
      const fetchSoon = U.throttle(fetchResults, 1200);

      /* ------------------------------------------------------------ events */
      const onClick = (e) => {
        const t = e.target;
        const mb = t.closest('[data-mode]');
        if (mb) return setMode(mb.dataset.mode);
        const sb = t.closest('[data-step]');
        if (sb) { posIndex += Number(sb.dataset.step); if (effectiveMode() === 'overview') mode = 'focus'; renderMain(); renderTools(); restartRotation(); return; }
        if (t.closest('[data-act="fs"]')) { UI.fullscreen.toggle(); return; }
      };
      const onChange = (e) => {
        if (e.target.matches('[data-pos]')) { posIndex = Number(e.target.value); renderMain(); restartRotation(); }
        if (e.target.matches('[data-rot]')) { prefs.rotate = Number(e.target.value); U.store.set('sge.results.prefs', prefs); restartRotation(); }
      };
      const onKey = (e) => {
        if ((e.target.matches && e.target.matches('input, select, textarea')) || e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key.toLowerCase();
        const mm = MODES.find((x) => x.key === k);
        if (mm && (mm.id !== 'final' || finalAvailable())) setMode(mm.id);
        else if (k === 'f') UI.fullscreen.toggle();
        else if (k === 'arrowright' || k === 'arrowleft') {
          posIndex += k === 'arrowright' ? 1 : -1;
          if (effectiveMode() === 'overview') mode = 'focus';
          renderMain(); renderTools(); restartRotation();
        }
        wake();
      };
      const wake = () => {
        const bc = root.querySelector('#bc');
        if (!bc) return;
        bc.classList.remove('idle');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => bc.classList.add('idle'), 3500);
      };
      const onFs = () => renderTools();
      root.addEventListener('click', onClick);
      root.addEventListener('change', onChange);
      document.addEventListener('keydown', onKey);
      root.addEventListener('pointermove', wake);
      root.addEventListener('touchstart', wake, { passive: true });
      document.addEventListener('fullscreenchange', onFs);

      /* ------------------------------------------------------------ start */
      U.setHtml(root, html`<div class="bc"><main class="bc-main"><section class="bc-splash">${UI.loading('Loading live results…')}</section></main></div>`);
      electionId = await resolveElection();
      if (!electionId) {
        data = null;
        frame();
        renderMain();
      } else {
        await fetchResults();
        unsub = S.api.subscribe(electionId, (evt) => { if (evt.type !== 'station' && evt.type !== 'realtime') fetchSoon(); });
      }
      every(() => { if (electionId) fetchResults(); else resolveElection().then((id) => { if (id) { electionId = id; fetchResults(); unsub = S.api.subscribe(electionId, () => fetchSoon()); } }); }, 20000);
      every(renderStatus, 1000);
      wake();

      return () => {
        timers.forEach((t) => clearInterval(t));
        clearTimeout(hideTimer);
        if (unsub) unsub();
        root.removeEventListener('click', onClick);
        root.removeEventListener('change', onChange);
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('fullscreenchange', onFs);
        document.body.classList.remove('mode-broadcast');
        if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
      };
    },
  };
})(window.SGE);
