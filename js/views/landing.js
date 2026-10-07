/* LANDING PAGE  (#/) — school identity, election status and the two big doors:
   Cast your vote · Live results. */
(function (S) {
  'use strict';
  const U = S.util, UI = S.ui, R = S.rules, html = U.html;

  S.views.landing = {
    async mount(root) {
      root.className = 'view-landing';
      const timers = [];
      let unsub = null;

      async function draw() {
        const pub = await S.refreshPublic();
        const { school, live, demo } = pub;
        const vs = R.votingState(live);
        S.brand.setDocTitle(live ? live.name : 'Welcome', school);
        const year = (live && live.academic_year) || (school && school.academic_year) || '';
        const name = (live && live.name) || 'Student Government Elections';
        const statusMap = {
          open: { cls: 'ok', text: 'Election open' },
          not_open: { cls: 'warn', text: 'Election not yet open' },
          paused: { cls: 'warn', text: 'Voting paused' },
          closed: { cls: 'danger', text: 'Election closed' },
          ended: { cls: 'danger', text: 'Election closed' },
          none: { cls: 'muted', text: 'Not set up yet' },
        };
        const st = statusMap[vs.state] || statusMap.none;
        const fresh = !school && !live;
        U.setHtml(root, html`
          <div class="landing">
            <header class="landing-top">
              <div class="lt-brand">${UI.logo(school, 40)}<span>${(school && school.name) || 'Student Elections'}</span></div>
              <nav class="lt-nav" aria-label="Main">
                <a class="btn btn-ghost btn-sm" href="#/results">${UI.icon('chart', 18)}<span>Live results</span></a>
                <a class="btn btn-ghost btn-sm" href="#/admin">${UI.icon('lock', 18)}<span>Administrator</span></a>
              </nav>
            </header>
            <main class="hero">
              ${U.safeImg(school && school.banner_url) ? html`<div class="hero-banner" aria-hidden="true" style="background-image:url('${String(school.banner_url).replace(/['()\\]/g, encodeURIComponent)}')"></div>` : ''}
              <div class="hero-glow" aria-hidden="true"></div>
              <div class="hero-inner">
                <div class="hero-logo">${UI.logo(school, 112)}</div>
                ${school ? html`<div class="hero-school">${school.name}</div>` : ''}
                ${school && school.motto ? html`<div class="hero-motto">“${school.motto}”</div>` : ''}
                <h1 class="hero-title">${year && !name.includes(String(year).slice(0, 4)) ? html`<span class="hero-year">${year}</span>` : ''}${name}</h1>
                ${live && live.subtitle ? html`<p class="hero-sub">${live.subtitle}</p>` : ''}
                <p class="hero-tag"><span>Your Voice.</span> <span>Your Choice.</span> <span>Your School.</span></p>
                <div class="hero-status">
                  <span class="big-status tone-${st.cls}" role="status"><span class="dot"></span>${st.text}</span>
                  ${live && (live.starts_at || live.ends_at) ? html`<span class="hero-window">${UI.icon('calendar', 18)} ${live.starts_at ? U.fmtDateTime(live.starts_at) : 'Opens on the day'}${live.ends_at ? html` – ${U.fmtTime(live.ends_at)}` : ''}</span>` : ''}
                </div>
                ${fresh ? html`
                  <div class="hero-actions">
                    <a class="btn btn-primary btn-xl" href="#/admin">${UI.icon('sparkles', 22)}<span>Set up your election</span></a>
                    ${demo ? html`<a class="btn btn-secondary btn-xl" href="#/vote/demo">${UI.icon('flask', 22)}<span>Try the demo ballot</span></a>` : ''}
                  </div>
                  <p class="hero-note">Welcome! An administrator needs to set up the school, positions, candidates and voters first.</p>` : html`
                  <div class="hero-actions">
                    <a class="btn btn-primary btn-xl" href="#/vote">${UI.icon('ballot', 24)}<span>Cast your vote</span></a>
                    <a class="btn btn-secondary btn-xl" href="#/results">${UI.icon('chart', 24)}<span>Live results</span></a>
                  </div>
                  ${live && live.description ? html`<p class="hero-note">${live.description}</p>` : ''}`}
              </div>
            </main>
            <section class="landing-strip" aria-label="How this election works">
              <div class="ls-item">${UI.icon('key', 26)}<div><h3>One student, one vote</h3><p>Every voter gets a private code that works exactly once.</p></div></div>
              <div class="ls-item">${UI.icon('shield', 26)}<div><h3>Secret ballot</h3><p>Ballots are stored without any link to who cast them.</p></div></div>
              <div class="ls-item">${UI.icon('live', 26)}<div><h3>Transparent results</h3><p>Counts update live on the big screen as votes arrive.</p></div></div>
            </section>
            <footer class="landing-foot">
              <span>${(school && school.name) || ''}${year ? ` · ${year}` : ''}</span>
              ${demo ? html`<a href="#/vote/demo">${UI.icon('flask', 16)} Demo ballot</a><a href="#/results/demo">Demo results</a>` : ''}
              ${S.api.mode === 'local' ? html`<span class="badge tone-warn">Local demo mode — data stays in this browser</span>` : ''}
            </footer>
          </div>`);
      }

      await draw();
      const redraw = U.throttle(() => draw().catch(() => {}), 2000);
      let last = {};
      unsub = S.api.subscribe(null, (evt) => {
        if (evt.type === 'vote' || evt.type === 'station' || evt.type === 'realtime') return;
        if (evt.type === 'pulse' && evt.pulse) {
          const k = `${evt.pulse.status}:${evt.pulse.config_version}`;
          if (last[evt.election_id] === k) return;
          const first = !(evt.election_id in last);
          last[evt.election_id] = k;
          if (first && evt.pulse.config_version === 0) return;
        }
        redraw();
      });
      timers.push(setInterval(() => redraw(), 60000));
      return () => { timers.forEach(clearInterval); if (unsub) unsub(); };
    },
  };
})(window.SGE);
