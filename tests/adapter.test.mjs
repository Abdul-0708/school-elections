/* Runs js/backend/supabase.js against the real schema in PGlite through a tiny fake
   supabase-js client (PostgREST subset), to verify RPC names, parameter names and shapes. */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const APP = process.argv[2] || fileURLToPath(new URL('..', import.meta.url));
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;`);
await db.exec(fs.readFileSync(`${APP}/supabase/schema.sql`, 'utf8'));
const SUPER = (await db.query(`insert into auth.users(email) values ('head@school.test') returning id`)).rows[0].id;
await db.query(`insert into auth.users(email) values ('teacher@school.test')`);
await db.query(`insert into public.admin_users(user_id, email, role) values ($1, 'head@school.test', 'super_admin')`, [SUPER]);

let currentUid = null;
// Serialise all DB work (PGlite is single-connection; role switching must not interleave).
let chain = Promise.resolve();
const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
async function asCaller(fn) {
  return serial(async () => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${currentUid || ''}', false); set role ${currentUid ? 'authenticated' : 'anon'};`);
    try { return await fn(); } finally { await db.exec('reset role;'); }
  });
}
const pgErr = (e) => ({ message: e.message, code: e.code, details: e.detail || null });

function sqlValue(v, key) {
  if (v === null || v === undefined) return { sql: 'null' };
  if (Array.isArray(v) && (key === 'p_ids' || key === 'p_voter_ids')) return { sql: '::uuid[]', val: `{${v.join(',')}}` };
  if (typeof v === 'object') return { sql: '::jsonb', val: JSON.stringify(v) };
  return { sql: '', val: v };
}
async function rpc(fn, args = {}) {
  return asCaller(async () => {
    const params = [], parts = [];
    for (const [k, v] of Object.entries(args)) {
      const s = sqlValue(v, k);
      if (s.sql === 'null') { parts.push(`${k} => null`); continue; }
      params.push(s.val);
      parts.push(`${k} => $${params.length}${s.sql}`);
    }
    try {
      const r = await db.query(`select public.${fn}(${parts.join(', ')}) as r`, params);
      return { data: r.rows[0].r, error: null };
    } catch (e) { return { data: null, error: pgErr(e) }; }
  });
}

class Query {
  constructor(table) { Object.assign(this, { table, op: 'select', cols: '*', filters: [], params: [], orders: [], lim: null, rng: null, payload: null, retCols: null, mode: null, count: false }); }
  p(v) { this.params.push(v); return `$${this.params.length}`; }
  select(cols = '*', opts) { if (this.op === 'select') this.cols = cols; else this.retCols = cols || '*'; if (opts && opts.count) this.count = true; return this; }
  insert(row) { this.op = 'insert'; this.payload = row; return this; }
  update(row) { this.op = 'update'; this.payload = row; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.filters.push(`${c} = ${this.p(v)}`); return this; }
  or(expr) {
    const terms = expr.split(',').map((t) => {
      const [col, op, ...rest] = t.split('.');
      const val = rest.join('.');
      if (op === 'eq') return `${col} = ${this.p(val)}`;
      if (op === 'is' && val === 'null') return `${col} is null`;
      if (op === 'ilike') return `${col} ilike ${this.p(val)}`;
      throw new Error('unsupported or: ' + t);
    });
    this.filters.push(`(${terms.join(' or ')})`);
    return this;
  }
  order(c, o = {}) { this.orders.push(`${c} ${o.ascending === false ? 'desc' : 'asc'}`); return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  single() { this.mode = 'single'; return this; }
  then(res, rej) { return this.exec().then(res, rej); }
  async exec() {
    return asCaller(async () => {
      const where = this.filters.length ? ' where ' + this.filters.join(' and ') : '';
      let sql;
      if (this.op === 'select') {
        sql = `select ${this.cols} from public.${this.table}${where}`
          + (this.orders.length ? ' order by ' + this.orders.join(', ') : '')
          + (this.rng ? ` limit ${this.rng[1] - this.rng[0] + 1} offset ${this.rng[0]}` : this.lim ? ` limit ${this.lim}` : '');
      } else if (this.op === 'insert') {
        const keys = Object.keys(this.payload);
        sql = `insert into public.${this.table} (${keys.join(',')}) values (${keys.map((k) => this.p(this.payload[k])).join(',')})`;
      } else if (this.op === 'update') {
        const sets = Object.entries(this.payload).map(([k, v]) => `${k} = ${this.p(v)}`).join(', ');
        sql = `update public.${this.table} set ${sets}${where}`;
      } else sql = `delete from public.${this.table}${where}`;
      if (this.op !== 'select' && this.retCols) sql += ` returning ${this.retCols}`;
      try {
        const r = await db.query(sql, this.params);
        let data = this.op === 'select' || this.retCols ? r.rows : null;
        let count = null;
        if (this.count) count = Number((await db.query(`select count(*) n from public.${this.table}${where}`, this.params)).rows[0].n);
        if (this.mode === 'single') { if (data.length !== 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } }; data = data[0]; }
        if (this.mode === 'maybe') data = data[0] || null;
        return { data, error: null, count };
      } catch (e) { return { data: null, error: pgErr(e) }; }
    });
  }
}

