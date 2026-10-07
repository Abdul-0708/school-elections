import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/* Database test suite: runs supabase/schema.sql in PGlite (real Postgres compiled to WASM)
   with small stand-ins for Supabase's auth schema and roles.   cd tests && npm install && npm test */
const schemaPath = process.argv[2] || fileURLToPath(new URL('../supabase/schema.sql', import.meta.url));
const db = new PGlite({ extensions: { pgcrypto } });
let pass = 0, fail = 0;
process.on('unhandledRejection', (e) => { console.log('FATAL:', e.message, e.detail || '', e.query || ''); process.exit(2); });
const ok = (cond, label, extra) => { if (cond) { pass++; console.log('  ✓', label); } else { fail++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : ''); } };
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
async function expectErr(sql, params, msg, label) {
  try { await db.query(sql, params); ok(false, label, 'no error'); }
  catch (e) { ok(String(e.message).includes(msg), label, e.message + ' | ' + (e.detail || '')); }
}
const asRole = async (role, uid) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false);`);
  if (role) await db.exec(`set role ${role};`);
};

// ---- Supabase stand-ins
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
`);
const schema = fs.readFileSync(schemaPath, 'utf8');
await db.exec(schema);
console.log('schema applied');
await db.exec(schema);
console.log('schema re-applied (idempotent)');

const SUPER = (await one(`insert into auth.users(email) values ('head@school.org') returning id`)).id;
const EADMIN = (await one(`insert into auth.users(email) values ('teacher@school.org') returning id`)).id;
const VIEWER = (await one(`insert into auth.users(email) values ('viewer@school.org') returning id`)).id;
await db.exec(`insert into public.admin_users(user_id, email, role) values ('${SUPER}', 'head@school.org', 'super_admin')`);

console.log('\n# Admin setup');
await asRole('authenticated', SUPER);
ok((await one(`select public.my_admin() as m`)).m.role === 'super_admin', 'my_admin returns role');
await q(`select public.grant_admin('teacher@school.org', 'election_admin')`);
await q(`select public.grant_admin('viewer@school.org', 'results_viewer')`);
await expectErr(`select public.grant_admin('nobody@school.org', 'results_viewer')`, [], 'NOT_FOUND', 'grant to unknown email fails');
const school = await one(`insert into public.schools(name, academic_year) values ('Imani Academy', '2026') returning *`);
ok(!!school.id, 'school created by super admin');
await expectErr(`insert into public.schools(name) values ('Second')`, [], 'duplicate', 'only one school row');
const E = (await one(`insert into public.elections(school_id, name, academic_year) values ($1, 'Student Government Elections', '2026') returning *`, [school.id]));
ok(E.status === 'draft', 'election starts as draft');
const pulse0 = await one(`select * from public.election_pulse where election_id = $1`, [E.id]);
ok(pulse0 && pulse0.status === 'draft', 'pulse row created');
try { await db.query(`update public.elections set status = 'open' where id = $1`, [E.id]); ok(false, 'status cannot be set directly'); } catch (e) { ok(/permission denied|VALIDATION/.test(e.message), 'status cannot be set directly (' + e.message + ')'); }
await expectErr(`select public.set_election_status($1, 'open')`, [E.id], 'NOT_READY', 'cannot open an empty election');

const P1 = await one(`insert into public.positions(election_id, name, min_selections, max_selections) values ($1, 'President', 1, 1) returning *`, [E.id]);
const P2 = await one(`insert into public.positions(election_id, name, min_selections, max_selections) values ($1, 'Class Reps', 1, 2) returning *`, [E.id]);
const P3 = await one(`insert into public.positions(election_id, name, min_selections, max_selections) values ($1, 'Optional Role', 0, 1) returning *`, [E.id]);
ok(P1.display_order === 1 && P2.display_order === 2, 'display_order auto-assigned');
await expectErr(`insert into public.positions(election_id, name, min_selections, max_selections) values ($1, 'Bad', 3, 1)`, [E.id], 'positions_min_le_max', 'min > max rejected');
const cand = async (p, name, code) => (await one(`insert into public.candidates(election_id, position_id, name, candidate_code) values ($1, $2, $3, $4) returning *`, [E.id, p.id, name, code])).id;
const A = await cand(P1, 'Alpha', 'C1'), B = await cand(P1, 'Beta', 'C2'), C = await cand(P1, 'Gamma', 'C3');
const R1 = await cand(P2, 'Mu', 'R1'), R2 = await cand(P2, 'Nu', 'R2'), R3 = await cand(P2, 'Xi', 'R3');
const O1 = await cand(P3, 'Omega', 'O1');
await expectErr(`insert into public.candidates(election_id, position_id, name, candidate_code) values ($1, $2, 'Dup', 'c1')`, [E.id, P1.id], 'duplicate', 'duplicate candidate code rejected (case-insensitive)');

