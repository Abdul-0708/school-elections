/* Election rules shared by every screen and by the local demo engine.
   The Supabase database enforces the same rules server-side (supabase/schema.sql);
   anything here is for display and early feedback, never the security layer. */
(function (S) {
  'use strict';
  const U = S.util;
  const R = (S.rules = {});

  R.PHRASES = {
    close: 'CLOSE ELECTION',
    archive: 'ARCHIVE ELECTION',
    resetDemo: 'RESET DEMO',
    newCodes: 'NEW CODES',
    erase: 'ERASE ALL DATA',
  };

  R.STATUS = {
    draft: { label: 'Draft', tone: 'muted' },
    scheduled: { label: 'Scheduled', tone: 'info' },
    open: { label: 'Open', tone: 'ok' },
    paused: { label: 'Paused', tone: 'warn' },
    closed: { label: 'Closed', tone: 'danger' },
  };

  // Which status changes an administrator may make (the database enforces the same table).
  R.TRANSITIONS = {
    draft: ['scheduled', 'open'],
    scheduled: ['draft', 'open', 'paused', 'closed'],
    open: ['paused', 'closed'],
    paused: ['open', 'closed'],
    closed: [],
  };

  /* What a voter at a station would experience right now.
     state: open | not_open | paused | closed | ended | none */
  R.votingState = (e, now = Date.now()) => {
    if (!e) return { state: 'none', label: 'Not set up', tone: 'muted', canVote: false };
    const starts = e.starts_at ? Date.parse(e.starts_at) : null;
    const ends = e.ends_at ? Date.parse(e.ends_at) : null;
    if (e.status === 'closed') return { state: 'closed', label: 'Election closed', tone: 'danger', canVote: false };
    if (e.status === 'paused') return { state: 'paused', label: 'Voting paused', tone: 'warn', canVote: false };
    if (ends && now >= ends && (e.status === 'open' || e.status === 'scheduled')) {
      return { state: 'ended', label: 'Voting time ended', tone: 'danger', canVote: false };
    }
    if (e.status === 'open') return { state: 'open', label: 'Election open', tone: 'ok', canVote: true };
    if (e.status === 'scheduled' && starts && now >= starts) return { state: 'open', label: 'Election open', tone: 'ok', canVote: true };
    if (e.status === 'scheduled') return { state: 'not_open', label: 'Election not yet open', tone: 'warn', canVote: false };
    return { state: 'not_open', label: 'Election not yet open', tone: 'warn', canVote: false };
  };

  /* Structure (positions, candidates, selection rules) is frozen once the first ballot is cast. */
  R.structureLocked = (e, ballotsCast) => !!e && (e.status === 'closed' || ballotsCast > 0);

  /* --------------------------------------------------------- Roles */
  R.ROLES = {
    super_admin: { label: 'Super Admin', rank: 3 },
    election_admin: { label: 'Election Admin', rank: 2 },
    results_viewer: { label: 'Results Viewer', rank: 1 },
  };
  const CAN = {
    'school.edit': ['super_admin'],
    'election.edit': ['super_admin'],
    'election.status': ['super_admin'],
    'positions.edit': ['super_admin'],
    'candidates.edit': ['super_admin', 'election_admin'],
    'voters.manage': ['super_admin', 'election_admin'],
    'monitor.view': ['super_admin', 'election_admin', 'results_viewer'],
    'results.view': ['super_admin', 'election_admin', 'results_viewer'],
    'results.settings': ['super_admin'],
    'reports.export': ['super_admin'],
    'audit.view': ['super_admin', 'election_admin'],
    'admins.manage': ['super_admin'],
    'demo.manage': ['super_admin'],
  };
  R.can = (role, cap) => !!(role && CAN[cap] && CAN[cap].includes(role));

  /* --------------------------------------------------------- Validation */
  R.validateElection = (e) => {
    const errs = {};
    if (!String(e.name || '').trim()) errs.name = 'Give the election a name.';
    if (String(e.name || '').length > 120) errs.name = 'Keep the name under 120 characters.';
    if (e.starts_at && e.ends_at && Date.parse(e.ends_at) <= Date.parse(e.starts_at)) errs.ends_at = 'The end must be after the start.';
    const rs = Number(e.rotation_seconds);
    if (e.rotation_seconds != null && (!Number.isFinite(rs) || rs < 5 || rs > 300)) errs.rotation_seconds = 'Use between 5 and 300 seconds.';
    return errs;
  };

  R.validatePosition = (p, activeCandidateCount) => {
    const errs = {};
    const min = Number(p.min_selections), max = Number(p.max_selections);
    if (!String(p.name || '').trim()) errs.name = 'Enter the position name.';
    if (!Number.isInteger(max) || max < 1 || max > 20) errs.max_selections = 'Maximum must be a whole number from 1 to 20.';
    if (!Number.isInteger(min) || min < 0) errs.min_selections = 'Minimum must be 0 or more.';
    else if (min > max) errs.min_selections = 'Minimum selections cannot be greater than maximum.';
    if (activeCandidateCount != null && p.active && min > activeCandidateCount && !errs.min_selections) {
      errs.min_selections = `Only ${activeCandidateCount} active candidate(s) — a voter could not reach the minimum.`;
    }
    return errs;
  };

  R.validateCandidate = (c, others, positions) => {
    const errs = {};
    if (!String(c.name || '').trim()) errs.name = "Enter the candidate's name.";
    const pos = positions.find((p) => p.id === c.position_id);
    if (!pos) errs.position_id = 'Choose a position.';
    else if (!pos.active && c.active) errs.position_id = 'That position is inactive. Activate it first or choose another.';
    const code = String(c.candidate_code || '').trim().toUpperCase();
    if (code && others.some((o) => o.id !== c.id && String(o.candidate_code || '').trim().toUpperCase() === code)) {
      errs.candidate_code = 'Another candidate already uses this candidate ID.';
    }
    return errs;
  };

  /* Ballot validation — returns the list of positions the voter still has to fix. */
  R.validateBallot = (positions, selections) => {
    const problems = [];
    positions.forEach((p) => {
      const n = (selections[p.id] || []).length;
      if (n < p.min_selections) problems.push({ position: p, kind: 'min', text: p.name });
      else if (n > p.max_selections) problems.push({ position: p, kind: 'max', text: `${p.name} (too many selected)` });
    });
    return problems;
  };

  /* Readiness checks before an election may open. */
  R.readiness = ({ school, election, positions, candidates, eligible }) => {
    const activePositions = positions.filter((p) => p.active);
    const checks = [];
    checks.push({ ok: !!(school && school.name) || !!(election && election.is_demo), label: 'School details', detail: school && school.name ? school.name : 'Add the school name in Settings → Branding.' });
    checks.push({ ok: !!(election && election.name), label: 'Election details', detail: election ? election.name : 'Create the election.' });
    checks.push({ ok: activePositions.length > 0, label: 'Positions', detail: activePositions.length ? U.plural(activePositions.length, 'active position') : 'Add at least one position.' });
    const thin = activePositions.filter((p) => {
      const n = candidates.filter((c) => c.position_id === p.id && c.active).length;
      return n === 0 || n < p.min_selections;
    });
    checks.push({
      ok: activePositions.length > 0 && thin.length === 0,
      label: 'Candidates',
      detail: thin.length ? `Needs candidates: ${thin.map((p) => p.name).join(', ')}` : U.plural(candidates.filter((c) => c.active).length, 'active candidate'),
    });
    checks.push({ ok: eligible > 0, label: 'Eligible voters', detail: eligible > 0 ? U.plural(eligible, 'voter') + ' with codes' : 'Import voters and generate codes.' });
    const dates = !election || !election.starts_at || !election.ends_at || Date.parse(election.ends_at) > Date.parse(election.starts_at);
    const notPast = !election || !election.ends_at || Date.parse(election.ends_at) > Date.now();
    checks.push({ ok: dates && notPast, label: 'Voting window', detail: !dates ? 'End time is before start time.' : !notPast ? 'The end time has already passed.' : (election && election.ends_at ? `Ends ${U.fmtDateTime(election.ends_at)}` : 'No fixed end time — close it manually.') });
    return { ok: checks.every((c) => c.ok), checks };
  };

  /* --------------------------------------------------------- Results
     candidates: [{..., votes}] for one position. seats = max_selections.
     Standard competition ranking (1, 2, 2, 4).  A tie at the last winning seat is reported as TIE —
     the system never picks a winner between equal candidates. */
  R.standings = (position, candidates, final) => {
    const seats = Math.max(1, position.max_selections || 1);
    const list = candidates
      .map((c) => ({ ...c, votes: Number(c.votes) || 0 }))
      .sort((a, b) => b.votes - a.votes || (a.display_order || 0) - (b.display_order || 0) || String(a.name).localeCompare(b.name));
    const total = list.reduce((s, c) => s + c.votes, 0);
    const cutoff = list.length ? list[Math.min(seats, list.length) - 1].votes : 0;
    const countAtOrAbove = list.filter((c) => c.votes >= cutoff).length;
    list.forEach((c) => {
      c.rank = 1 + list.filter((o) => o.votes > c.votes).length;
      c.pct = total > 0 ? (c.votes / total) * 100 : 0;
      const contested = c.votes > 0 && c.votes === cutoff && countAtOrAbove > seats;
      c.tie = contested;
      c.winner = !!final && c.votes > 0 && (c.votes > cutoff || (c.votes === cutoff && countAtOrAbove <= seats));
      c.leading = !final && c.votes > 0 && c.rank <= seats;  // currently holding a winning seat
    });
    let outcome = 'none';
    if (total > 0) outcome = final ? (list.some((c) => c.tie) ? 'tie' : 'decided') : 'live';
    const topTie = total > 0 && list.filter((c) => c.rank === 1).length > 1;
    return { ...position, seats, total_votes: total, candidates: list, outcome, top_tie: topTie };
  };

  /* --------------------------------------------------------- Messages */
  R.MESSAGES = {
    NETWORK: { title: 'Connection problem', text: "We couldn't connect to the election server. Please try again." },
    INVALID_CODE: { title: 'Voting code not recognised', text: 'This voting code is invalid or unavailable. Check it carefully and try again.' },
    CODE_USED: { title: 'Code already used', text: 'This voting code has already been used.' },
    NOT_OPEN: { title: 'Voting has not opened yet', text: 'Please wait until the election administrator opens voting.' },
    PAUSED: { title: 'Voting is paused', text: 'Voting has been paused. Please wait for the election administrator.' },
    CLOSED: { title: 'Voting has now closed', text: 'Voting has now closed. Thank you.' },
    ENDED: { title: 'Voting has now closed', text: 'The voting period has ended.' },
    SESSION_EXPIRED: { title: 'Your session expired', text: 'For security your ballot timed out. Please enter your code again — it has not been used.' },
    SUBMIT_FAILED: { title: 'Your vote was NOT submitted', text: 'Please do not leave the station. Contact the election administrator.' },
    BALLOT_INVALID: { title: 'Ballot not accepted', text: 'Your ballot did not meet the voting rules. Please review your choices.' },
    RATE_LIMITED: { title: 'Too many incorrect codes', text: 'Too many incorrect codes were entered from this location. Please wait a few minutes and ask the election administrator for help.' },
    STORAGE_FULL: { title: 'Storage full', text: "This browser's storage is full. Use smaller photos, or connect Supabase for the real election." },
  };
  R.message = (err) => {
    const code = err && err.code;
    if (R.MESSAGES[code]) return R.MESSAGES[code];
    return { title: 'Something went wrong', text: (err && err.message) || 'Please try again.' };
  };
})(window.SGE);