const fakeClient = {
  rpc,
  from: (t) => new Query(t),
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel() {},
  storage: { from: () => ({ upload: async () => ({ data: {}, error: null }), getPublicUrl: (p) => ({ data: { publicUrl: 'https://cdn.test/' + p } }) }) },
  auth: {
    async getSession() { return { data: { session: currentUid ? { user: { id: currentUid, email: 'x' } } : null } }; },
    async signInWithPassword({ email }) {
      const r = await db.query(`select id from auth.users where email = $1`, [email]);
      if (!r.rows.length) return { error: { message: 'Invalid login credentials' } };
      currentUid = r.rows[0].id; return { data: {}, error: null };
    },
    async signOut() { currentUid = null; return { error: null }; },
  },
};

// Load the browser scripts into a sandbox.
const sandbox = { window: {}, crypto: globalThis.crypto, TextEncoder, setTimeout, clearTimeout, setInterval, clearInterval, console, atob, btoa, Blob, URL, Date, Math, JSON, Promise };
sandbox.window = sandbox; sandbox.window.supabase = { createClient: () => fakeClient };
sandbox.window.sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
vm.createContext(sandbox);
for (const f of ['js/core/util.js', 'js/core/rules.js', 'js/core/demo.js', 'js/backend/supabase.js']) vm.runInContext(fs.readFileSync(`${APP}/${f}`, 'utf8'), sandbox, { filename: f });
const S = sandbox.SGE;
const api = S.createSupabaseBackend({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'k' });

let pass = 0, fail = 0;
const ok = (c, label, extra) => { if (c) { pass++; console.log('  ✓', label); } else { fail++; console.log('  ✗', label, extra === undefined ? '' : JSON.stringify(extra)); } };
const expectCode = async (p, code, label) => { try { await p; ok(false, label, 'no error'); } catch (e) { ok(e.code === code, label, e.code + ' ' + e.message); } };

console.log('# auth');
ok((await api.auth.current()) === null, 'no session initially');
await expectCode(api.auth.signIn('nobody@school.test', 'x'), 'AUTH', 'unknown user rejected');
await expectCode(api.auth.signIn('teacher@school.test', 'x'), 'FORBIDDEN', 'user without role rejected');
const me = await api.auth.signIn('head@school.test', 'x');
ok(me.role === 'super_admin', 'super admin signs in');
ok((await api.auth.current()).role === 'super_admin', 'current() returns role');