// election admin can add candidates but not positions or open
await asRole('authenticated', EADMIN);
const D = (await one(`insert into public.candidates(election_id, position_id, name) values ($1, $2, 'Delta') returning id`, [E.id, P1.id])).id;
ok(!!D, 'election admin can add a candidate');
await expectErr(`insert into public.positions(election_id, name) values ($1, 'Nope')`, [E.id], 'row-level security', 'election admin cannot add positions');
await expectErr(`select public.set_election_status($1, 'open')`, [E.id], 'FORBIDDEN', 'election admin cannot open election');
await asRole('authenticated', VIEWER);
await expectErr(`insert into public.candidates(election_id, position_id, name) values ($1, $2, 'Nope')`, [E.id, P1.id], 'row-level security', 'results viewer cannot add candidates');
await expectErr(`select public.import_voters($1, '[]')`, [E.id], 'FORBIDDEN', 'results viewer cannot import voters');

await asRole('authenticated', SUPER);
await q(`delete from public.candidates where id = $1`, [D]);
const imp = (await one(`select public.import_voters($1, $2::jsonb) as r`, [E.id, JSON.stringify([
  { student_reference: 'S001', class_name: '10A' }, { student_reference: 'S002', class_name: '10A' }, { student_reference: 'S003', class_name: '10B' },
  { student_reference: 'S004', class_name: '10B' }, { student_reference: 'S005', class_name: '10B' }, { student_reference: 's001', class_name: '10A' },
  { student_reference: '', class_name: '10A' }, { student_reference: 'S006', class_name: '11C' }, { student_reference: 'S007', class_name: '11C' }])])).r;
ok(imp.created.length === 7 && imp.skipped.length === 2, 'import creates 7 voters, skips duplicate + blank', imp.skipped);
const codes = Object.fromEntries(imp.created.map((c) => [c.student_reference, c.code]));
ok(imp.created.every((c) => /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/.test(c.code)), 'codes use the safe alphabet XXXX-XXXX');
await asRole(null);
const raw = await q(`select voting_code_hash from public.voters where election_id = $1`, [E.id]);
await asRole('authenticated', SUPER);
ok(raw.every((r) => r.voting_code_hash.length === 64 && !Object.values(codes).includes(r.voting_code_hash)), 'only hashes are stored');
const opened = (await one(`select public.set_election_status($1, 'open') as e`, [E.id])).e;
ok(opened.status === 'open' && opened.opened_at, 'super admin opens election');

console.log('\n# Direct table access from browsers');
await asRole('anon');
await expectErr(`select * from public.ballots`, [], 'permission denied', 'anon cannot read ballots');
await expectErr(`select * from public.voters`, [], 'permission denied', 'anon cannot read voters');
await expectErr(`select * from public.candidates`, [], 'permission denied', 'anon cannot read candidate table directly');
await expectErr(`insert into public.ballots(election_id) values ($1)`, [E.id], 'permission denied', 'anon cannot insert ballots');
await expectErr(`select * from private.voting_sessions`, [], 'permission denied', 'anon cannot see private schema');
await expectErr(`select public.import_voters($1, '[]')`, [E.id], 'permission denied', 'anon cannot call admin functions');
ok((await q(`select * from public.election_pulse`)).length === 1, 'anon can read the pulse');
await asRole('authenticated', SUPER);
await expectErr(`select voting_code_hash from public.voters`, [], 'permission denied', 'even admins cannot read code hashes');
await expectErr(`select * from public.ballot_selections`, [], 'permission denied', 'even admins cannot read raw ballots');

