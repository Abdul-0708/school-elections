/* CONCURRENCY CHECK — run against your Supabase project's DEMO election before election day.

   Usage (Node 18+, no npm install needed):
     SUPABASE_URL=https://xxxx.supabase.co SUPABASE_PUBLISHABLE_KEY=... \
     ADMIN_EMAIL=you@school.org ADMIN_PASSWORD=... node tools/load-test.mjs 20

   What it does
     1. Signs in as a Super Admin and issues N fresh codes for unused DEMO voters.
     2. Opens N voting sessions, then submits all N ballots at the same instant — and submits
        every ballot TWICE simultaneously (a double-click / two-tab attack).
     3. Verifies exactly N ballots were accepted, every duplicate was rejected, and the vote
        counts match.  It only ever touches the demo election; reset it afterwards in
        Settings → Demo mode.  On Windows PowerShell set the variables with $env:NAME = "value". */
const N = Math.max(1, Math.min(200, Number(process.argv[2]) || 20));
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ADMIN_EMAIL and ADMIN_PASSWORD.');
  process.exit(2);
}
const base = SUPABASE_URL.replace(/\/$/, '');
const headers = (token) => ({ apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });

async function rpc(fn, args, token) {
  const r = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: headers(token), body: JSON.stringify(args || {}) });
  const body = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error((body && body.message) || r.statusText); e.code = body && body.message; throw e; }
  return body;
}

const login = await fetch(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers: headers(), body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }) });
const session = await login.json();
if (!login.ok) { console.error('Sign-in failed:', session.error_description || session.msg || login.statusText); process.exit(1); }
const token = session.access_token;

const state = await rpc('get_public_state');
const demo = state.demo;
if (!demo) { console.error('No demo election. Create it in the app: Settings → Demo mode.'); process.exit(1); }
if (!demo.is_demo) { console.error('Refusing to run: the target election is not a demo election.'); process.exit(1); }
const before = (await rpc('get_results', { p_election_id: demo.id }, token)).stats.cast;

const codes = await rpc('regenerate_codes', { p_election_id: demo.id, p_all_unused: true, p_limit: N }, token);
if (codes.length < N) console.warn(`Only ${codes.length} unused demo voters — reset the demo for a full run.`);
console.log(`Opening ${codes.length} sessions…`);
const sessions = await Promise.all(codes.map((c) => rpc('begin_voting', { p_election_id: demo.id, p_code: c.code })));
const ballots = sessions.map((s) => {
  if (s.error) throw new Error('begin_voting failed: ' + s.error);
  const sel = {};
  s.positions.forEach((p) => { sel[p.id] = p.candidates.slice(0, Math.max(1, p.min_selections)).map((c) => c.id); });
  return { token: s.token, sel };
});

console.log(`Submitting ${ballots.length} ballots ×2 simultaneously…`);
const t0 = Date.now();
const results = await Promise.allSettled(ballots.flatMap((b) => [rpc('submit_ballot', { p_token: b.token, p_selections: b.sel }), rpc('submit_ballot', { p_token: b.token, p_selections: b.sel })]));
const ms = Date.now() - t0;
const accepted = results.filter((r) => r.status === 'fulfilled' && r.value && r.value.ok).length;
const rejected = results.filter((r) => r.status === 'rejected');
const reasons = rejected.reduce((m, r) => { m[r.reason.code || r.reason.message] = (m[r.reason.code || r.reason.message] || 0) + 1; return m; }, {});
const after = (await rpc('get_results', { p_election_id: demo.id }, token)).stats.cast;

console.log(`\nAccepted: ${accepted}   Rejected duplicates: ${rejected.length} ${JSON.stringify(reasons)}   (${ms} ms)`);
console.log(`Votes cast before: ${before}, after: ${after}`);
const okRun = accepted === ballots.length && rejected.length === ballots.length && after - before === ballots.length;
console.log(okRun ? '\n✓ PASS — one vote per code under concurrent load.' : '\n✗ FAIL — investigate before election day.');
process.exit(okRun ? 0 : 1);