console.log('# setup');
const school = await api.saveSchool({ name: 'Adapter Academy', academic_year: '2026', primary_color: '#047857', secondary_color: '#052e2b', accent_color: '#facc15', logo_url: null, banner_url: null, motto: 'Test' });
ok(school.name === 'Adapter Academy', 'saveSchool inserts');
ok((await api.saveSchool({ name: 'Adapter Academy 2' })).name === 'Adapter Academy 2', 'saveSchool updates');
const e = await api.createElection({ name: 'Student Government Elections', academic_year: '2026', results_visibility: 'live', rotation_seconds: 12 });
ok(e.status === 'draft' && e.school_id === school.id, 'createElection');
const e2 = await api.updateElection(e.id, { description: 'Hello', starts_at: null, ends_at: null, instructions: 'Pick', confirmation_message: 'Thanks' });
ok(e2.description === 'Hello', 'updateElection');
const p1 = await api.savePosition({ election_id: e.id, name: 'President', description: '', min_selections: 1, max_selections: 1, active: true });
const p2 = await api.savePosition({ election_id: e.id, name: 'Reps', description: '', min_selections: 1, max_selections: 2, active: true });
const p3 = await api.savePosition({ election_id: e.id, name: 'Temp', description: '', min_selections: 1, max_selections: 1, active: true });
ok(p1.display_order === 1 && p2.display_order === 2, 'savePosition insert + order');
ok((await api.savePosition({ ...p1, description: 'Leads' })).description === 'Leads', 'savePosition update');
await expectCode(api.savePosition({ election_id: e.id, name: 'Bad', min_selections: 2, max_selections: 1 }), 'VALIDATION', 'client-side min>max');
ok(await api.reorderPositions(e.id, [p2.id, p1.id, p3.id]), 'reorderPositions');
ok(await api.deletePosition(p3.id), 'deletePosition');
const cand = (p, name, code) => api.saveCandidate({ election_id: e.id, position_id: p.id, name, candidate_code: code, class_name: '10A', house: '', photo_url: '', slogan: 'Go', biography: '', manifesto: '', active: true });
const cA = await cand(p1, 'Alpha', 'C1'); const cB = await cand(p1, 'Beta', ''); const r1 = await cand(p2, 'Mu', 'R1'); const r2 = await cand(p2, 'Nu', 'R2'); const r3 = await cand(p2, 'Xi', null);
ok(cA.id && cB.candidate_code === null, 'saveCandidate insert (blank code → null)');
await expectCode(cand(p1, 'Dup', 'c1'), 'CONFLICT', 'duplicate candidate code → CONFLICT');
ok((await api.saveCandidate({ ...cA, slogan: 'Lead!' })).slogan === 'Lead!', 'saveCandidate update');
ok(await api.reorderCandidates(p1.id, [cB.id, cA.id]), 'reorderCandidates');
const tmp = await cand(p1, 'Temp', null);
ok(await api.deleteCandidate(tmp.id), 'deleteCandidate');
const imp = await api.importVoters(e.id, [{ student_reference: 'A1', class_name: '10A' }, { student_reference: 'A2', class_name: '10A' }, { student_reference: 'B1', class_name: '10B' }, { student_reference: 'B2', class_name: '10B' }, { student_reference: 'a1', class_name: '10A' }]);
ok(imp.created.length === 4 && imp.skipped.length === 1, 'importVoters');
const codes = Object.fromEntries(imp.created.map((c) => [c.student_reference, c.code]));
ok((await api.listClasses(e.id)).join() === '10A,10B', 'listClasses');
const lv = await api.listVoters(e.id, { q: 'a', page: 0, pageSize: 50 });
ok(lv.total === 2 && lv.rows.length === 2 && lv.rows[0].has_voted === false, 'listVoters search', lv);
ok((await api.listVoters(e.id, { cls: '10B' })).total === 2, 'listVoters class filter');
const bundle = await api.getBundle(e.id);
ok(bundle.positions.length === 2 && bundle.candidates.length === 5 && bundle.voters.total === 4 && bundle.ballots_cast === 0 && bundle.locked === false, 'getBundle', bundle.voters);
await expectCode(api.setStatus(e.id, 'closed', 'CLOSE ELECTION'), 'VALIDATION', 'draft cannot close');
const opened = await api.setStatus(e.id, 'open');
ok(opened.status === 'open', 'setStatus open');

console.log('# public + voting (anon)');
await api.auth.signOut();
const pub = await api.getPublic();
ok(pub.live.id === e.id && pub.school.name === 'Adapter Academy 2' && pub.pulse.live.eligible === 4, 'getPublic', pub.pulse);
await expectCode(api.beginVoting(e.id, 'ZZZZ-ZZZZ'), 'INVALID_CODE', 'invalid code');
const b = await api.beginVoting(e.id, codes.A1);
ok(b.token && b.positions.length === 2 && b.positions[0].name === 'Reps', 'beginVoting returns ballot in order');
await expectCode(api.submitBallot(b.token, { [p1.id]: [cA.id] }), 'BALLOT_INVALID', 'incomplete ballot');
ok((await api.submitBallot(b.token, { [p1.id]: [cA.id], [p2.id]: [r1.id, r2.id] })).ok, 'submitBallot');
await expectCode(api.beginVoting(e.id, codes.A1), 'CODE_USED', 'used code');
const b2 = await api.beginVoting(e.id, codes.A2);
await api.submitBallot(b2.token, { [p1.id]: [cB.id], [p2.id]: [r1.id] });
const b3 = await api.beginVoting(e.id, codes.B1);
await api.submitBallot(b3.token, { [p1.id]: [cA.id], [p2.id]: [r3.id] });
await api.stationHeartbeat(e.id, 'ST-ABC123', 'Lab 1');
const res = await api.getResults(e.id);
ok(res.stats.cast === 3 && res.positions.find((p) => p.name === 'President').candidates[0].name === 'Alpha', 'getResults live', res.stats);
const repsLive = res.positions.find((p) => p.name === 'Reps');
ok(repsLive.candidates.filter((c) => c.leading).length >= 2, 'multi-seat: top seats marked leading', repsLive.candidates.map((c) => [c.name, c.votes, c.rank, c.leading, c.tie]));
// shape parity with the JS standings
const js = S.rules.standings(repsLive, repsLive.candidates.map((c) => ({ ...c })), false);
ok(JSON.stringify(js.candidates.map((c) => [c.id, c.rank, c.tie, c.leading, Math.round(c.pct * 100)])) === JSON.stringify(repsLive.candidates.map((c) => [c.id, c.rank, c.tie, c.leading, Math.round(c.pct * 100)])), 'SQL ranking/tie/leading == JS rules.standings');