console.log('\n# Voting');
await asRole('anon');
const pub = (await one(`select public.get_public_state() as s`)).s;
ok(pub.live && pub.live.id === E.id && pub.school.name === 'Imani Academy' && pub.school.singleton === undefined, 'public state has school + live election');
ok((await one(`select public.begin_voting($1, 'ZZZZ-ZZZZ') as r`, [E.id])).r.error === 'INVALID_CODE', 'unknown code rejected');
ok((await one(`select public.begin_voting($1, 'abc') as r`, [E.id])).r.error === 'INVALID_CODE', 'malformed code rejected');
const begin = async (ref) => (await one(`select public.begin_voting($1, $2) as r`, [E.id, ref])).r;
const s1 = await begin(codes.S001.toLowerCase().replace('-', ' '));
ok(s1.token && s1.positions.length === 3, 'valid code (lower-case, space) opens a session with 3 positions', s1.error);
ok(s1.positions[0].candidates.length === 3 && s1.positions[0].candidates[0].votes === undefined, 'ballot has candidates and no vote counts');
const submit = async (tok, sel) => (await one(`select public.submit_ballot($1, $2::jsonb) as r`, [tok, JSON.stringify(sel)])).r;
await expectErr(`select public.submit_ballot($1, $2::jsonb)`, [s1.token, JSON.stringify({ [P1.id]: [A] })], 'BALLOT_INVALID', 'incomplete ballot rejected');
await expectErr(`select public.submit_ballot($1, $2::jsonb)`, [s1.token, JSON.stringify({ [P1.id]: [A, B], [P2.id]: [R1] })], 'BALLOT_INVALID', 'too many for single-choice rejected');
await expectErr(`select public.submit_ballot($1, $2::jsonb)`, [s1.token, JSON.stringify({ [P1.id]: [R1], [P2.id]: [R1] })], 'BALLOT_INVALID', 'candidate from another position rejected');
await expectErr(`select public.submit_ballot($1, $2::jsonb)`, [s1.token, JSON.stringify({ [P1.id]: [A], [P2.id]: [R1, R1] })], 'BALLOT_INVALID', 'duplicate selection rejected');
await expectErr(`select public.submit_ballot($1, $2::jsonb)`, [s1.token, JSON.stringify({ [P1.id]: [A], [P2.id]: [R1], 'junk': [] })], 'BALLOT_INVALID', 'unknown position key rejected');
await expectErr(`select public.submit_ballot($1, $2::jsonb)`, [s1.token, JSON.stringify({ [P1.id]: ['not-a-uuid'], [P2.id]: [R1] })], 'BALLOT_INVALID', 'garbage candidate id rejected');
await expectErr(`select public.submit_ballot($1, $2::jsonb)`, ['forged-token', JSON.stringify({ [P1.id]: [A], [P2.id]: [R1] })], 'SESSION_EXPIRED', 'forged token rejected');
await asRole(null);
ok((await one(`select count(*)::int n from public.ballots`)).n === 0 && (await one(`select count(*)::int n from public.voters where used_at is not null`)).n === 0, 'failed submissions wrote nothing and left code unused');
await asRole('anon');
ok((await submit(s1.token, { [P1.id]: [A], [P2.id]: [R1, R2] })).ok, 'valid ballot accepted (optional position skipped)');
await expectErr(`select public.submit_ballot($1, $2::jsonb)`, [s1.token, JSON.stringify({ [P1.id]: [A], [P2.id]: [R1] })], 'SESSION_EXPIRED', 'same session cannot submit twice');
ok((await begin(codes.S001)).error === 'CODE_USED', 'used code is blocked');
// two sessions for the same code: the second session replaces the first
const s2a = await begin(codes.S002), s2b = await begin(codes.S002);
await expectErr(`select public.submit_ballot($1, $2::jsonb)`, [s2a.token, JSON.stringify({ [P1.id]: [B], [P2.id]: [R1] })], 'SESSION_EXPIRED', 'older session invalidated by a newer one');
ok((await submit(s2b.token, { [P1.id]: [B], [P2.id]: [R1], [P3.id]: [O1] })).ok, 'newer session votes');
ok((await submit((await begin(codes.S003)).token, { [P1.id]: [A], [P2.id]: [R2] })).ok, 'S003 votes A');
ok((await submit((await begin(codes.S004)).token, { [P1.id]: [B], [P2.id]: [R3] })).ok, 'S004 votes B');

