/* Printable outputs: voting-code cards and the official results report.
   Content is rendered into #print-root only for the duration of printing, then wiped,
   so printed codes never linger in the page. */
(function (S) {
  'use strict';
  const U = S.util, html = U.html, UI = S.ui;
  const P = (S.print = {});

  function printNow(content, cls) {
    const root = document.getElementById('print-root');
    root.className = cls || '';
    U.setHtml(root, content);
    document.body.classList.add('printing');
    let cleaned = false;
    const done = () => {
      if (cleaned) return;
      cleaned = true;
      document.body.classList.remove('printing');
      U.setHtml(root, '');
      root.className = '';
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    const imgs = U.$$('img', root).filter((i) => !i.complete);
    Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))).then(() => {
      setTimeout(() => { window.print(); setTimeout(done, 1500); }, 150);
    });
  }

  /* list: [{ code, student_reference, class_name }] */
  P.codes = (list, { school, election, includeRef = true } = {}) => {
    const full = S.brand.title(election, school);
    const year = (election && election.academic_year) || (school && school.academic_year) || '';
    const title = full.length <= 28 ? full : `${year} Student Election`.trim();
    const demo = election && election.is_demo;
    printNow(html`
      <div class="print-codes">
        ${list.map((c) => html`
          <div class="pc-card">
            <div class="pc-top">${UI.logo(school, 22)}<span>${title}</span></div>
            <div class="pc-label">Your voting code</div>
            <div class="pc-code">${c.code}</div>
            <div class="pc-note">Keep this code private. It works only once.</div>
            <div class="pc-foot">
              ${includeRef ? html`<span>${c.student_reference}${c.class_name ? ' · ' + c.class_name : ''}</span>` : html`<span></span>`}
              ${demo ? html`<b class="pc-demo">DEMO — NOT VALID</b>` : html`<span>${(school && school.name) || ''}</span>`}
            </div>
          </div>`)}
      </div>`, 'print-codes-root');
  };

  P.codesCSV = (list, election) => {
    const rows = [['Student Reference', 'Class', 'Voting Code'], ...list.map((c) => [c.student_reference, c.class_name, c.code])];
    U.download(`voting-codes-${U.slug(election && election.name)}${election && election.is_demo ? '-DEMO' : ''}.csv`, U.toCSV(rows));
  };

  /* results: object returned by api.getResults() */
  P.results = (results) => {
    const { election, school, stats, positions } = results;
    const official = results.final;
    printNow(html`
      <div class="print-report">
        <header class="pr-head">
          ${UI.logo(school, 64)}
          <div>
            <div class="pr-school">${(school && school.name) || ''}</div>
            ${school && school.motto ? html`<div class="pr-motto">${school.motto}</div>` : ''}
          </div>
        </header>
        <h1 class="pr-title">${S.brand.title(election, school)}</h1>
        <div class="pr-kind ${official ? '' : 'is-provisional'}">${official ? 'Official final results' : 'Provisional results — not final'}${election.is_demo ? ' · DEMO ELECTION' : ''}</div>
        <table class="pr-summary">
          <tr><th>Eligible voters</th><td>${U.fmtInt(stats.eligible)}</td><th>Votes cast</th><td>${U.fmtInt(stats.cast)}</td></tr>
          <tr><th>Turnout</th><td>${U.fmtPct(stats.turnout)}</td><th>Did not vote</th><td>${U.fmtInt(stats.remaining)}</td></tr>
          <tr><th>Voting opened</th><td>${U.fmtDateTime(election.opened_at)}</td><th>Election closed</th><td>${official ? U.fmtDateTime(election.closed_at) : 'Still open'}</td></tr>
        </table>
        ${positions.map((p) => html`
          <section class="pr-pos">
            <h2>${p.name} <small>${p.seats > 1 ? `${p.seats} seats` : '1 seat'} · ${U.plural(p.total_votes, 'valid vote')}</small></h2>
            <table class="pr-table">
              <thead><tr><th>Rank</th><th>Candidate</th><th>Class</th><th class="num">Votes</th><th class="num">%</th><th>Result</th></tr></thead>
              <tbody>
                ${p.candidates.map((c) => html`<tr class="${c.winner ? 'is-winner' : ''}">
                  <td>${c.rank}</td><td>${c.name}</td><td>${c.class_name || ''}</td>
                  <td class="num">${U.fmtInt(c.votes)}</td><td class="num">${U.fmtPct(c.pct)}</td>
                  <td>${c.winner ? 'WINNER' : c.tie ? 'TIE' : ''}</td></tr>`)}
              </tbody>
            </table>
            ${official && p.outcome === 'tie' ? html`<p class="pr-tie">Tie for the final seat — no winner declared automatically. Resolve according to the school's election rules.</p>` : ''}
          </section>`)}
        <footer class="pr-foot">
          <div class="pr-sign"><span></span>Returning Officer</div>
          <div class="pr-sign"><span></span>Head Teacher / Principal</div>
          <div class="pr-meta">Generated ${U.fmtDateTime(new Date())} · Percentages are of valid votes for each position · Ballots are secret: no voter can be linked to a ballot.</div>
        </footer>
      </div>`, 'print-report-root');
  };
})(window.SGE);
