/* SUPABASE BACKEND ADAPTER
   ------------------------------------------------------------------------------------
   Same API as js/backend/local.js, backed by the database in supabase/schema.sql.
   Uses ONLY the public (anon / publishable) key.  Every privileged rule — one vote per
   code, ballot validation, role checks, locking — is enforced inside Postgres; this file
   just calls it.  Admin sessions are kept in sessionStorage so a shared lab computer
   forgets the administrator when the tab closes.
   ------------------------------------------------------------------------------------ */
(function (S) {
  'use strict';
  const U = S.util, R = S.rules;
  const KNOWN = new Set(['NETWORK', 'INVALID_CODE', 'CODE_USED', 'NOT_OPEN', 'PAUSED', 'CLOSED', 'ENDED', 'SESSION_EXPIRED',
    'BALLOT_INVALID', 'AUTH', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'LOCKED', 'FROZEN', 'NOT_READY', 'CONFLICT', 'RATE_LIMITED']);

  const networkError = () => new S.ApiError('NETWORK', R.MESSAGES.NETWORK.text);
  function mapError(e) {
    const msg = String((e && e.message) || '');
    if (KNOWN.has(msg)) return new S.ApiError(msg, e.details || (R.MESSAGES[msg] && R.MESSAGES[msg].text) || msg);
    if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(msg)) return networkError();
    if (e && (e.code === 'PGRST301' || e.code === 'PGRST303' || /jwt/i.test(msg))) return new S.ApiError('AUTH', 'Your session has expired. Please sign in again.');
    if (e && (e.code === '42501' || /row-level security|permission denied/i.test(msg))) return new S.ApiError('FORBIDDEN', 'Your administrator role does not allow this action.');
    if (e && e.code === '23505') return new S.ApiError('CONFLICT', 'That value is already in use. Please choose a different one.');
    if (e && e.code === '23514') return new S.ApiError('VALIDATION', 'Some values are not allowed. Please check the form.');
    if (e && e.code === '23503') return new S.ApiError('LOCKED', 'This item is referenced by recorded votes and cannot be removed.');
    return new S.ApiError('ERROR', msg || 'Unexpected server error.');
  }

  function createSupabaseBackend(cfg) {
    if (!window.supabase || !window.supabase.createClient) throw new Error('supabase-js failed to load.');
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, storage: window.sessionStorage, storageKey: 'sge-admin-session', autoRefreshToken: true, detectSessionInUrl: false },
    });
    const bucket = cfg.MEDIA_BUCKET || 'election-media';

    async function run(promiseLike) {
      let res;
      try { res = await promiseLike; } catch (e) { throw networkError(); }
      if (res.error) throw mapError(res.error);
      return res;
    }
    const rpc = async (fn, args) => (await run(sb.rpc(fn, args || {}))).data;
    const pick = (obj, keys) => keys.reduce((o, k) => { if (k in obj) o[k] = obj[k] === undefined ? null : obj[k]; return o; }, {});
    const assertValid = (errs) => { if (Object.keys(errs).length) throw new S.ApiError('VALIDATION', Object.values(errs)[0]); };

    const SCHOOL_COLS = ['name', 'logo_url', 'motto', 'academic_year', 'primary_color', 'secondary_color', 'accent_color', 'banner_url'];
    const ELECTION_COLS = ['name', 'subtitle', 'academic_year', 'description', 'instructions', 'confirmation_message', 'results_visibility', 'rotation_seconds', 'starts_at', 'ends_at'];
    const CANDIDATE_COLS = ['name', 'candidate_code', 'class_name', 'house', 'photo_url', 'slogan', 'biography', 'manifesto', 'active'];

    const api = {
      mode: 'supabase',
      label: 'Supabase · ' + (String(cfg.SUPABASE_URL).replace(/^https?:\/\//, '').split('/')[0]),

      /* ---------------- public */
      async getPublic() {
        const d = await rpc('get_public_state');
        return { school: d.school, live: d.live, demo: d.demo, pulse: d.pulse || {} };
      },
      subscribe(electionId, fn) {
        const filter = { event: '*', schema: 'public', table: 'election_pulse' };
        if (electionId) filter.filter = `election_id=eq.${electionId}`;
        const ch = sb.channel(`pulse-${electionId || 'all'}-${Math.random().toString(36).slice(2, 8)}`)
          .on('postgres_changes', filter, (payload) => {
            const row = payload.new || payload.old || {};
            fn({ type: 'pulse', election_id: row.election_id, pulse: payload.new });
          })
          .subscribe((status) => fn({ type: 'realtime', status }));
        return () => { try { sb.removeChannel(ch); } catch (e) { /* ignore */ } };
      },

      /* ---------------- station */
      async beginVoting(electionId, code) {
        const d = await rpc('begin_voting', { p_election_id: electionId, p_code: String(code || '') });
        if (d && d.error) throw new S.ApiError(d.error, (R.MESSAGES[d.error] && R.MESSAGES[d.error].text) || d.error);
        return d;
      },
      async submitBallot(token, selections) {
        const d = await rpc('submit_ballot', { p_token: token, p_selections: selections });
        if (!d || d.ok !== true) throw new S.ApiError('SUBMIT_FAILED', R.MESSAGES.SUBMIT_FAILED.text);
        return d;
      },
      async stationHeartbeat(electionId, stationId, label) {
        try { await rpc('station_heartbeat', { p_election_id: electionId, p_station_id: stationId, p_label: label || '' }); } catch (e) { /* non-critical */ }
      },

      /* ---------------- results */
      async getResults(electionId) { return rpc('get_results', { p_election_id: electionId }); },

      /* ---------------- auth */
      auth: {
        async current() {
          let session;
          try { session = (await sb.auth.getSession()).data.session; } catch (e) { return null; }
          if (!session) return null;
          const me = await rpc('my_admin');
          return me || { id: session.user.id, email: session.user.email, role: null };
        },
        async needsBootstrap() { return false; },
        async bootstrap() { throw new S.ApiError('FORBIDDEN', 'Create the first Super Admin in Supabase (see README).'); },
        async signIn(email, password) {
          let res;
          try { res = await sb.auth.signInWithPassword({ email: String(email || '').trim(), password }); } catch (e) { throw networkError(); }
          if (res.error) {
            if (/fetch/i.test(res.error.message)) throw networkError();
            throw new S.ApiError('AUTH', 'Email or password is incorrect.');
          }
          const me = await rpc('my_admin');
          if (!me) {
            await sb.auth.signOut();
            throw new S.ApiError('FORBIDDEN', 'This account is not an election administrator. Ask a Super Admin to grant you access.');
          }
          rpc('log_action', { p_election_id: null, p_action: 'admin.signed_in', p_metadata: {} }).catch(() => {});
          return me;
        },
        async signOut() { try { await sb.auth.signOut(); } catch (e) { /* ignore */ } },
        // Forget the session in THIS tab only (used when a computer becomes a voting station).
        async signOutLocal() { try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* ignore */ } },
      },

      /* ---------------- school & elections */
      async getSchool() { return (await run(sb.from('schools').select('*').limit(1).maybeSingle())).data; },
      async saveSchool(patch) {
        const row = pick(patch, SCHOOL_COLS);
        if ('name' in row && !String(row.name || '').trim()) throw new S.ApiError('VALIDATION', 'Enter the school name.');
        const existing = await api.getSchool();
        const q = existing ? sb.from('schools').update(row).eq('id', existing.id) : sb.from('schools').insert(row);
        return (await run(q.select().single())).data;
      },
      async uploadImage(dataUrl, folder) {
        if (!/^data:image\//.test(dataUrl || '')) return dataUrl;
        const blob = U.dataUrlToBlob(dataUrl);
        const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
        const path = `${folder || 'misc'}/${U.uuid()}.${ext}`;
        await run(sb.storage.from(bucket).upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: '31536000' }));
        return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
      },
      async listElections() { return (await run(sb.from('elections').select('*').order('created_at', { ascending: false }))).data; },
      async getBundle(electionId) { return rpc('get_admin_bundle', { p_election_id: electionId }); },
      async createElection(data) {
        assertValid(R.validateElection(data));
        const school = await api.getSchool();
        const row = { ...pick(data, ELECTION_COLS), is_demo: !!data.is_demo, school_id: school ? school.id : null };
        return (await run(sb.from('elections').insert(row).select().single())).data;
      },
      async updateElection(id, patch) {
        const row = pick(patch, ELECTION_COLS);
        const res = await run(sb.from('elections').update(row).eq('id', id).select());
        if (!res.data || !res.data.length) throw new S.ApiError('FORBIDDEN', 'Your administrator role does not allow this action.');
        return res.data[0];
      },
      async setStatus(id, status, phrase) { return rpc('set_election_status', { p_election_id: id, p_status: status, p_confirm: phrase || null }); },
      async archiveElection(id, phrase) { return rpc('archive_election', { p_election_id: id, p_confirm: phrase || '' }); },

      /* ---------------- positions */
      async savePosition(p) {
        const row = { name: String(p.name || '').trim(), description: String(p.description || '').trim(),
          min_selections: Number(p.min_selections), max_selections: Number(p.max_selections), active: p.active !== false };
        assertValid(R.validatePosition(row));
        const q = p.id
          ? sb.from('positions').update(row).eq('id', p.id)
          : sb.from('positions').insert({ ...row, election_id: p.election_id });
        const res = await run(q.select());
        if (!res.data || !res.data.length) throw new S.ApiError('FORBIDDEN', 'Your administrator role does not allow this action.');
        return res.data[0];
      },
      async deletePosition(id) {
        const res = await run(sb.from('positions').delete().eq('id', id).select('id'));
        if (!res.data || !res.data.length) throw new S.ApiError('FORBIDDEN', 'This position could not be deleted.');
        return true;
      },
      async reorderPositions(electionId, ids) { await rpc('reorder_positions', { p_election_id: electionId, p_ids: ids }); return true; },

      /* ---------------- candidates */
      async saveCandidate(c) {
        const row = pick(c, CANDIDATE_COLS);
        CANDIDATE_COLS.forEach((k) => { if (typeof row[k] === 'string') row[k] = row[k].trim(); });
        if (!row.candidate_code) row.candidate_code = null;
        row.position_id = c.position_id;
        const q = c.id
          ? sb.from('candidates').update(row).eq('id', c.id)
          : sb.from('candidates').insert({ ...row, election_id: c.election_id });
        const res = await run(q.select());
        if (!res.data || !res.data.length) throw new S.ApiError('FORBIDDEN', 'Your administrator role does not allow this action.');
        return res.data[0];
      },
      async deleteCandidate(id) {
        const res = await run(sb.from('candidates').delete().eq('id', id).select('id'));
        if (!res.data || !res.data.length) throw new S.ApiError('FORBIDDEN', 'This candidate could not be deleted.');
        return true;
      },
      async reorderCandidates(positionId, ids) { await rpc('reorder_candidates', { p_position_id: positionId, p_ids: ids }); return true; },

      /* ---------------- voters & codes */
      async listVoters(electionId, { q = '', cls = '', status = '', page = 0, pageSize = 50 } = {}) {
        let query = sb.from('voters').select('id, student_reference, class_name, active, has_voted, created_at', { count: 'exact' }).eq('election_id', electionId);
        const safe = String(q).replace(/[^\p{L}\p{N} ._@/-]/gu, '').trim();
        if (safe) query = query.or(`student_reference.ilike.%${safe}%,class_name.ilike.%${safe}%`);
        if (cls) query = query.eq('class_name', cls);
        if (status === 'voted') query = query.eq('has_voted', true);
        else if (status === 'not_voted') query = query.eq('has_voted', false).eq('active', true);
        else if (status === 'inactive') query = query.eq('active', false);
        query = query.order('class_name').order('student_reference').range(page * pageSize, page * pageSize + pageSize - 1);
        const res = await run(query);
        return { rows: res.data || [], total: res.count || 0 };
      },
      async listClasses(electionId) {
        const res = await run(sb.from('voters').select('class_name').eq('election_id', electionId).limit(20000));
        return [...new Set((res.data || []).map((r) => r.class_name || ''))].sort();
      },
      async importVoters(electionId, rows) {
        const out = { created: [], skipped: [] };
        for (let i = 0; i < rows.length; i += 1000) {
          const d = await rpc('import_voters', { p_election_id: electionId, p_rows: rows.slice(i, i + 1000) });
          out.created.push(...d.created);
          out.skipped.push(...d.skipped);
        }
        return out;
      },
      async setVoterActive(voterId, active) { await rpc('set_voter_active', { p_voter_id: voterId, p_active: !!active }); return true; },
      async removeVoter(voterId) { await rpc('remove_voter', { p_voter_id: voterId }); return true; },
      async regenerateCodes(electionId, target) {
        return rpc('regenerate_codes', {
          p_election_id: electionId, p_voter_ids: target.voterIds || null,
          p_class_name: target.className != null ? target.className : null,
          p_all_unused: !!target.allUnused, p_limit: target.limit || null,
        });
      },

      /* ---------------- monitoring & audit */
      async getMonitor(electionId) { return rpc('get_monitor', { p_election_id: electionId }); },
      async listAudit(electionId, limit = 200) {
        let query = sb.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(limit);
        if (electionId) query = query.or(`election_id.eq.${electionId},election_id.is.null`);
        return (await run(query)).data || [];
      },
      async logAction(electionId, action, metadata) {
        try { await rpc('log_action', { p_election_id: electionId || null, p_action: action, p_metadata: metadata || {} }); } catch (e) { /* non-critical */ }
      },

      /* ---------------- administrators */
      async listAdmins() { return rpc('list_admins'); },
      async grantAdmin(email, role) { await rpc('grant_admin', { p_email: email, p_role: role }); return true; },
      async revokeAdmin(id) { await rpc('revoke_admin', { p_user_id: id }); return true; },

      /* ---------------- demo */
      async resetDemo(electionId, phrase) { return rpc('reset_demo', { p_election_id: electionId, p_confirm: phrase || '' }); },
      async eraseEverything() { throw new S.ApiError('FORBIDDEN', 'Production data can only be removed from the Supabase dashboard.'); },
      async getAppInfo() { return { mode: 'supabase', label: api.label }; },
    };
    return api;
  }

  S.createSupabaseBackend = createSupabaseBackend;
})(window.SGE);