console.log('\n# Privacy');
await asRole(null);
const cols = (await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'ballots'`)).map((r) => r.column_name);
ok(!cols.some((c) => c.includes('voter')), 'ballots table has no voter column', cols);
const times = await q(`select submitted_at from public.ballots`);
ok(times.every((t) => new Date(t.submitted_at).getMinutes() === 0 && new Date(t.submitted_at).getSeconds() === 0), 'ballot times truncated to the hour');

console.log('\n# Live results');
await asRole('anon');
let res = (await one(`select public.get_results($1) as r`, [E.id])).r;
const pres = res.positions.find((p) => p.name === 'President');
ok(res.stats.cast === 4 && res.stats.eligible === 7, 'stats: 4 cast of 7 eligible', res.stats);
ok(pres.total_votes === 4 && pres.top_tie === true && pres.candidates[0].pct === 50, 'President tied 2–2 at 50%', pres);
ok(pres.candidates.every((c) => !c.winner), 'no winner shown while open');
const reps = res.positions.find((p) => p.name === 'Class Reps');
ok(reps.candidates.find((c) => c.id === R1).votes === 2 && reps.total_votes === 5, 'multi-select counts each selection', reps);
const pl = await one(`select votes_cast from public.election_pulse where election_id = $1`, [E.id]);
ok(pl.votes_cast === 4, 'pulse counts votes for realtime');

console.log('\n# Structure freeze after voting starts');
await asRole('authenticated', SUPER);
await expectErr(`insert into public.candidates(election_id, position_id, name) values ($1, $2, 'Late')`, [E.id, P1.id], 'FROZEN', 'cannot add a candidate after votes');
await expectErr(`delete from public.candidates where id = $1`, [C], 'FROZEN', 'cannot delete a candidate after votes');
await expectErr(`update public.positions set max_selections = 2 where id = $1`, [P1.id], 'FROZEN', 'cannot change selection rules after votes');
await q(`update public.candidates set name = 'Gamma G.' where id = $1`, [C]);
ok((await one(`select name from public.candidates where id = $1`, [C])).name === 'Gamma G.', 'can still correct a name');
await expectErr(`select public.reorder_positions($1, $2::uuid[])`, [E.id, `{${P2.id},${P1.id},${P3.id}}`], 'FROZEN', 'cannot reorder after votes');

console.log('\n# Append-only');
await asRole(null);
await expectErr(`delete from public.ballots`, [], 'LOCKED', 'even the database owner cannot delete live ballots via SQL');
await expectErr(`update public.voters set used_at = null where used_at is not null`, [], 'LOCKED', 'a recorded vote cannot be undone');
await expectErr(`delete from public.audit_logs`, [], 'LOCKED', 'audit log is immutable');

console.log('\n# Monitor + voters');
await asRole('authenticated', EADMIN);
const mon = (await one(`select public.get_monitor($1) as m`, [E.id])).m;
ok(mon.cast === 4 && mon.by_class.length === 3 && mon.by_hour.length === 1, 'monitor aggregates', mon.by_class);
const vlist = await q(`select id, student_reference, has_voted from public.voters where election_id = $1 order by student_reference`, [E.id]);
ok(vlist.length === 7 && vlist[0].has_voted === true && vlist[6].has_voted === false, 'admin sees voted yes/no only');
await expectErr(`select public.remove_voter($1)`, [vlist[0].id], 'VALIDATION', 'cannot remove a voter who voted');
const regen = (await one(`select public.regenerate_codes($1, $2::uuid[]) as r`, [E.id, `{${vlist[4].id}}`])).r;
ok(regen.length === 1 && regen[0].code !== codes.S005, 'regenerate code for one voter');
await asRole('anon');
ok((await begin(codes.S005)).error === 'INVALID_CODE', 'old code stops working after regeneration');
const s5 = await begin(regen[0].code);
ok(!!s5.token, 'new code works');
await asRole('authenticated', EADMIN);
await q(`select public.set_voter_active($1, false)`, [vlist[5].id]);
await asRole('anon');
ok((await begin(codes.S006)).error === 'INVALID_CODE', 'inactive voter code rejected');
await asRole('authenticated', VIEWER);
ok((await q(`select id from public.voters`)).length === 0, 'results viewer sees no voter rows (RLS)');

console.log('\n# Pause + close');
await asRole('authenticated', SUPER);
await q(`select public.set_election_status($1, 'paused')`, [E.id]);
await asRole('anon');
ok((await begin(codes.S007)).error === 'PAUSED', 'paused election blocks new sessions');
await expectErr(`select public.submit_ballot($1, $2::jsonb)`, [s5.token, JSON.stringify({ [P1.id]: [A], [P2.id]: [R1] })], 'PAUSED', 'paused election blocks submission');
await asRole('authenticated', SUPER);
await q(`select public.set_election_status($1, 'open')`, [E.id]);
await asRole('anon');
ok((await submit(s5.token, { [P1.id]: [A], [P2.id]: [R1] })).ok, 'session survives a pause and submits after reopening');
await asRole('authenticated', SUPER);
await expectErr(`select public.set_election_status($1, 'closed')`, [E.id], 'VALIDATION', 'close requires typed phrase');
await expectErr(`select public.set_election_status($1, 'closed', 'close')`, [E.id], 'VALIDATION', 'wrong phrase rejected');
// wait: 'close' upper → 'CLOSE' ≠ 'CLOSE ELECTION'
const closed = (await one(`select public.set_election_status($1, 'closed', 'close election') as e`, [E.id])).e;
ok(closed.status === 'closed' && closed.closed_at, 'closed with phrase');
await asRole('anon');
ok((await begin(codes.S007)).error === 'CLOSED', 'closed election blocks voting');
res = (await one(`select public.get_results($1) as r`, [E.id])).r;
const fp = res.positions.find((p) => p.name === 'President');
ok(res.final === true && fp.candidates[0].winner === true && fp.candidates[0].name === 'Alpha' && fp.outcome === 'decided', 'final: Alpha wins 3–2', fp.candidates.map((c) => [c.name, c.votes, c.winner, c.tie]));
const fr = res.positions.find((p) => p.name === 'Class Reps');
ok(fr.outcome === 'decided' && fr.candidates.filter((c) => c.winner).length === 2, 'two seats filled for Class Reps', fr.candidates.map((c) => [c.name, c.votes, c.winner, c.tie]));
const fo = res.positions.find((p) => p.name === 'Optional Role');
ok(fo && fo.candidates[0].winner === true, 'uncontested optional role winner', fo);
await asRole('authenticated', SUPER);
await expectErr(`update public.elections set name = 'Changed' where id = $1`, [E.id], 'LOCKED', 'closed election config locked');
await q(`update public.elections set results_visibility = 'after_close' where id = $1`, [E.id]);
ok(true, 'results visibility can still change after close');
await expectErr(`update public.candidates set name = 'X' where id = $1`, [A], 'LOCKED', 'candidates locked after close');
await expectErr(`select public.import_voters($1, '[{"student_reference":"Z"}]')`, [E.id], 'LOCKED', 'voter register locked after close');
await expectErr(`select public.set_election_status($1, 'open')`, [E.id], 'VALIDATION', 'closed election cannot reopen');
await asRole(null);
await expectErr(`update public.final_results set stats = '{}'`, [], 'LOCKED', 'final results immutable');

console.log('\n# Tie handling');
await asRole('authenticated', SUPER);
await q(`select public.archive_election($1, 'ARCHIVE ELECTION')`, [E.id]);
const T = await one(`insert into public.elections(school_id, name) values ($1, 'Tie Test') returning *`, [school.id]);
const TP = await one(`insert into public.positions(election_id, name, min_selections, max_selections) values ($1, 'Captain', 1, 1) returning *`, [T.id]);
const TA = (await one(`insert into public.candidates(election_id, position_id, name) values ($1, $2, 'Ann') returning id`, [T.id, TP.id])).id;
const TB = (await one(`insert into public.candidates(election_id, position_id, name) values ($1, $2, 'Ben') returning id`, [T.id, TP.id])).id;
const timp = (await one(`select public.import_voters($1, '[{"student_reference":"T1"},{"student_reference":"T2"}]') as r`, [T.id])).r;
await q(`select public.set_election_status($1, 'open')`, [T.id]);
await asRole('anon');
for (const [i, c] of [[0, TA], [1, TB]]) {
  const s = (await one(`select public.begin_voting($1, $2) as r`, [T.id, timp.created[i].code])).r;
  await submit(s.token, { [TP.id]: [c] });
}
await asRole('authenticated', SUPER);
await q(`select public.set_election_status($1, 'closed', 'CLOSE ELECTION')`, [T.id]);
const tr = (await one(`select public.get_results($1) as r`, [T.id])).r.positions[0];
ok(tr.outcome === 'tie' && tr.candidates.every((c) => c.tie && !c.winner), 'tie declared, no winner', tr.candidates);

console.log('\n# Demo election');
const DE = await one(`insert into public.elections(school_id, name, is_demo) values ($1, 'Demo', true) returning *`, [school.id]);
const DP = await one(`insert into public.positions(election_id, name) values ($1, 'President') returning *`, [DE.id]);
const DC = (await one(`insert into public.candidates(election_id, position_id, name) values ($1, $2, 'Demo A') returning id`, [DE.id, DP.id])).id;
const dimp = (await one(`select public.import_voters($1, '[{"student_reference":"D1"}]') as r`, [DE.id])).r;
await q(`select public.set_election_status($1, 'open')`, [DE.id]);
await asRole('anon');
await submit((await one(`select public.begin_voting($1, $2) as r`, [DE.id, dimp.created[0].code])).r.token, { [DP.id]: [DC] });
ok((await one(`select public.begin_voting($1, $2) as r`, [T.id, dimp.created[0].code])).r.error, 'demo code does not work in another election');
await asRole('authenticated', SUPER);
await expectErr(`select public.reset_demo($1, 'RESET DEMO')`, [T.id], 'FORBIDDEN', 'real election cannot be reset');
await q(`select public.set_election_status($1, 'closed', 'CLOSE ELECTION')`, [DE.id]);
const reset = (await one(`select public.reset_demo($1, 'RESET DEMO') as e`, [DE.id])).e;
ok(reset.status === 'open', 'demo reset reopens demo');
await asRole('anon');
const dr = (await one(`select public.get_results($1) as r`, [DE.id])).r;
ok(dr.stats.cast === 0 && (await one(`select public.begin_voting($1, $2) as r`, [DE.id, dimp.created[0].code])).r.token, 'demo ballots cleared, code reusable');
await asRole(null);
ok((await one(`select count(*)::int n from public.ballots where election_id = $1`, [E.id])).n === 5, 'real election ballots untouched by demo reset');

console.log('\n# Hidden results');
await asRole('authenticated', SUPER);
await q(`update public.elections set results_visibility = 'hidden' where id = $1`, [DE.id]);
await asRole('anon');
const hid = (await one(`select public.get_results($1) as r`, [DE.id])).r;
ok(hid.sealed === true && hid.positions.length === 0, 'hidden results sealed for the public');
await asRole('authenticated', VIEWER);
const vis = (await one(`select public.get_results($1) as r`, [DE.id])).r;
ok(vis.sealed === false && vis.positions.length === 1, 'results viewer can see hidden results');

console.log('\n# Rate limiting');
await asRole('anon');
for (let i = 0; i < 150; i++) await one(`select public.begin_voting($1, 'BAD') as r`, [DE.id]);
ok((await one(`select public.begin_voting($1, $2) as r`, [DE.id, dimp.created[0].code])).r.error === 'RATE_LIMITED', 'guessing is throttled');

console.log('\n# Audit');
await asRole('authenticated', SUPER);
const acts = (await q(`select action from public.audit_logs`)).map((r) => r.action);
['election.created', 'election.opened', 'election.paused', 'election.closed', 'candidate.added', 'candidate.edited', 'voters.imported', 'codes.regenerated', 'demo.reset', 'admin.role_granted'].forEach((a) => ok(acts.includes(a), `audit has ${a}`));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