console.log('# admin while open');
await api.auth.signIn('head@school.test', 'x');
const mon = await api.getMonitor(e.id);
ok(mon.cast === 3 && mon.active_stations === 1 && mon.by_class.length === 2 && mon.votes_today === 3, 'getMonitor', { cast: mon.cast, st: mon.active_stations });
await expectCode(api.saveCandidate({ election_id: e.id, position_id: p1.id, name: 'Late', active: true }), 'FROZEN', 'frozen after votes');
const regen = await api.regenerateCodes(e.id, { className: '10B' });
ok(regen.length === 1 && regen[0].student_reference === 'B2', 'regenerateCodes by class (unused only)');
const all = await api.regenerateCodes(e.id, { allUnused: true, limit: 5 });
ok(all.length === 1, 'regenerateCodes allUnused');
const b2row = (await api.listVoters(e.id, { q: 'B2' })).rows[0];
ok(await api.setVoterActive(b2row.id, false), 'setVoterActive');
ok((await api.listVoters(e.id, { status: 'inactive' })).total === 1, 'listVoters status filter');
await expectCode(api.removeVoter((await api.listVoters(e.id, { q: 'A1' })).rows[0].id), 'VALIDATION', 'cannot remove voter who voted');
await api.logAction(e.id, 'results.viewed', {});
const audit = await api.listAudit(e.id, 100);
ok(audit.some((a) => a.action === 'results.viewed') && audit.some((a) => a.action === 'election.opened'), 'listAudit + logAction');
await api.grantAdmin('teacher@school.test', 'results_viewer');
const admins = await api.listAdmins();
ok(admins.length === 2 && admins.some((a) => a.role === 'results_viewer'), 'grantAdmin/listAdmins');
ok(await api.revokeAdmin(admins.find((a) => a.email === 'teacher@school.test').id), 'revokeAdmin');
ok((await api.updateElection(e.id, { results_visibility: 'after_close' })).results_visibility === 'after_close', 'updateElection while open');
await api.auth.signOut();
const sealed = await api.getResults(e.id);
ok(sealed.sealed === true && sealed.positions.length === 0 && sealed.stats.cast === 3, 'after_close → sealed for public, turnout visible');
await api.auth.signIn('head@school.test', 'x');

console.log('# close + archive');
await expectCode(api.setStatus(e.id, 'closed', 'nope'), 'VALIDATION', 'close needs phrase');
const closed = await api.setStatus(e.id, 'closed', 'CLOSE ELECTION');
ok(closed.status === 'closed', 'closed');
await api.auth.signOut();
const fin = await api.getResults(e.id);
ok(fin.final && !fin.sealed && fin.positions.find((p) => p.name === 'President').candidates[0].winner, 'final results visible after close with winner');
await api.auth.signIn('head@school.test', 'x');
await expectCode(api.updateElection(e.id, { name: 'X' }), 'LOCKED', 'closed config locked');
ok((await api.archiveElection(e.id, 'ARCHIVE ELECTION')).archived_at, 'archiveElection');
await api.auth.signOut();
ok((await api.getResults(e.id)).final === true, 'archived results still viewable');
await api.auth.signIn('head@school.test', 'x');

console.log('# demo via shared demo.js');
const demo = await S.demo.create(api, { academic_year: '2026' });
ok(demo.election.is_demo && demo.election.status === 'open' && demo.codes.length === 60, 'demo.create', { s: demo.election.status, n: demo.codes.length });
const n = await S.demo.simulateVotes(api, demo.election, 5);
ok(n === 5, 'demo.simulateVotes');
const dres = await api.getResults(demo.election.id);
ok(dres.stats.cast === 5, 'demo results');
const reset = await api.resetDemo(demo.election.id, 'RESET DEMO');
ok(reset.status === 'open' && (await api.getResults(demo.election.id)).stats.cast === 0, 'resetDemo');
await expectCode(api.resetDemo(e.id, 'RESET DEMO'), 'FORBIDDEN', 'live election cannot be reset');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
