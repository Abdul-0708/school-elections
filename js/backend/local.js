/* LOCAL DEMO ENGINE
   ------------------------------------------------------------------------------------
   An in-browser implementation of the election backend with exactly the same API as the
   Supabase adapter (js/backend/supabase.js).  It lets a school try the whole system with
   no server: data lives in this browser's localStorage, and other tabs/windows on the same
   computer receive live updates through BroadcastChannel.

   It mirrors the rules enforced by supabase/schema.sql (one vote per code, hashed codes,
   transactional submission, frozen structure, locked final results, role checks), but it is
   NOT a security boundary — anyone with access to the computer can edit browser storage.
   Use it for demos and testing.  Run the real election on Supabase.
   ------------------------------------------------------------------------------------ */
(function (S) {
  'use strict';
  const U = S.util, R = S.rules;
  const KEY = 'sge.local.v1';
  const ADMIN_KEY = 'sge.local.admin';
  const SESSION_MINUTES = 30;
  const err = (code, msg, detail) => new S.ApiError(code, msg || (R.MESSAGES[code] && R.MESSAGES[code].text) || code, detail);
  const now = () => Date.now();
  const iso = (t) => new Date(t == null ? now() : t).toISOString();

  function createLocalBackend() {
    let memory = null; // used only when localStorage is unavailable
    const blank = () => ({
      version: 1, pepper: U.randomHex(16), school: null, elections: [], positions: [], candidates: [],
      voters: [], ballots: [], selections: [], sessions: [], stations: [], audit: [], admins: [], finals: {},
    });
    const read = () => {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) { /* fall through */ }
      return memory ? JSON.parse(JSON.stringify(memory)) : blank();
    };
    const write = (db) => {
      try { localStorage.setItem(KEY, JSON.stringify(db)); }
      catch (e) {
        if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
          throw err('STORAGE_FULL', "This browser's storage is full. Use smaller photos, or connect Supabase for the real election.");
        }
        memory = db;
      }
    };

    /* ---- change notifications (other tabs + this tab) */
    const listeners = new Set();
    const bc = 'BroadcastChannel' in window ? new BroadcastChannel('sge-local') : null;
    const fire = (evt) => listeners.forEach((fn) => { try { fn(evt); } catch (e) { console.error(e); } });
    const notify = (evt) => { fire(evt); if (bc) bc.postMessage(evt); };
    if (bc) bc.onmessage = (m) => fire(m.data || {});
    window.addEventListener('storage', (e) => { if (e.key === KEY) fire({ type: 'storage' }); });

    /* ---- transactions: serialised with the Web Locks API when available */
    const latency = () => U.sleep(15 + Math.random() * 35); // small delay so loading states are exercised
    async function tx(fn, evt) {
      await latency();
      const run = async () => { const db = read(); const out = await fn(db); write(db); return out; };
      const out = navigator.locks && navigator.locks.request ? await navigator.locks.request('sge-local-db', run) : await run();
      if (evt) notify(typeof evt === 'function' ? evt(out) : evt);
      return out;
    }
    async function q(fn) { await latency(); return fn(read()); }

    /* ---- auth (local accounts; demo only) */
    const hashPw = (pw, salt) => { let h = `${salt}:${pw}`; for (let i = 0; i < 1500; i++) h = U.sha256(h + salt); return h; };
    const sessionGet = () => { try { return JSON.parse(sessionStorage.getItem(ADMIN_KEY) || 'null'); } catch (e) { return null; } };
    const sessionSet = (v) => { try { v ? sessionStorage.setItem(ADMIN_KEY, JSON.stringify(v)) : sessionStorage.removeItem(ADMIN_KEY); } catch (e) { /* ignore */ } };
    const me = (db) => {
      const s = sessionGet();
      const a = s && db.admins.find((x) => x.id === s.id);
      return a ? { id: a.id, email: a.email, role: a.role } : null;
    };
    const requireCap = (db, cap) => {
      const m = me(db);
      if (!m) throw err('AUTH', 'Please sign in as an administrator.');
      if (cap && !R.can(m.role, cap)) throw err('FORBIDDEN', 'Your administrator role does not allow this action.');
      return m;
    };
    const audit = (db, electionId, actor, action, metadata) => {
      db.audit.push({ id: U.uuid(), election_id: electionId || null, actor_email: actor ? actor.email : 'system', action, metadata: metadata || {}, created_at: iso() });
      if (db.audit.length > 3000) db.audit.splice(0, db.audit.length - 3000);
    };

    /* ---- lookups */
    const election = (db, id) => {
      const e = db.elections.find((x) => x.id === id);
      if (!e) throw err('NOT_FOUND', 'Election not found.');
      return e;
    };
    const current = (db, kind) => db.elections.filter((e) => !e.archived_at && !!e.is_demo === (kind === 'demo'))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;
    const ballotsCast = (db, eid) => db.ballots.filter((b) => b.election_id === eid).length;
    const codeHash = (db, code) => U.sha256(`${db.pepper}:${code}`);
    const voterCounts = (db, eid) => {
      const vs = db.voters.filter((v) => v.election_id === eid);
      return {
        total: vs.length,
        active: vs.filter((v) => v.active).length,
        voted: vs.filter((v) => v.used_at).length,
        eligible: vs.filter((v) => v.active || v.used_at).length,
      };
    };
    const pulse = (db, e) => {
      const vc = voterCounts(db, e.id);
      const used = db.voters.filter((v) => v.election_id === e.id && v.used_at).map((v) => v.used_at).sort();
      return { election_id: e.id, status: e.status, votes_cast: ballotsCast(db, e.id), eligible: vc.eligible, last_vote_at: used[used.length - 1] || null };
    };
    const assertNotClosed = (e) => { if (e.status === 'closed') throw err('LOCKED', 'This election is closed. Final results are locked and cannot be changed.'); };
    const locked = (db, e) => R.structureLocked(e, ballotsCast(db, e.id));
    const assertStructureEditable = (db, e) => {
      assertNotClosed(e);
      if (locked(db, e)) throw err('FROZEN', 'Voting has started, so positions, candidates and selection rules are frozen. You can still correct names and descriptions.');
    };
    const publicCandidate = (c) => ({ id: c.id, position_id: c.position_id, name: c.name, class_name: c.class_name, house: c.house, photo_url: c.photo_url, slogan: c.slogan, biography: c.biography, manifesto: c.manifesto, display_order: c.display_order });
    const ballotFor = (db, e) => db.positions
      .filter((p) => p.election_id === e.id && p.active)
      .sort((a, b) => a.display_order - b.display_order)
      .map((p) => ({
        id: p.id, name: p.name, description: p.description, min_selections: p.min_selections, max_selections: p.max_selections, display_order: p.display_order,
        candidates: db.candidates.filter((c) => c.position_id === p.id && c.active).sort((a, b) => a.display_order - b.display_order).map(publicCandidate),
      }))
      .filter((p) => p.candidates.length > 0);
    const stateError = (vs) => err({ not_open: 'NOT_OPEN', paused: 'PAUSED', closed: 'CLOSED', ended: 'ENDED', none: 'NOT_OPEN' }[vs.state] || 'NOT_OPEN');

    function computeResults(db, e, final) {
      const counts = new Map();
      const ballotIds = new Set(db.ballots.filter((b) => b.election_id === e.id).map((b) => b.id));
      db.selections.forEach((s) => { if (ballotIds.has(s.ballot_id)) counts.set(s.candidate_id, (counts.get(s.candidate_id) || 0) + 1); });
      return db.positions
        .filter((p) => p.election_id === e.id && (p.active || db.candidates.some((c) => c.position_id === p.id && counts.get(c.id))))
        .sort((a, b) => a.display_order - b.display_order)
        .map((p) => {
          const cands = db.candidates.filter((c) => c.position_id === p.id && (c.active || counts.get(c.id)))
            .map((c) => ({ ...publicCandidate(c), votes: counts.get(c.id) || 0 }));
          return R.standings({ id: p.id, name: p.name, description: p.description, max_selections: p.max_selections, min_selections: p.min_selections, display_order: p.display_order }, cands, final);
        })
        .filter((p) => p.candidates.length > 0);
    }
    function statsFor(db, e) {
      const p = pulse(db, e);
      return { eligible: p.eligible, cast: p.votes_cast, remaining: Math.max(0, p.eligible - p.votes_cast), turnout: U.pct(p.votes_cast, p.eligible), last_vote_at: p.last_vote_at };
    }

    function validateSelections(ballot, selections) {
      if (!selections || typeof selections !== 'object' || Array.isArray(selections)) throw err('BALLOT_INVALID');
      const byId = new Map(ballot.map((p) => [p.id, p]));
      Object.keys(selections).forEach((k) => { if (!byId.has(k)) throw err('BALLOT_INVALID', 'Your ballot contained a position that is not part of this election.'); });
      ballot.forEach((p) => {
        const ids = selections[p.id] || [];
        if (!Array.isArray(ids)) throw err('BALLOT_INVALID');
        if (new Set(ids).size !== ids.length) throw err('BALLOT_INVALID', `Duplicate selection for ${p.name}.`);
        if (ids.length < p.min_selections) throw err('BALLOT_INVALID', `Please make a selection for ${p.name}.`);
        if (ids.length > p.max_selections) throw err('BALLOT_INVALID', `Too many selections for ${p.name}.`);
        ids.forEach((id) => { if (!p.candidates.some((c) => c.id === id)) throw err('BALLOT_INVALID', `A selected candidate for ${p.name} is no longer available.`); });
      });
    }

    function makeVoterCodes(db, eid, voters) {
      const taken = new Set(db.voters.filter((v) => v.election_id === eid).map((v) => v.code_hash));
      return voters.map((v) => {
        let code, h;
        do { code = U.generateCode(); h = codeHash(db, code); } while (taken.has(h));
        taken.add(h);
        v.code_hash = h;
        return code;
      });
    }

    function snapshotFinal(db, e) {
      db.finals[e.id] = { computed_at: iso(), stats: statsFor(db, e), positions: computeResults(db, e, true) };
    }

    const api = {
      mode: 'local',
      label: 'Local demo engine (this browser only)',

      /* =================================================== public ======= */
      async getPublic() {
        return q((db) => {
          const live = current(db, 'live'), demo = current(db, 'demo');
          return { school: db.school, live, demo, pulse: { live: live && pulse(db, live), demo: demo && pulse(db, demo) } };
        });
      },
      subscribe(electionId, fn) {
        const h = (evt) => { if (!electionId || !evt.election_id || evt.election_id === electionId) fn(evt); };
        listeners.add(h);
        return () => listeners.delete(h);
      },

      /* =================================================== station ====== */
      async beginVoting(electionId, code) {
        return tx((db) => {
          const e = db.elections.find((x) => x.id === electionId && !x.archived_at);
          if (!e) throw err('NOT_OPEN');
          const vs = R.votingState(e);
          if (!vs.canVote) throw stateError(vs);
          const norm = U.normalizeCode(code);
          if (!norm) throw err('INVALID_CODE');
          const v = db.voters.find((x) => x.election_id === e.id && x.code_hash === codeHash(db, norm));
          if (!v || !v.active) throw err('INVALID_CODE');
          if (v.used_at) throw err('CODE_USED');
          const token = U.randomHex(24);
          const t = now();
          db.sessions = db.sessions.filter((s) => s.expires_at > t && s.voter_id !== v.id);
          db.sessions.push({ token_hash: U.sha256(token), voter_id: v.id, election_id: e.id, expires_at: t + SESSION_MINUTES * 60000 });
          return { token, expires_at: iso(t + SESSION_MINUTES * 60000), positions: ballotFor(db, e) };
        });
      },

      async submitBallot(token, selections) {
        return tx((db) => {
          const s = db.sessions.find((x) => x.token_hash === U.sha256(String(token || '')));
          if (!s || s.expires_at < now()) throw err('SESSION_EXPIRED');
          const e = db.elections.find((x) => x.id === s.election_id);
          const vs = R.votingState(e);
          if (!vs.canVote) throw stateError(vs);
          const v = db.voters.find((x) => x.id === s.voter_id);
          if (!v || !v.active) throw err('INVALID_CODE');
          if (v.used_at) throw err('CODE_USED');
          validateSelections(ballotFor(db, e), selections);
          // Record the ballot WITHOUT any link to the voter.  The time is rounded to the hour and
          // rows are inserted at random positions so ballot order can't be matched to voter order.
          const hour = new Date(); hour.setMinutes(0, 0, 0);
          const ballot = { id: U.uuid(), election_id: e.id, submitted_at: hour.toISOString(), ballot_token: U.randomHex(16) };
          db.ballots.splice(Math.floor(Math.random() * (db.ballots.length + 1)), 0, ballot);
          Object.entries(selections).forEach(([pid, ids]) => ids.forEach((cid) => {
            db.selections.splice(Math.floor(Math.random() * (db.selections.length + 1)), 0, { ballot_id: ballot.id, position_id: pid, candidate_id: cid });
          }));
          v.used_at = iso();
          db.sessions = db.sessions.filter((x) => x !== s);
          return { ok: true, election_id: e.id };
        }, (out) => ({ type: 'vote', election_id: out.election_id }));
      },

      async stationHeartbeat(electionId, stationId, label) {
        if (!electionId || !/^[A-Za-z0-9-]{6,40}$/.test(stationId || '')) return;
        return tx((db) => {
          const st = db.stations.find((x) => x.id === stationId && x.election_id === electionId);
          if (st) { st.last_seen_at = iso(); st.label = label || st.label; }
          else db.stations.push({ id: stationId, election_id: electionId, label: label || stationId.slice(0, 6), last_seen_at: iso() });
          db.stations = db.stations.filter((x) => now() - Date.parse(x.last_seen_at) < 24 * 3600e3);
        }, { type: 'station', election_id: electionId });
      },

      /* =================================================== results ====== */
      async getResults(electionId) {
        return q((db) => {
          const e = election(db, electionId);
          const m = me(db);
          const privileged = !!(m && R.can(m.role, 'results.view'));
          const closed = e.status === 'closed';
          const visible = privileged || e.results_visibility === 'live' || (e.results_visibility === 'after_close' && closed);
          const final = closed && db.finals[e.id];
          return {
            election: e, school: db.school, final: !!final, computed_at: final ? final.computed_at : iso(),
            sealed: !visible, privileged,
            stats: final ? final.stats : statsFor(db, e),
            positions: visible ? (final ? final.positions : computeResults(db, e, false)) : [],
          };
        });
      },

      /* =================================================== auth ========= */
      auth: {
        async current() { return q((db) => me(db)); },
        async needsBootstrap() { return q((db) => db.admins.length === 0); },
        async bootstrap(email, password) {
          return tx((db) => {
            if (db.admins.length) throw err('FORBIDDEN', 'An administrator already exists. Please sign in.');
            if (!/^\S+@\S+\.\S+$/.test(email)) throw err('VALIDATION', 'Enter a valid email address.');
            if (String(password).length < 8) throw err('VALIDATION', 'Use a password of at least 8 characters.');
            const salt = U.randomHex(8);
            const a = { id: U.uuid(), email: email.toLowerCase(), role: 'super_admin', salt, pw: hashPw(password, salt), created_at: iso() };
            db.admins.push(a);
            audit(db, null, a, 'admin.bootstrap', { email: a.email });
            sessionSet({ id: a.id });
            return { id: a.id, email: a.email, role: a.role };
          });
        },
        async signIn(email, password) {
          return tx((db) => {
            const a = db.admins.find((x) => x.email === String(email || '').toLowerCase().trim());
            if (!a || a.pw !== hashPw(password, a.salt)) throw err('AUTH', 'Email or password is incorrect.');
            sessionSet({ id: a.id });
            audit(db, null, a, 'admin.signed_in', {});
            return { id: a.id, email: a.email, role: a.role };
          });
        },
        async signOut() { sessionSet(null); },
        async signOutLocal() { sessionSet(null); },
      },

      /* =================================================== admin ======== */
      async getSchool() { return q((db) => db.school); },
      async saveSchool(patch) {
        return tx((db) => {
          const m = requireCap(db, 'school.edit');
          if (!String(patch.name || (db.school && db.school.name) || '').trim()) throw err('VALIDATION', 'Enter the school name.');
          db.school = { id: (db.school && db.school.id) || U.uuid(), created_at: (db.school && db.school.created_at) || iso(), ...(db.school || {}), ...patch, updated_at: iso() };
          audit(db, null, m, 'school.updated', { name: db.school.name });
          return db.school;
        }, { type: 'config' });
      },
      async uploadImage(dataUrl) { return dataUrl; },

      async listElections() {
        return q((db) => { requireCap(db); return db.elections.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)); });
      },
      async getBundle(electionId) {
        return q((db) => {
          requireCap(db);
          const e = election(db, electionId);
          return {
            election: e,
            positions: db.positions.filter((p) => p.election_id === e.id).sort((a, b) => a.display_order - b.display_order),
            candidates: db.candidates.filter((c) => c.election_id === e.id).sort((a, b) => a.display_order - b.display_order),
            voters: voterCounts(db, e.id),
            ballots_cast: ballotsCast(db, e.id),
            locked: locked(db, e),
          };
        });
      },
      async createElection(data) {
        return tx((db) => {
          const m = requireCap(db, data.is_demo ? 'demo.manage' : 'election.edit');
          if (current(db, data.is_demo ? 'demo' : 'live')) throw err('CONFLICT', data.is_demo ? 'A demo election already exists.' : 'There is already a current election. Close and archive it before creating a new one.');
          const errs = R.validateElection(data);
          if (Object.keys(errs).length) throw err('VALIDATION', Object.values(errs)[0]);
          const e = {
            id: U.uuid(), school_id: db.school && db.school.id, name: data.name, subtitle: data.subtitle || '', academic_year: data.academic_year || (db.school && db.school.academic_year) || '',
            description: data.description || '', instructions: data.instructions || '', confirmation_message: data.confirmation_message || '',
            status: 'draft', is_demo: !!data.is_demo, results_visibility: data.results_visibility || 'live', rotation_seconds: data.rotation_seconds || 12,
            starts_at: data.starts_at || null, ends_at: data.ends_at || null, opened_at: null, closed_at: null, archived_at: null, created_at: iso(), updated_at: iso(),
          };
          db.elections.push(e);
          audit(db, e.id, m, 'election.created', { name: e.name, demo: e.is_demo });
          return e;
        }, (e) => ({ type: 'config', election_id: e.id }));
      },
      async updateElection(id, patch) {
        return tx((db) => {
          const e = election(db, id);
          const displayOnly = Object.keys(patch).every((k) => ['results_visibility', 'rotation_seconds'].includes(k));
          const m = requireCap(db, displayOnly ? 'results.settings' : ('election.edit'));
          if (!displayOnly) assertNotClosed(e);
          const allowed = ['name', 'subtitle', 'academic_year', 'description', 'instructions', 'confirmation_message', 'results_visibility', 'rotation_seconds', 'starts_at', 'ends_at'];
          const next = { ...e };
          allowed.forEach((k) => { if (k in patch) next[k] = patch[k]; });
          const errs = R.validateElection(next);
          if (Object.keys(errs).length) throw err('VALIDATION', Object.values(errs)[0]);
          Object.assign(e, next, { updated_at: iso() });
          audit(db, e.id, m, 'election.updated', { fields: Object.keys(patch) });
          return e;
        }, { type: 'config', election_id: id });
      },
      async setStatus(id, status, phrase) {
        return tx((db) => {
          const e = election(db, id);
          const m = requireCap(db, 'election.status');
          if (!(R.TRANSITIONS[e.status] || []).includes(status)) throw err('VALIDATION', `An election cannot move from ${e.status} to ${status}.`);
          if (status === 'closed' && phrase !== R.PHRASES.close) throw err('VALIDATION', `Type ${R.PHRASES.close} to confirm.`);
          if (status === 'open' || status === 'scheduled') {
            const ready = R.readiness({ school: db.school, election: e, positions: db.positions.filter((p) => p.election_id === e.id), candidates: db.candidates.filter((c) => c.election_id === e.id), eligible: voterCounts(db, e.id).active });
            if (!ready.ok) throw err('NOT_READY', 'The election is not ready: ' + ready.checks.filter((c) => !c.ok).map((c) => c.label).join(', ') + '.');
            if (status === 'scheduled' && !e.starts_at) throw err('VALIDATION', 'Set a start date and time before scheduling.');
          }
          const from = e.status;
          e.status = status;
          e.updated_at = iso();
          if (status === 'open' && !e.opened_at) e.opened_at = iso();
          if (status === 'closed') {
            e.closed_at = iso();
            db.sessions = db.sessions.filter((s) => s.election_id !== e.id);
            snapshotFinal(db, e);
          }
          audit(db, e.id, m, `election.${{ open: 'opened', paused: 'paused', closed: 'closed', scheduled: 'scheduled', draft: 'returned_to_draft' }[status]}`, { from, to: status });
          return e;
        }, { type: 'status', election_id: id });
      },
      async archiveElection(id, phrase) {
        return tx((db) => {
          const e = election(db, id);
          const m = requireCap(db, 'election.status');
          if (e.status !== 'closed') throw err('VALIDATION', 'Only a closed election can be archived.');
          if (phrase !== R.PHRASES.archive) throw err('VALIDATION', `Type ${R.PHRASES.archive} to confirm.`);
          e.archived_at = iso();
          audit(db, e.id, m, 'election.archived', {});
          return e;
        }, { type: 'config', election_id: id });
      },

      /* ---- positions */
      async savePosition(p) {
        return tx((db) => {
          const e = election(db, p.election_id);
          const m = requireCap(db, 'positions.edit');
          assertNotClosed(e);
          const existing = p.id && db.positions.find((x) => x.id === p.id);
          const isLocked = locked(db, e);
          const row = {
            name: String(p.name || '').trim(), description: String(p.description || '').trim(),
            min_selections: Number(p.min_selections), max_selections: Number(p.max_selections), active: p.active !== false,
          };
          if (isLocked && (!existing || row.min_selections !== existing.min_selections || row.max_selections !== existing.max_selections || row.active !== existing.active)) {
            throw err('FROZEN', 'Voting has started — positions cannot be added, removed or re-ruled. Only names and descriptions can be corrected.');
          }
          const activeCands = existing ? db.candidates.filter((c) => c.position_id === existing.id && c.active).length : null;
          const errs = R.validatePosition(row, activeCands);
          if (Object.keys(errs).length) throw err('VALIDATION', Object.values(errs)[0]);
          if (existing) { Object.assign(existing, row); audit(db, e.id, m, 'position.edited', { name: row.name }); return existing; }
          const order = Math.max(0, ...db.positions.filter((x) => x.election_id === e.id).map((x) => x.display_order)) + 1;
          const created = { id: U.uuid(), election_id: e.id, display_order: order, ...row };
          db.positions.push(created);
          audit(db, e.id, m, 'position.added', { name: row.name });
          return created;
        }, { type: 'config', election_id: p.election_id });
      },
      async deletePosition(id) {
        return tx((db) => {
          const p = db.positions.find((x) => x.id === id);
          if (!p) throw err('NOT_FOUND', 'Position not found.');
          const e = election(db, p.election_id);
          const m = requireCap(db, 'positions.edit');
          assertStructureEditable(db, e);
          db.candidates = db.candidates.filter((c) => c.position_id !== id);
          db.positions = db.positions.filter((x) => x.id !== id);
          audit(db, e.id, m, 'position.removed', { name: p.name });
          return true;
        }, { type: 'config' });
      },
      async reorderPositions(electionId, ids) {
        return tx((db) => {
          const e = election(db, electionId);
          requireCap(db, 'positions.edit');
          assertStructureEditable(db, e);
          ids.forEach((id, i) => { const p = db.positions.find((x) => x.id === id && x.election_id === electionId); if (p) p.display_order = i + 1; });
          return true;
        }, { type: 'config', election_id: electionId });
      },

      /* ---- candidates */
      async saveCandidate(c) {
        return tx((db) => {
          const e = election(db, c.election_id);
          const m = requireCap(db, 'candidates.edit');
          assertNotClosed(e);
          const existing = c.id && db.candidates.find((x) => x.id === c.id);
          const fields = ['name', 'candidate_code', 'class_name', 'house', 'photo_url', 'slogan', 'biography', 'manifesto'];
          const row = { position_id: c.position_id, active: c.active !== false };
          fields.forEach((k) => { row[k] = typeof c[k] === 'string' ? c[k].trim() : (c[k] || ''); });
          if (locked(db, e) && (!existing || existing.position_id !== row.position_id || existing.active !== row.active)) {
            throw err('FROZEN', 'Voting has started — candidates cannot be added, removed, moved or deactivated. You can still correct their details.');
          }
          const errs = R.validateCandidate({ ...row, id: c.id }, db.candidates.filter((x) => x.election_id === e.id), db.positions.filter((x) => x.election_id === e.id));
          if (Object.keys(errs).length) throw err('VALIDATION', Object.values(errs)[0]);
          if (existing) { Object.assign(existing, row); audit(db, e.id, m, 'candidate.edited', { name: row.name }); return existing; }
          const order = Math.max(0, ...db.candidates.filter((x) => x.position_id === row.position_id).map((x) => x.display_order)) + 1;
          const created = { id: U.uuid(), election_id: e.id, display_order: order, ...row };
          db.candidates.push(created);
          audit(db, e.id, m, 'candidate.added', { name: row.name });
          return created;
        }, { type: 'config', election_id: c.election_id });
      },
      async deleteCandidate(id) {
        return tx((db) => {
          const c = db.candidates.find((x) => x.id === id);
          if (!c) throw err('NOT_FOUND', 'Candidate not found.');
          const e = election(db, c.election_id);
          const m = requireCap(db, 'candidates.edit');
          assertStructureEditable(db, e);
          db.candidates = db.candidates.filter((x) => x.id !== id);
          audit(db, e.id, m, 'candidate.removed', { name: c.name });
          return true;
        }, { type: 'config' });
      },
      async reorderCandidates(positionId, ids) {
        return tx((db) => {
          const p = db.positions.find((x) => x.id === positionId);
          if (!p) throw err('NOT_FOUND', 'Position not found.');
          const e = election(db, p.election_id);
          requireCap(db, 'candidates.edit');
          assertStructureEditable(db, e);
          ids.forEach((id, i) => { const c = db.candidates.find((x) => x.id === id && x.position_id === positionId); if (c) c.display_order = i + 1; });
          return true;
        }, { type: 'config' });
      },

      /* ---- voters & codes */
      async listVoters(electionId, { q: search = '', cls = '', status = '', page = 0, pageSize = 50 } = {}) {
        return q((db) => {
          requireCap(db, 'voters.manage');
          const s = search.toLowerCase();
          let rows = db.voters.filter((v) => v.election_id === electionId)
            .filter((v) => !s || v.student_reference.toLowerCase().includes(s) || String(v.class_name || '').toLowerCase().includes(s))
            .filter((v) => !cls || v.class_name === cls)
            .filter((v) => !status || (status === 'voted' ? !!v.used_at : status === 'not_voted' ? !v.used_at && v.active : !v.active));
          rows.sort((a, b) => String(a.class_name).localeCompare(String(b.class_name)) || a.student_reference.localeCompare(b.student_reference, undefined, { numeric: true }));
          const total = rows.length;
          rows = rows.slice(page * pageSize, page * pageSize + pageSize)
            .map((v) => ({ id: v.id, student_reference: v.student_reference, class_name: v.class_name, active: v.active, has_voted: !!v.used_at, created_at: v.created_at }));
          return { rows, total };
        });
      },
      async listClasses(electionId) {
        return q((db) => {
          requireCap(db, 'monitor.view');
          return [...new Set(db.voters.filter((v) => v.election_id === electionId).map((v) => v.class_name || ''))].sort();
        });
      },
      async importVoters(electionId, rows) {
        return tx((db) => {
          const e = election(db, electionId);
          const m = requireCap(db, 'voters.manage');
          assertNotClosed(e);
          if (rows.length > 5000) throw err('VALIDATION', 'Import at most 5,000 voters at a time.');
          const seen = new Set(db.voters.filter((v) => v.election_id === e.id).map((v) => v.student_reference.toLowerCase()));
          const created = [], skipped = [], fresh = [];
          rows.forEach((r) => {
            const ref = String(r.student_reference || '').trim(), cls = String(r.class_name || '').trim();
            if (!ref) return skipped.push({ student_reference: '(blank)', reason: 'Missing student reference' });
            if (ref.length > 64 || cls.length > 40) return skipped.push({ student_reference: ref, reason: 'Too long' });
            if (seen.has(ref.toLowerCase())) return skipped.push({ student_reference: ref, reason: 'Already registered' });
            seen.add(ref.toLowerCase());
            fresh.push({ id: U.uuid(), election_id: e.id, student_reference: ref, class_name: cls, active: true, used_at: null, created_at: iso() });
          });
          const codes = makeVoterCodes(db, e.id, fresh);
          fresh.forEach((v, i) => { db.voters.push(v); created.push({ student_reference: v.student_reference, class_name: v.class_name, code: codes[i] }); });
          audit(db, e.id, m, 'voters.imported', { created: created.length, skipped: skipped.length });
          return { created, skipped };
        }, { type: 'config', election_id: electionId });
      },
      async setVoterActive(voterId, active) {
        return tx((db) => {
          const v = db.voters.find((x) => x.id === voterId);
          if (!v) throw err('NOT_FOUND', 'Voter not found.');
          const e = election(db, v.election_id);
          const m = requireCap(db, 'voters.manage');
          assertNotClosed(e);
          if (v.used_at) throw err('VALIDATION', 'This voter has already voted; their status can no longer change.');
          v.active = !!active;
          audit(db, e.id, m, active ? 'voter.activated' : 'voter.deactivated', { ref: v.student_reference });
          return true;
        }, (x) => ({ type: 'config' }));
      },
      async removeVoter(voterId) {
        return tx((db) => {
          const v = db.voters.find((x) => x.id === voterId);
          if (!v) throw err('NOT_FOUND', 'Voter not found.');
          const e = election(db, v.election_id);
          const m = requireCap(db, 'voters.manage');
          assertNotClosed(e);
          if (v.used_at) throw err('VALIDATION', 'This voter has already voted and cannot be removed.');
          db.voters = db.voters.filter((x) => x.id !== voterId);
          db.sessions = db.sessions.filter((s) => s.voter_id !== voterId);
          audit(db, e.id, m, 'voter.removed', { ref: v.student_reference });
          return true;
        }, { type: 'config' });
      },
      /* Issues new codes (old ones stop working).  target: { voterIds } | { className } | { allUnused: true } */
      async regenerateCodes(electionId, target) {
        return tx((db) => {
          const e = election(db, electionId);
          const m = requireCap(db, 'voters.manage');
          assertNotClosed(e);
          let vs = db.voters.filter((v) => v.election_id === e.id && !v.used_at && v.active);
          if (target.voterIds) vs = vs.filter((v) => target.voterIds.includes(v.id));
          else if (target.className != null) vs = vs.filter((v) => v.class_name === target.className);
          else if (!target.allUnused) vs = [];
          if (target.limit) vs = vs.slice(0, target.limit);
          const codes = makeVoterCodes(db, e.id, vs);
          db.sessions = db.sessions.filter((s) => !vs.some((v) => v.id === s.voter_id));
          audit(db, e.id, m, 'codes.regenerated', { count: vs.length });
          return vs.map((v, i) => ({ student_reference: v.student_reference, class_name: v.class_name, code: codes[i] }));
        });
      },

      /* ---- monitoring */
      async getMonitor(electionId) {
        return q((db) => {
          requireCap(db, 'monitor.view');
          const e = election(db, electionId);
          const st = statsFor(db, e);
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const ballots = db.ballots.filter((b) => b.election_id === e.id);
          const byHour = {};
          ballots.forEach((b) => { byHour[b.submitted_at] = (byHour[b.submitted_at] || 0) + 1; });
          const byClass = {};
          db.voters.filter((v) => v.election_id === e.id && (v.active || v.used_at)).forEach((v) => {
            const k = v.class_name || '—';
            byClass[k] = byClass[k] || { class_name: k, eligible: 0, voted: 0 };
            byClass[k].eligible++;
            if (v.used_at) byClass[k].voted++;
          });
          const stations = db.stations.filter((s) => s.election_id === e.id).sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));
          return {
            election: e, ...st,
            votes_today: ballots.filter((b) => Date.parse(b.submitted_at) >= today.getTime()).length,
            by_hour: Object.entries(byHour).map(([hour, votes]) => ({ hour, votes })).sort((a, b) => a.hour.localeCompare(b.hour)),
            by_class: Object.values(byClass).sort((a, b) => a.class_name.localeCompare(b.class_name, undefined, { numeric: true })),
            stations,
            active_stations: stations.filter((s) => now() - Date.parse(s.last_seen_at) < 90e3).length,
          };
        });
      },
      async listAudit(electionId, limit = 200) {
        return q((db) => {
          requireCap(db, 'audit.view');
          return db.audit.filter((a) => !electionId || a.election_id === electionId || a.election_id == null).slice(-limit).reverse();
        });
      },
      async logAction(electionId, action, metadata) {
        return tx((db) => { const m = requireCap(db); audit(db, electionId, m, action, metadata); });
      },

      /* ---- administrators */
      async listAdmins() {
        return q((db) => { requireCap(db, 'admins.manage'); return db.admins.map((a) => ({ id: a.id, email: a.email, role: a.role, created_at: a.created_at })); });
      },
      async grantAdmin(email, role, password) {
        return tx((db) => {
          const m = requireCap(db, 'admins.manage');
          if (!R.ROLES[role]) throw err('VALIDATION', 'Choose a role.');
          email = String(email || '').toLowerCase().trim();
          if (!/^\S+@\S+\.\S+$/.test(email)) throw err('VALIDATION', 'Enter a valid email address.');
          const a = db.admins.find((x) => x.email === email);
          if (a) {
            if (a.id === m.id && role !== 'super_admin') throw err('VALIDATION', 'You cannot lower your own role.');
            a.role = role;
          } else {
            if (String(password || '').length < 8) throw err('VALIDATION', 'Set a password of at least 8 characters for the new administrator.');
            const salt = U.randomHex(8);
            db.admins.push({ id: U.uuid(), email, role, salt, pw: hashPw(password, salt), created_at: iso() });
          }
          audit(db, null, m, 'admin.role_granted', { email, role });
          return true;
        });
      },
      async revokeAdmin(id) {
        return tx((db) => {
          const m = requireCap(db, 'admins.manage');
          if (id === m.id) throw err('VALIDATION', 'You cannot remove your own access.');
          const a = db.admins.find((x) => x.id === id);
          if (!a) throw err('NOT_FOUND', 'Administrator not found.');
          db.admins = db.admins.filter((x) => x.id !== id);
          audit(db, null, m, 'admin.revoked', { email: a.email });
          return true;
        });
      },

      /* ---- demo mode */
      async resetDemo(electionId, phrase) {
        return tx((db) => {
          const e = election(db, electionId);
          const m = requireCap(db, 'demo.manage');
          if (!e.is_demo) throw err('FORBIDDEN', 'Only the demo election can be reset. Real elections can never be reset.');
          if (phrase !== R.PHRASES.resetDemo) throw err('VALIDATION', `Type ${R.PHRASES.resetDemo} to confirm.`);
          const ids = new Set(db.ballots.filter((b) => b.election_id === e.id).map((b) => b.id));
          db.ballots = db.ballots.filter((b) => !ids.has(b.id));
          db.selections = db.selections.filter((s) => !ids.has(s.ballot_id));
          db.voters.forEach((v) => { if (v.election_id === e.id) v.used_at = null; });
          db.sessions = db.sessions.filter((s) => s.election_id !== e.id);
          delete db.finals[e.id];
          Object.assign(e, { status: 'open', opened_at: iso(), closed_at: null, updated_at: iso() });
          audit(db, e.id, m, 'demo.reset', {});
          return e;
        }, { type: 'status', election_id: electionId });
      },
      async eraseEverything(phrase) {
        const db = read();
        requireCap(db, 'admins.manage');
        if (phrase !== R.PHRASES.erase) throw err('VALIDATION', `Type ${R.PHRASES.erase} to confirm.`);
        try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
        memory = null;
        sessionSet(null);
        notify({ type: 'config' });
      },
      async getAppInfo() { return { mode: 'local', label: api.label }; },
    };
    return api;
  }

  S.createLocalBackend = createLocalBackend;
})(window.SGE);
