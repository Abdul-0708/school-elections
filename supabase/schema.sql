-- =====================================================================================
--  STUDENT GOVERNMENT ELECTION SYSTEM — Supabase database
--  Run this whole file once in Supabase → SQL Editor → New query → Run.
--  It is safe to re-run (objects are created "if not exists" / "or replace").
--
--  Security model (summary)
--  • Every table has Row Level Security enabled.  Browsers only ever hold the public
--    (anon / publishable) key; the service_role key is never needed by this app.
--  • Students never touch tables.  They call two SECURITY DEFINER functions:
--        begin_voting(election, code)   → validates the code, returns a short-lived session + ballot
--        submit_ballot(token, choices)  → validates and records the ballot in ONE transaction
--  • Voting codes are stored only as HMAC-SHA256 fingerprints with a secret pepper that lives
--    in the non-exposed `private` schema.  Codes are shown to administrators once, at creation.
--  • Ballots carry NO voter id.  The voter row only records that (and roughly when) they voted.
--    Ballot timestamps are truncated to the hour so ballots can't be matched to voters by time.
--  • One-person-one-vote: the voter row is locked (FOR UPDATE) and used_at is set with a
--    conditional update in the same transaction as the ballot insert.  Any failure rolls the
--    whole thing back, so a code is never marked used without its ballot (and vice versa).
--  • Ballots, selections, final results and audit logs are append-only (triggers block
--    UPDATE/DELETE).  The only exception is resetting the separate DEMO election.
--  • Once an election is CLOSED, its configuration, voters and results are locked.
--  • Results reach the browser only as aggregates via get_results(); live updates are
--    signalled through the tiny public `election_pulse` table (Supabase Realtime).
-- =====================================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

-- -------------------------------------------------------------------------------------
--  Secrets (never exposed through the API)
-- -------------------------------------------------------------------------------------
create table if not exists private.settings (
  key   text primary key,
  value text not null
);
insert into private.settings (key, value)
values ('code_pepper', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- -------------------------------------------------------------------------------------
--  Tables
-- -------------------------------------------------------------------------------------
create table if not exists public.schools (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(btrim(name)) between 1 and 160),
  logo_url        text,
  motto           text not null default '' check (char_length(motto) <= 200),
  academic_year   text not null default '' check (char_length(academic_year) <= 20),
  primary_color   text not null default '#1d4ed8' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  secondary_color text not null default '#0f172a' check (secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color    text not null default '#f59e0b' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  banner_url      text,
  singleton       boolean not null default true unique check (singleton),  -- one school per installation
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.elections (
  id                   uuid primary key default gen_random_uuid(),
  school_id            uuid references public.schools (id) on delete restrict,
  name                 text not null check (char_length(btrim(name)) between 1 and 120),
  subtitle             text not null default '' check (char_length(subtitle) <= 160),
  academic_year        text not null default '' check (char_length(academic_year) <= 20),
  description          text not null default '' check (char_length(description) <= 2000),
  instructions         text not null default '' check (char_length(instructions) <= 2000),
  confirmation_message text not null default '' check (char_length(confirmation_message) <= 500),
  status               text not null default 'draft' check (status in ('draft', 'scheduled', 'open', 'paused', 'closed')),
  is_demo              boolean not null default false,
  results_visibility   text not null default 'live' check (results_visibility in ('live', 'after_close', 'hidden')),
  rotation_seconds     int not null default 12 check (rotation_seconds between 5 and 300),
  starts_at            timestamptz,
  ends_at              timestamptz,
  opened_at            timestamptz,
  closed_at            timestamptz,
  archived_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint elections_window check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint elections_archive_closed check (archived_at is null or status = 'closed')
);
-- At most one current (non-archived) real election and one demo election.
create unique index if not exists elections_one_current_live on public.elections ((true)) where archived_at is null and not is_demo;
create unique index if not exists elections_one_current_demo on public.elections ((true)) where archived_at is null and is_demo;
create index if not exists elections_school_idx on public.elections (school_id);

create table if not exists public.positions (
  id             uuid primary key default gen_random_uuid(),
  election_id    uuid not null references public.elections (id) on delete cascade,
  name           text not null check (char_length(btrim(name)) between 1 and 120),
  description    text not null default '' check (char_length(description) <= 1000),
  display_order  int not null default 0,
  min_selections int not null default 1 check (min_selections >= 0),
  max_selections int not null default 1 check (max_selections between 1 and 20),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  constraint positions_min_le_max check (min_selections <= max_selections),
  constraint positions_id_election unique (id, election_id)
);
create index if not exists positions_election_idx on public.positions (election_id, display_order);

create table if not exists public.candidates (
  id             uuid primary key default gen_random_uuid(),
  election_id    uuid not null,
  position_id    uuid not null,
  name           text not null check (char_length(btrim(name)) between 1 and 120),
  candidate_code text,
  class_name     text not null default '' check (char_length(class_name) <= 60),
  house          text not null default '' check (char_length(house) <= 60),
  photo_url      text,
  slogan         text not null default '' check (char_length(slogan) <= 160),
  biography      text not null default '' check (char_length(biography) <= 2000),
  manifesto      text not null default '' check (char_length(manifesto) <= 5000),
  display_order  int not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  constraint candidates_position_fk foreign key (position_id, election_id)
    references public.positions (id, election_id) on delete cascade,
  constraint candidates_id_position unique (id, position_id)
);
create unique index if not exists candidates_code_unique
  on public.candidates (election_id, upper(btrim(candidate_code)))
  where candidate_code is not null and btrim(candidate_code) <> '';
create index if not exists candidates_position_idx on public.candidates (position_id, display_order);
create index if not exists candidates_election_idx on public.candidates (election_id);
create index if not exists candidates_position_election_idx on public.candidates (position_id, election_id);

create table if not exists public.voters (
  id                uuid primary key default gen_random_uuid(),
  election_id       uuid not null references public.elections (id) on delete cascade,
  student_reference text not null check (char_length(btrim(student_reference)) between 1 and 64),
  class_name        text not null default '' check (char_length(class_name) <= 40),
  voting_code_hash  text not null,
  active            boolean not null default true,
  used_at           timestamptz,
  has_voted         boolean generated always as (used_at is not null) stored,
  created_at        timestamptz not null default now(),
  constraint voters_code_unique unique (election_id, voting_code_hash)
);
create unique index if not exists voters_reference_unique on public.voters (election_id, lower(btrim(student_reference)));
create index if not exists voters_class_idx on public.voters (election_id, class_name);

-- Ballots deliberately have NO voter column.
create table if not exists public.ballots (
  id           uuid primary key default gen_random_uuid(),
  election_id  uuid not null references public.elections (id) on delete restrict,
  submitted_at timestamptz not null default date_trunc('hour', now()),  -- hour precision, for privacy
  ballot_token text not null unique default encode(extensions.gen_random_bytes(16), 'hex')
);
create index if not exists ballots_election_idx on public.ballots (election_id);

create table if not exists public.ballot_selections (
  id           uuid primary key default gen_random_uuid(),
  ballot_id    uuid not null references public.ballots (id) on delete cascade,
  position_id  uuid not null references public.positions (id) on delete restrict,
  candidate_id uuid not null,
  constraint ballot_selections_candidate_fk foreign key (candidate_id, position_id)
    references public.candidates (id, position_id) on delete restrict,
  constraint ballot_selections_once unique (ballot_id, candidate_id)
);
create index if not exists ballot_selections_candidate_position_idx on public.ballot_selections (candidate_id, position_id);
create index if not exists ballot_selections_position_idx on public.ballot_selections (position_id);

create table if not exists public.final_results (
  election_id uuid primary key references public.elections (id) on delete restrict,
  positions   jsonb not null,
  stats       jsonb not null,
  computed_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  election_id   uuid references public.elections (id) on delete restrict,
  admin_user_id uuid,
  actor_email   text,
  action        text not null,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists audit_logs_election_idx on public.audit_logs (election_id, created_at desc);

create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  role       text not null check (role in ('super_admin', 'election_admin', 'results_viewer')),
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.voting_stations (
  id           text not null check (id ~ '^[A-Za-z0-9-]{6,40}$'),
  election_id  uuid not null references public.elections (id) on delete cascade,
  label        text not null default '' check (char_length(label) <= 40),
  last_seen_at timestamptz not null default now(),
  primary key (id, election_id)
);
create index if not exists voting_stations_election_idx on public.voting_stations (election_id);

-- Tiny, public, aggregate-only row per election.  Supabase Realtime broadcasts its changes
-- so results screens and stations update instantly without polling the whole dataset.
create table if not exists public.election_pulse (
  election_id    uuid primary key references public.elections (id) on delete cascade,
  status         text not null,
  votes_cast     int not null default 0,
  eligible       int not null default 0,
  last_vote_at   timestamptz,
  config_version int not null default 0,
  updated_at     timestamptz not null default now()
);

create table if not exists private.voting_sessions (
  token_hash  text primary key,
  voter_id    uuid not null references public.voters (id) on delete cascade,
  election_id uuid not null references public.elections (id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists voting_sessions_voter_idx on private.voting_sessions (voter_id);
create index if not exists voting_sessions_expiry_idx on private.voting_sessions (expires_at);
create index if not exists voting_sessions_election_idx on private.voting_sessions (election_id);

-- Failed code attempts per (hashed) client address — slows down code guessing.
create table if not exists private.code_attempts (
  client_hash text not null,
  bucket      timestamptz not null,
  failures    int not null default 0,
  primary key (client_hash, bucket)
);

-- -------------------------------------------------------------------------------------
--  Roles & capabilities  (mirrors js/core/rules.js)
-- -------------------------------------------------------------------------------------
create or replace function public.admin_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.admin_users where user_id = auth.uid()
$$;

create or replace function public.has_cap(cap text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(r = any (case cap
      when 'admin'            then array['super_admin', 'election_admin', 'results_viewer']
      when 'school.edit'      then array['super_admin']
      when 'election.edit'    then array['super_admin']
      when 'election.status'  then array['super_admin']
      when 'positions.edit'   then array['super_admin']
      when 'candidates.edit'  then array['super_admin', 'election_admin']
      when 'voters.manage'    then array['super_admin', 'election_admin']
      when 'monitor.view'     then array['super_admin', 'election_admin', 'results_viewer']
      when 'results.view'     then array['super_admin', 'election_admin', 'results_viewer']
      when 'results.settings' then array['super_admin']
      when 'reports.export'   then array['super_admin']
      when 'audit.view'       then array['super_admin', 'election_admin']
      when 'admins.manage'    then array['super_admin']
      when 'demo.manage'      then array['super_admin']
      else array[]::text[] end), false)
  from (select public.admin_role() as r) x
$$;

create or replace function private.require_cap(cap text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH' using detail = 'Please sign in as an administrator.';
  end if;
  if not public.has_cap(cap) then
    raise exception 'FORBIDDEN' using detail = 'Your administrator role does not allow this action.';
  end if;
end $$;

create or replace function private.audit(p_election_id uuid, p_action text, p_metadata jsonb default '{}'::jsonb) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.audit_logs (election_id, admin_user_id, actor_email, action, metadata)
  values (p_election_id, auth.uid(),
          coalesce((select email from public.admin_users where user_id = auth.uid()), case when auth.uid() is null then 'system' end),
          p_action, coalesce(p_metadata, '{}'::jsonb))
$$;

-- -------------------------------------------------------------------------------------
--  Election state helpers
-- -------------------------------------------------------------------------------------
-- What a voter experiences right now: open | not_open | paused | closed | ended
create or replace function public.voting_state(e public.elections) returns text
language sql stable set search_path = '' as $$
  select case
    when e.status = 'closed' then 'closed'
    when e.status = 'paused' then 'paused'
    when e.status in ('open', 'scheduled') and e.ends_at is not null and now() >= e.ends_at then 'ended'
    when e.status = 'open' then 'open'
    when e.status = 'scheduled' and e.starts_at is not null and now() >= e.starts_at then 'open'
    else 'not_open'
  end
$$;

create or replace function private.state_error(p_state text) returns text
language sql immutable set search_path = '' as $$
  select case p_state when 'paused' then 'PAUSED' when 'closed' then 'CLOSED' when 'ended' then 'ENDED' else 'NOT_OPEN' end
$$;

create or replace function private.structure_locked(p_election_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select status = 'closed' from public.elections where id = p_election_id), false)
      or exists (select 1 from public.ballots where election_id = p_election_id)
$$;

create or replace function private.normalize_code(p_input text) returns text
language sql immutable set search_path = '' as $$
  select case when char_length(s) = 8 then substr(s, 1, 4) || '-' || substr(s, 5, 4) end
  from (select regexp_replace(upper(coalesce(p_input, '')), '[^A-Z0-9]', '', 'g') as s) x
$$;

create or replace function private.code_hash(p_code text) returns text
language sql stable security definer set search_path = '' as $$
  select encode(extensions.hmac(p_code, (select value from private.settings where key = 'code_pepper'), 'sha256'), 'hex')
$$;

-- 8 symbols from a 31-character alphabet without look-alikes (no I, L, O, 0, 1): ≈ 8.5 × 10^11 codes.
create or replace function private.new_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea;
  v int;
  out text := '';
begin
  while char_length(out) < 8 loop
    b := extensions.gen_random_bytes(16);
    for i in 0..15 loop
      v := get_byte(b, i);
      if v < 248 and char_length(out) < 8 then          -- rejection sampling: no modulo bias
        out := out || substr(alphabet, (v % 31) + 1, 1);
      end if;
    end loop;
  end loop;
  return substr(out, 1, 4) || '-' || substr(out, 5, 4);
end $$;

-- Positions that appear on the ballot: active, with at least one active candidate.
create or replace function private.ballot_positions(p_election_id uuid) returns setof public.positions
language sql stable security definer set search_path = '' as $$
  select p.* from public.positions p
  where p.election_id = p_election_id and p.active
    and exists (select 1 from public.candidates c where c.position_id = p.id and c.active)
  order by p.display_order, p.name
$$;

create or replace function private.ballot_json(p_election_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'description', p.description, 'display_order', p.display_order,
      'min_selections', p.min_selections, 'max_selections', p.max_selections,
      'candidates', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id, 'position_id', c.position_id, 'name', c.name, 'class_name', c.class_name, 'house', c.house,
          'photo_url', c.photo_url, 'slogan', c.slogan, 'biography', c.biography, 'manifesto', c.manifesto,
          'display_order', c.display_order) order by c.display_order, c.name), '[]'::jsonb)
        from public.candidates c where c.position_id = p.id and c.active)
    ) order by p.display_order, p.name), '[]'::jsonb)
  from private.ballot_positions(p_election_id) p
$$;

create or replace function private.election_stats(p_election_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'eligible', v.eligible, 'cast', b.cast_count, 'remaining', greatest(v.eligible - b.cast_count, 0),
    'turnout', case when v.eligible > 0 then round(b.cast_count * 100.0 / v.eligible, 2) else 0 end,
    'last_vote_at', v.last_vote_at)
  from (select count(*) filter (where active or used_at is not null)::int as eligible, max(used_at) as last_vote_at
        from public.voters where election_id = p_election_id) v,
       (select count(*)::int as cast_count from public.ballots where election_id = p_election_id) b
$$;

create or replace function private.refresh_pulse(p_election_id uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.election_pulse
     set eligible = (select count(*) from public.voters where election_id = p_election_id and (active or used_at is not null)),
         votes_cast = (select count(*) from public.ballots where election_id = p_election_id),
         config_version = config_version + 1,
         updated_at = now()
   where election_id = p_election_id
$$;

-- Per-candidate vote counts for one position (active candidates, plus any that received votes).
create or replace function private.position_counts(p_position_id uuid)
returns table (id uuid, name text, class_name text, house text, photo_url text, slogan text, display_order int, votes int)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.class_name, c.house, c.photo_url, c.slogan, c.display_order, count(bs.id)::int
  from public.candidates c
  left join public.ballot_selections bs on bs.candidate_id = c.id
  where c.position_id = p_position_id
  group by c.id
  having c.active or count(bs.id) > 0
$$;

/* Results for every position, generated from the recorded ballots.
   percentage = candidate votes / total valid votes for that position × 100
   rank       = standard competition ranking (1, 2, 2, 4)
   seats      = the position's maximum selections
   A tie for the last winning seat is reported as a TIE — no winner is declared automatically. */
create or replace function private.compute_results(p_election_id uuid, p_final boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  p record;
  v_out jsonb := '[]'::jsonb;
  v_n int; v_total int; v_cutoff int; v_at int; v_top int; v_seats int; v_cands jsonb;
begin
  for p in select * from public.positions where election_id = p_election_id order by display_order, name loop
    select count(*), coalesce(sum(votes), 0) into v_n, v_total from private.position_counts(p.id);
    if v_n = 0 or (not p.active and v_total = 0) then continue; end if;
    v_seats := greatest(p.max_selections, 1);
    select pc.votes into v_cutoff from private.position_counts(p.id) pc
      order by pc.votes desc, pc.display_order, pc.name offset least(v_seats, v_n) - 1 limit 1;
    select count(*) into v_at from private.position_counts(p.id) pc where pc.votes >= v_cutoff;
    select count(*) into v_top from private.position_counts(p.id) pc
      where pc.votes = (select max(x.votes) from private.position_counts(p.id) x);
    select jsonb_agg(jsonb_build_object(
        'id', x.id, 'name', x.name, 'class_name', x.class_name, 'house', x.house, 'photo_url', x.photo_url,
        'slogan', x.slogan, 'display_order', x.display_order, 'votes', x.votes, 'rank', x.rnk,
        'pct', case when v_total > 0 then round(x.votes * 100.0 / v_total, 2) else 0 end,
        'tie', x.votes > 0 and x.votes = v_cutoff and v_at > v_seats,
        'winner', p_final and x.votes > 0 and (x.votes > v_cutoff or (x.votes = v_cutoff and v_at <= v_seats)),
        'leading', (not p_final) and x.votes > 0 and x.rnk <= v_seats
      ) order by x.votes desc, x.display_order, x.name)
      into v_cands
      from (select pc.*, rank() over (order by pc.votes desc)::int as rnk from private.position_counts(p.id) pc) x;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', p.id, 'name', p.name, 'description', p.description, 'display_order', p.display_order,
      'min_selections', p.min_selections, 'max_selections', p.max_selections, 'seats', v_seats,
      'total_votes', v_total,
      'top_tie', v_total > 0 and v_top > 1,
      'outcome', case when v_total = 0 then 'none'
                      when not p_final then 'live'
                      when v_cutoff > 0 and v_at > v_seats then 'tie'
                      else 'decided' end,
      'candidates', coalesce(v_cands, '[]'::jsonb)));
  end loop;
  return v_out;
end $$;

create or replace function private.readiness_issues(p_election_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.elections;
  issues text[] := '{}';
begin
  select * into e from public.elections where id = p_election_id;
  if not e.is_demo and not exists (select 1 from public.schools) then issues := issues || 'school details'::text; end if;
  if not exists (select 1 from public.positions where election_id = e.id and active) then issues := issues || 'positions'::text; end if;
  if exists (select 1 from public.positions p where p.election_id = e.id and p.active
             and (select count(*) from public.candidates c where c.position_id = p.id and c.active) < greatest(p.min_selections, 1)) then
    issues := issues || 'candidates for every position'::text;
  end if;
  if not exists (select 1 from public.voters where election_id = e.id and active) then issues := issues || 'eligible voters'::text; end if;
  if e.ends_at is not null and e.ends_at <= now() then issues := issues || 'an end time in the future'::text; end if;
  return case when cardinality(issues) = 0 then null else array_to_string(issues, ', ') end;
end $$;

-- -------------------------------------------------------------------------------------
--  Triggers: integrity guards
-- -------------------------------------------------------------------------------------
create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists schools_touch on public.schools;
create trigger schools_touch before update on public.schools for each row execute function private.touch_updated_at();

create or replace function private.guard_elections() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_reset boolean := coalesce(current_setting('sge.demo_reset', true), '') = 'on' and old.is_demo;
begin
  if v_reset then new.updated_at := now(); return new; end if;
  if new.is_demo is distinct from old.is_demo then
    raise exception 'VALIDATION' using detail = 'An election cannot switch between demo and live.';
  end if;
  if new.status is distinct from old.status and coalesce(current_setting('sge.status_change', true), '') <> 'on' then
    raise exception 'VALIDATION' using detail = 'Use the Open / Pause / Close controls to change the election status.';
  end if;
  if old.status = 'closed' and row(new.name, new.subtitle, new.academic_year, new.description, new.instructions,
       new.confirmation_message, new.status, new.starts_at, new.ends_at, new.opened_at, new.closed_at, new.school_id)
     is distinct from row(old.name, old.subtitle, old.academic_year, old.description, old.instructions,
       old.confirmation_message, old.status, old.starts_at, old.ends_at, old.opened_at, old.closed_at, old.school_id) then
    raise exception 'LOCKED' using detail = 'This election is closed. Its configuration and final results are locked.';
  end if;
  if old.archived_at is not null and new.archived_at is distinct from old.archived_at then
    raise exception 'LOCKED' using detail = 'Archived elections cannot be changed.';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists elections_guard on public.elections;
create trigger elections_guard before update on public.elections for each row execute function private.guard_elections();

create or replace function private.block_election_delete() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'LOCKED' using detail = 'Elections are never deleted. Archive a closed election instead.'; end $$;
drop trigger if exists elections_no_delete on public.elections;
create trigger elections_no_delete before delete on public.elections for each row execute function private.block_election_delete();

create or replace function private.guard_positions() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_eid uuid := case when tg_op = 'DELETE' then old.election_id else new.election_id end;
  v_status text;
begin
  select status into v_status from public.elections where id = v_eid;
  if v_status = 'closed' then
    raise exception 'LOCKED' using detail = 'This election is closed. Final results are locked.';
  end if;
  if tg_op = 'UPDATE' and new.election_id <> old.election_id then
    raise exception 'VALIDATION' using detail = 'A position cannot move to another election.';
  end if;
  if private.structure_locked(v_eid) and (tg_op <> 'UPDATE'
      or new.min_selections <> old.min_selections or new.max_selections <> old.max_selections
      or new.active <> old.active or new.display_order <> old.display_order) then
    raise exception 'FROZEN' using detail = 'Voting has started — positions cannot be added, removed, reordered or re-ruled. Only names and descriptions can be corrected.';
  end if;
  if tg_op = 'INSERT' and coalesce(new.display_order, 0) = 0 then
    new.display_order := (select coalesce(max(display_order), 0) + 1 from public.positions where election_id = new.election_id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists positions_guard on public.positions;
create trigger positions_guard before insert or update or delete on public.positions for each row execute function private.guard_positions();

create or replace function private.guard_candidates() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_eid uuid := case when tg_op = 'DELETE' then old.election_id else new.election_id end;
  v_status text;
begin
  select status into v_status from public.elections where id = v_eid;
  if v_status = 'closed' then
    raise exception 'LOCKED' using detail = 'This election is closed. Final results are locked.';
  end if;
  if private.structure_locked(v_eid) and (tg_op <> 'UPDATE'
      or new.position_id <> old.position_id or new.election_id <> old.election_id
      or new.active <> old.active or new.display_order <> old.display_order) then
    raise exception 'FROZEN' using detail = 'Voting has started — candidates cannot be added, removed, moved, reordered or deactivated. You can still correct their details.';
  end if;
  if tg_op <> 'DELETE' and new.active
     and not coalesce((select active from public.positions where id = new.position_id), false) then
    raise exception 'VALIDATION' using detail = 'That position is inactive. Activate it first or choose another position.';
  end if;
  if tg_op = 'INSERT' and coalesce(new.display_order, 0) = 0 then
    new.display_order := (select coalesce(max(display_order), 0) + 1 from public.candidates where position_id = new.position_id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists candidates_guard on public.candidates;
create trigger candidates_guard before insert or update or delete on public.candidates for each row execute function private.guard_candidates();

create or replace function private.guard_voters() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_eid uuid := case when tg_op = 'DELETE' then old.election_id else new.election_id end;
  v_is_demo boolean;
  v_status text;
begin
  select status, is_demo into v_status, v_is_demo from public.elections where id = v_eid;
  if v_status = 'closed' and not (v_is_demo and coalesce(current_setting('sge.demo_reset', true), '') = 'on') then
    raise exception 'LOCKED' using detail = 'This election is closed. The voter register is locked.';
  end if;
  if tg_op = 'UPDATE' and old.used_at is not null and new.used_at is distinct from old.used_at
     and not (v_is_demo and coalesce(current_setting('sge.demo_reset', true), '') = 'on') then
    raise exception 'LOCKED' using detail = 'A recorded vote cannot be undone.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists voters_guard on public.voters;
create trigger voters_guard before insert or update or delete on public.voters for each row execute function private.guard_voters();

-- Ballots, selections and final results are append-only (except the demo reset).
create or replace function private.guard_append_only() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_eid uuid;
begin
  if tg_table_name = 'ballot_selections' then
    select b.election_id into v_eid from public.ballots b where b.id = old.ballot_id;
  else
    v_eid := old.election_id;
  end if;
  if coalesce(current_setting('sge.demo_reset', true), '') = 'on'
     and coalesce((select is_demo from public.elections where id = v_eid), false) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'LOCKED' using detail = 'Recorded ballots and results can never be changed or deleted.';
end $$;

drop trigger if exists ballots_append_only on public.ballots;
create trigger ballots_append_only before update or delete on public.ballots for each row execute function private.guard_append_only();
drop trigger if exists selections_append_only on public.ballot_selections;
create trigger selections_append_only before update or delete on public.ballot_selections for each row execute function private.guard_append_only();
drop trigger if exists final_results_append_only on public.final_results;
create trigger final_results_append_only before update or delete on public.final_results for each row execute function private.guard_append_only();

create or replace function private.block_change() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'LOCKED' using detail = 'The audit log cannot be changed.'; end $$;
drop trigger if exists audit_logs_immutable on public.audit_logs;
create trigger audit_logs_immutable before update or delete on public.audit_logs for each row execute function private.block_change();

-- -------------------------------------------------------------------------------------
--  Triggers: audit trail + live pulse
-- -------------------------------------------------------------------------------------
create or replace function private.after_election_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.election_pulse (election_id, status) values (new.id, new.status) on conflict (election_id) do nothing;
    perform private.audit(new.id, 'election.created', jsonb_build_object('name', new.name, 'demo', new.is_demo));
  else
    update public.election_pulse set status = new.status, config_version = config_version + 1, updated_at = now()
     where election_id = new.id;
    if new.status = old.status and coalesce(current_setting('sge.demo_reset', true), '') <> 'on' then
      perform private.audit(new.id, case when new.archived_at is not null and old.archived_at is null then 'election.archived' else 'election.updated' end, '{}'::jsonb);
    end if;
  end if;
  return null;
end $$;

drop trigger if exists elections_after on public.elections;
create trigger elections_after after insert or update on public.elections for each row execute function private.after_election_change();

create or replace function private.after_structure_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_eid uuid := case when tg_op = 'DELETE' then old.election_id else new.election_id end;
  v_name text := case when tg_op = 'DELETE' then old.name else new.name end;
  v_kind text := case when tg_table_name = 'positions' then 'position' else 'candidate' end;
begin
  update public.election_pulse set config_version = config_version + 1, updated_at = now() where election_id = v_eid;
  if tg_op = 'UPDATE' and new.display_order <> old.display_order
     and (to_jsonb(new) - 'display_order') = (to_jsonb(old) - 'display_order') then
    return null;  -- pure reorder: no audit noise
  end if;
  perform private.audit(v_eid, v_kind || '.' || case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'edited' else 'removed' end,
                        jsonb_build_object('name', v_name));
  return null;
end $$;

drop trigger if exists positions_after on public.positions;
create trigger positions_after after insert or update or delete on public.positions for each row execute function private.after_structure_change();
drop trigger if exists candidates_after on public.candidates;
create trigger candidates_after after insert or update or delete on public.candidates for each row execute function private.after_structure_change();

create or replace function private.after_school_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.audit(null, 'school.updated', jsonb_build_object('name', new.name));
  update public.election_pulse set config_version = config_version + 1, updated_at = now();
  return null;
end $$;
drop trigger if exists schools_after on public.schools;
create trigger schools_after after insert or update on public.schools for each row execute function private.after_school_change();

-- =====================================================================================
--  PUBLIC API — voting stations and results screens (anon key)
-- =====================================================================================
create or replace function public.get_public_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'school', (select to_jsonb(s) - 'singleton' from public.schools s limit 1),
    'live',   (select to_jsonb(e) from public.elections e where e.archived_at is null and not e.is_demo),
    'demo',   (select to_jsonb(e) from public.elections e where e.archived_at is null and e.is_demo),
    'pulse', jsonb_build_object(
      'live', (select to_jsonb(p) from public.election_pulse p join public.elections e on e.id = p.election_id where e.archived_at is null and not e.is_demo),
      'demo', (select to_jsonb(p) from public.election_pulse p join public.elections e on e.id = p.election_id where e.archived_at is null and e.is_demo)))
$$;

/* Step 1 for a student: validate the code and open a 30-minute voting session.
   Errors are RETURNED (not raised) so the failed-attempt counter is committed. */
create or replace function public.begin_voting(p_election_id uuid, p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.elections;
  v public.voters;
  v_state text;
  v_code text;
  v_token text;
  v_expires timestamptz;
  v_client text;
  v_bucket timestamptz := date_trunc('minute', now());
begin
  v_client := encode(extensions.digest(coalesce(
      nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip',
      split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1),
      'unknown'), 'sha256'), 'hex');
  if (select coalesce(sum(failures), 0) from private.code_attempts
      where client_hash = v_client and bucket > now() - interval '10 minutes') >= 150 then
    return jsonb_build_object('error', 'RATE_LIMITED');
  end if;

  select * into e from public.elections where id = p_election_id and archived_at is null;
  if not found then return jsonb_build_object('error', 'NOT_OPEN'); end if;
  v_state := public.voting_state(e);
  if v_state <> 'open' then return jsonb_build_object('error', private.state_error(v_state)); end if;

  v_code := private.normalize_code(p_code);
  if v_code is not null then
    select * into v from public.voters where election_id = e.id and voting_code_hash = private.code_hash(v_code);
  end if;
  if v_code is null or v.id is null or not v.active then
    insert into private.code_attempts as ca (client_hash, bucket, failures) values (v_client, v_bucket, 1)
      on conflict (client_hash, bucket) do update set failures = ca.failures + 1;
    delete from private.code_attempts where bucket < now() - interval '1 day';
    return jsonb_build_object('error', 'INVALID_CODE');
  end if;
  if v.used_at is not null then return jsonb_build_object('error', 'CODE_USED'); end if;

  delete from private.voting_sessions where voter_id = v.id or expires_at < now();
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_expires := now() + interval '30 minutes';
  insert into private.voting_sessions (token_hash, voter_id, election_id, expires_at)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v.id, e.id, v_expires);
  return jsonb_build_object('token', v_token, 'expires_at', v_expires, 'positions', private.ballot_json(e.id));
end $$;

/* Step 2: record the ballot.  Everything below happens in ONE transaction — if any check or
   insert fails, nothing is written and the voting code stays unused. */
create or replace function public.submit_ballot(p_token text, p_selections jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s private.voting_sessions;
  e public.elections;
  v public.voters;
  v_state text;
  p public.positions;
  v_key text;
  v_ids text[];
  v_ballot uuid;
begin
  select * into s from private.voting_sessions
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') for update;
  if not found or s.expires_at < now() then raise exception 'SESSION_EXPIRED'; end if;

  -- Lock the voter: a second submission with the same code waits here, then sees used_at.
  select * into v from public.voters where id = s.voter_id for update;
  if not found or not v.active then raise exception 'INVALID_CODE'; end if;
  if v.used_at is not null then raise exception 'CODE_USED'; end if;

  -- Share-lock the election so it cannot close half-way through this ballot.
  select * into e from public.elections where id = s.election_id for share;
  v_state := public.voting_state(e);
  if v_state <> 'open' then raise exception '%', private.state_error(v_state); end if;

  -- Validate the ballot against the rules stored in the database (never trust the browser).
  if p_selections is null or jsonb_typeof(p_selections) <> 'object' then
    raise exception 'BALLOT_INVALID' using detail = 'The ballot was empty or malformed.';
  end if;
  for v_key in select jsonb_object_keys(p_selections) loop
    if jsonb_typeof(p_selections -> v_key) <> 'array'
       or not exists (select 1 from private.ballot_positions(e.id) bp where bp.id::text = v_key) then
      raise exception 'BALLOT_INVALID' using detail = 'The ballot contained a position that is not part of this election.';
    end if;
  end loop;
  for p in select * from private.ballot_positions(e.id) loop
    select coalesce(array_agg(t.x), '{}') into v_ids
      from jsonb_array_elements_text(coalesce(p_selections -> p.id::text, '[]'::jsonb)) as t(x);
    if cardinality(v_ids) <> (select count(distinct u.x) from unnest(v_ids) as u(x)) then
      raise exception 'BALLOT_INVALID' using detail = format('Duplicate selection for %s.', p.name);
    end if;
    if cardinality(v_ids) < p.min_selections then
      raise exception 'BALLOT_INVALID' using detail = format('Please make a selection for %s.', p.name);
    end if;
    if cardinality(v_ids) > p.max_selections then
      raise exception 'BALLOT_INVALID' using detail = format('Too many selections for %s.', p.name);
    end if;
    if exists (select 1 from unnest(v_ids) as u(x) where not exists (
        select 1 from public.candidates c where c.id::text = u.x and c.position_id = p.id and c.active)) then
      raise exception 'BALLOT_INVALID' using detail = format('A selected candidate for %s is not available.', p.name);
    end if;
  end loop;

  -- Record the anonymous ballot and its selections.
  insert into public.ballots (election_id) values (e.id) returning id into v_ballot;
  insert into public.ballot_selections (ballot_id, position_id, candidate_id)
  select v_ballot, c.position_id, c.id
    from private.ballot_positions(e.id) bp
    cross join lateral jsonb_array_elements_text(coalesce(p_selections -> bp.id::text, '[]'::jsonb)) as t(x)
    join public.candidates c on c.id::text = t.x and c.position_id = bp.id;

  -- Mark the code used (conditional update = belt and braces against double voting).
  update public.voters set used_at = now() where id = v.id and used_at is null;
  if not found then raise exception 'CODE_USED'; end if;
  delete from private.voting_sessions where voter_id = v.id;

  update public.election_pulse
     set votes_cast = votes_cast + 1, last_vote_at = now(), updated_at = now()
   where election_id = e.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.station_heartbeat(p_election_id uuid, p_station_id text, p_label text default '') returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_station_id !~ '^[A-Za-z0-9-]{6,40}$' or not exists (select 1 from public.elections where id = p_election_id and archived_at is null) then
    return;
  end if;
  insert into public.voting_stations (id, election_id, label, last_seen_at)
  values (p_station_id, p_election_id, left(coalesce(p_label, ''), 40), now())
  on conflict (id, election_id) do update set last_seen_at = now(), label = excluded.label;
end $$;

/* Aggregate results only — never individual ballots.  Visibility rules:
   live → everyone, during and after voting · after_close → everyone once closed · hidden → admins only. */
create or replace function public.get_results(p_election_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.elections;
  f public.final_results;
  v_priv boolean := public.has_cap('results.view');
  v_visible boolean;
  v_final boolean;
begin
  select * into e from public.elections where id = p_election_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into f from public.final_results where election_id = e.id;
  v_final := e.status = 'closed' and f.election_id is not null;
  v_visible := v_priv or e.results_visibility = 'live' or (e.results_visibility = 'after_close' and e.status = 'closed');
  return jsonb_build_object(
    'election', to_jsonb(e),
    'school', (select to_jsonb(s) - 'singleton' from public.schools s limit 1),
    'final', v_final,
    'computed_at', case when v_final then f.computed_at else now() end,
    'sealed', not v_visible,
    'privileged', v_priv,
    'stats', case when v_final then f.stats else private.election_stats(e.id) end,
    'positions', case when not v_visible then '[]'::jsonb
                      when v_final then f.positions
                      else private.compute_results(e.id, false) end);
end $$;

-- =====================================================================================
--  ADMIN API (authenticated + role checked inside every function)
-- =====================================================================================
create or replace function public.my_admin() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', user_id, 'email', email, 'role', role) from public.admin_users where user_id = auth.uid()
$$;

create or replace function public.get_admin_bundle(p_election_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.elections;
begin
  perform private.require_cap('admin');
  select * into e from public.elections where id = p_election_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object(
    'election', to_jsonb(e),
    'positions', (select coalesce(jsonb_agg(to_jsonb(p) order by p.display_order, p.name), '[]'::jsonb) from public.positions p where p.election_id = e.id),
    'candidates', (select coalesce(jsonb_agg(to_jsonb(c) order by c.display_order, c.name), '[]'::jsonb) from public.candidates c where c.election_id = e.id),
    'voters', (select jsonb_build_object('total', count(*), 'active', count(*) filter (where active),
                 'voted', count(*) filter (where used_at is not null),
                 'eligible', count(*) filter (where active or used_at is not null))
               from public.voters where election_id = e.id),
    'ballots_cast', (select count(*) from public.ballots where election_id = e.id),
    'locked', private.structure_locked(e.id));
end $$;

create or replace function public.set_election_status(p_election_id uuid, p_status text, p_confirm text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.elections;
  v_from text;
  v_issues text;
  v_allowed text[];
begin
  perform private.require_cap('election.status');
  select * into e from public.elections where id = p_election_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_from := e.status;
  v_allowed := case e.status
    when 'draft' then array['scheduled', 'open']
    when 'scheduled' then array['draft', 'open', 'paused', 'closed']
    when 'open' then array['paused', 'closed']
    when 'paused' then array['open', 'closed']
    else array[]::text[] end;
  if not (p_status = any (v_allowed)) then
    raise exception 'VALIDATION' using detail = format('An election cannot move from %s to %s.', v_from, p_status);
  end if;
  if p_status = 'closed' and coalesce(upper(btrim(p_confirm)), '') <> 'CLOSE ELECTION' then
    raise exception 'VALIDATION' using detail = 'Type CLOSE ELECTION to confirm.';
  end if;
  if p_status in ('open', 'scheduled') then
    v_issues := private.readiness_issues(e.id);
    if v_issues is not null then
      raise exception 'NOT_READY' using detail = 'The election is not ready yet. It still needs: ' || v_issues || '.';
    end if;
    if p_status = 'scheduled' and e.starts_at is null then
      raise exception 'VALIDATION' using detail = 'Set a start date and time before scheduling.';
    end if;
  end if;

  perform set_config('sge.status_change', 'on', true);
  update public.elections
     set status = p_status,
         opened_at = case when p_status = 'open' and opened_at is null then now() else opened_at end,
         closed_at = case when p_status = 'closed' then now() else closed_at end
   where id = e.id
   returning * into e;
  perform set_config('sge.status_change', 'off', true);

  if p_status = 'closed' then
    delete from private.voting_sessions where election_id = e.id;
    -- Freeze the official result.  It can never be changed afterwards.
    insert into public.final_results (election_id, positions, stats, computed_at)
    values (e.id, private.compute_results(e.id, true), private.election_stats(e.id), now());
  end if;
  perform private.audit(e.id, 'election.' || case p_status when 'open' then 'opened' when 'paused' then 'paused'
            when 'closed' then 'closed' when 'scheduled' then 'scheduled' else 'returned_to_draft' end,
            jsonb_build_object('from', v_from, 'to', p_status));
  return to_jsonb(e);
end $$;

create or replace function public.archive_election(p_election_id uuid, p_confirm text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare e public.elections;
begin
  perform private.require_cap('election.status');
  if coalesce(upper(btrim(p_confirm)), '') <> 'ARCHIVE ELECTION' then
    raise exception 'VALIDATION' using detail = 'Type ARCHIVE ELECTION to confirm.';
  end if;
  update public.elections set archived_at = now() where id = p_election_id and status = 'closed' and archived_at is null returning * into e;
  if not found then raise exception 'VALIDATION' using detail = 'Only a closed election can be archived.'; end if;
  return to_jsonb(e);
end $$;

create or replace function public.reorder_positions(p_election_id uuid, p_ids uuid[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_cap('positions.edit');
  update public.positions p set display_order = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
   where p.id = o.id and p.election_id = p_election_id and p.display_order <> o.ord;
end $$;

create or replace function public.reorder_candidates(p_position_id uuid, p_ids uuid[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_cap('candidates.edit');
  update public.candidates c set display_order = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
   where c.id = o.id and c.position_id = p_position_id and c.display_order <> o.ord;
end $$;

/* Creates voters and their codes.  The plain codes are returned ONCE, to the administrator,
   and only their HMAC fingerprints are stored. */
create or replace function public.import_voters(p_election_id uuid, p_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.elections;
  r jsonb;
  v_ref text; v_cls text; v_code text; v_hash text; v_tries int;
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  perform private.require_cap('voters.manage');
  perform pg_advisory_xact_lock(hashtext('sge-voters-' || p_election_id::text));
  select * into e from public.elections where id = p_election_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if e.status = 'closed' then raise exception 'LOCKED' using detail = 'This election is closed.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'VALIDATION' using detail = 'Import at most 5,000 voters at a time.';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_ref := btrim(coalesce(r ->> 'student_reference', ''));
    v_cls := btrim(coalesce(r ->> 'class_name', ''));
    if v_ref = '' then
      v_skipped := v_skipped || jsonb_build_object('student_reference', '(blank)', 'reason', 'Missing student reference'); continue;
    end if;
    if char_length(v_ref) > 64 or char_length(v_cls) > 40 then
      v_skipped := v_skipped || jsonb_build_object('student_reference', left(v_ref, 64), 'reason', 'Too long'); continue;
    end if;
    if exists (select 1 from public.voters where election_id = e.id and lower(btrim(student_reference)) = lower(v_ref)) then
      v_skipped := v_skipped || jsonb_build_object('student_reference', v_ref, 'reason', 'Already registered'); continue;
    end if;
    v_tries := 0;
    loop
      v_code := private.new_code();
      v_hash := private.code_hash(v_code);
      exit when not exists (select 1 from public.voters where election_id = e.id and voting_code_hash = v_hash);
      v_tries := v_tries + 1;
      if v_tries > 20 then raise exception 'CONFLICT' using detail = 'Could not generate a unique code.'; end if;
    end loop;
    insert into public.voters (election_id, student_reference, class_name, voting_code_hash) values (e.id, v_ref, v_cls, v_hash);
    v_created := v_created || jsonb_build_object('student_reference', v_ref, 'class_name', v_cls, 'code', v_code);
  end loop;
  perform private.refresh_pulse(e.id);
  perform private.audit(e.id, 'voters.imported', jsonb_build_object('created', jsonb_array_length(v_created), 'skipped', jsonb_array_length(v_skipped)));
  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end $$;

/* Issues NEW codes for voters who have not voted; their old codes stop working immediately. */
create or replace function public.regenerate_codes(p_election_id uuid, p_voter_ids uuid[] default null,
  p_class_name text default null, p_all_unused boolean default false, p_limit int default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.elections;
  v record;
  v_code text; v_hash text; v_tries int;
  v_out jsonb := '[]'::jsonb;
begin
  perform private.require_cap('voters.manage');
  perform pg_advisory_xact_lock(hashtext('sge-voters-' || p_election_id::text));
  select * into e from public.elections where id = p_election_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if e.status = 'closed' then raise exception 'LOCKED' using detail = 'This election is closed.'; end if;
  if p_voter_ids is null and p_class_name is null and not coalesce(p_all_unused, false) then return v_out; end if;
  for v in
    select id, student_reference, class_name from public.voters
     where election_id = e.id and used_at is null and active
       and (p_voter_ids is null or id = any (p_voter_ids))
       and (p_class_name is null or class_name = p_class_name)
     order by class_name, student_reference
     limit coalesce(p_limit, 100000)
     for update
  loop
    v_tries := 0;
    loop
      v_code := private.new_code();
      v_hash := private.code_hash(v_code);
      exit when not exists (select 1 from public.voters where election_id = e.id and voting_code_hash = v_hash);
      v_tries := v_tries + 1;
      if v_tries > 20 then raise exception 'CONFLICT' using detail = 'Could not generate a unique code.'; end if;
    end loop;
    update public.voters set voting_code_hash = v_hash where id = v.id;
    delete from private.voting_sessions where voter_id = v.id;
    v_out := v_out || jsonb_build_object('student_reference', v.student_reference, 'class_name', v.class_name, 'code', v_code);
  end loop;
  perform private.audit(e.id, 'codes.regenerated', jsonb_build_object('count', jsonb_array_length(v_out)));
  return v_out;
end $$;

create or replace function public.set_voter_active(p_voter_id uuid, p_active boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.voters;
begin
  perform private.require_cap('voters.manage');
  select * into v from public.voters where id = p_voter_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v.used_at is not null then raise exception 'VALIDATION' using detail = 'This voter has already voted; their status can no longer change.'; end if;
  update public.voters set active = p_active where id = v.id;
  if not p_active then delete from private.voting_sessions where voter_id = v.id; end if;
  perform private.refresh_pulse(v.election_id);
  perform private.audit(v.election_id, case when p_active then 'voter.activated' else 'voter.deactivated' end, jsonb_build_object('ref', v.student_reference));
end $$;

create or replace function public.remove_voter(p_voter_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.voters;
begin
  perform private.require_cap('voters.manage');
  select * into v from public.voters where id = p_voter_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v.used_at is not null then raise exception 'VALIDATION' using detail = 'This voter has already voted and cannot be removed.'; end if;
  delete from public.voters where id = v.id;
  perform private.refresh_pulse(v.election_id);
  perform private.audit(v.election_id, 'voter.removed', jsonb_build_object('ref', v.student_reference));
end $$;

create or replace function public.get_monitor(p_election_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.elections;
begin
  perform private.require_cap('monitor.view');
  select * into e from public.elections where id = p_election_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  return private.election_stats(e.id) || jsonb_build_object(
    'election', to_jsonb(e),
    'votes_today', (select count(*) from public.ballots where election_id = e.id and submitted_at >= date_trunc('day', now())),
    'by_hour', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'votes', n) order by h), '[]'::jsonb)
                from (select submitted_at as h, count(*) as n from public.ballots where election_id = e.id group by 1) x),
    'by_class', (select coalesce(jsonb_agg(jsonb_build_object('class_name', c, 'eligible', el, 'voted', vt) order by c), '[]'::jsonb)
                 from (select coalesce(nullif(class_name, ''), '—') as c,
                              count(*) filter (where active or used_at is not null) as el,
                              count(*) filter (where used_at is not null) as vt
                       from public.voters where election_id = e.id group by 1) x),
    'stations', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'last_seen_at', last_seen_at) order by last_seen_at desc), '[]'::jsonb)
                 from public.voting_stations where election_id = e.id and last_seen_at > now() - interval '1 day'),
    'active_stations', (select count(*) from public.voting_stations where election_id = e.id and last_seen_at > now() - interval '90 seconds'));
end $$;

create or replace function public.log_action(p_election_id uuid, p_action text, p_metadata jsonb default '{}'::jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_cap('admin');
  if p_action not in ('results.viewed', 'export.generated', 'report.printed', 'codes.printed', 'codes.downloaded', 'admin.signed_in', 'demo.simulated') then
    raise exception 'VALIDATION' using detail = 'Unknown audit action.';
  end if;
  perform private.audit(p_election_id, p_action, p_metadata);
end $$;

create or replace function public.list_admins() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_cap('admins.manage');
  return (select coalesce(jsonb_agg(jsonb_build_object('id', user_id, 'email', email, 'role', role, 'created_at', created_at) order by created_at), '[]'::jsonb)
          from public.admin_users);
end $$;

/* Grants (or changes) a role.  The person must already have a Supabase Auth account
   (Authentication → Users → Add user / Invite). */
create or replace function public.grant_admin(p_email text, p_role text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_user uuid; v_email text := lower(btrim(p_email));
begin
  perform private.require_cap('admins.manage');
  if p_role not in ('super_admin', 'election_admin', 'results_viewer') then raise exception 'VALIDATION' using detail = 'Choose a role.'; end if;
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is null then
    raise exception 'NOT_FOUND' using detail = 'No account with that email exists yet. Create it in Supabase → Authentication → Users first.';
  end if;
  if v_user = auth.uid() and p_role <> 'super_admin' then raise exception 'VALIDATION' using detail = 'You cannot lower your own role.'; end if;
  insert into public.admin_users (user_id, email, role, created_by) values (v_user, v_email, p_role, auth.uid())
  on conflict (user_id) do update set role = excluded.role, email = excluded.email;
  perform private.audit(null, 'admin.role_granted', jsonb_build_object('email', v_email, 'role', p_role));
end $$;

create or replace function public.revoke_admin(p_user_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_email text;
begin
  perform private.require_cap('admins.manage');
  if p_user_id = auth.uid() then raise exception 'VALIDATION' using detail = 'You cannot remove your own access.'; end if;
  delete from public.admin_users where user_id = p_user_id returning email into v_email;
  if v_email is null then raise exception 'NOT_FOUND' using detail = 'Administrator not found.'; end if;
  perform private.audit(null, 'admin.revoked', jsonb_build_object('email', v_email));
end $$;

/* Clears ballots from the DEMO election only.  Real elections can never be reset. */
create or replace function public.reset_demo(p_election_id uuid, p_confirm text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare e public.elections;
begin
  perform private.require_cap('demo.manage');
  select * into e from public.elections where id = p_election_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not e.is_demo then raise exception 'FORBIDDEN' using detail = 'Only the demo election can be reset. Real elections can never be reset.'; end if;
  if coalesce(upper(btrim(p_confirm)), '') <> 'RESET DEMO' then raise exception 'VALIDATION' using detail = 'Type RESET DEMO to confirm.'; end if;
  perform set_config('sge.demo_reset', 'on', true);
  delete from public.final_results where election_id = e.id;
  delete from public.ballot_selections where ballot_id in (select id from public.ballots where election_id = e.id);
  delete from public.ballots where election_id = e.id;
  update public.voters set used_at = null where election_id = e.id and used_at is not null;
  delete from private.voting_sessions where election_id = e.id;
  update public.elections set status = 'open', opened_at = now(), closed_at = null where id = e.id returning * into e;
  update public.election_pulse set votes_cast = 0, last_vote_at = null where election_id = e.id;
  perform set_config('sge.demo_reset', 'off', true);
  perform private.refresh_pulse(e.id);
  perform private.audit(e.id, 'demo.reset', '{}'::jsonb);
  return to_jsonb(e);
end $$;

-- =====================================================================================
--  Row Level Security
-- =====================================================================================
alter table public.schools           enable row level security;
alter table public.elections         enable row level security;
alter table public.positions         enable row level security;
alter table public.candidates        enable row level security;
alter table public.voters            enable row level security;
alter table public.ballots           enable row level security;
alter table public.ballot_selections enable row level security;
alter table public.final_results     enable row level security;
alter table public.audit_logs        enable row level security;
alter table public.admin_users       enable row level security;
alter table public.voting_stations   enable row level security;
alter table public.election_pulse    enable row level security;
alter table private.settings         enable row level security;
alter table private.voting_sessions  enable row level security;
alter table private.code_attempts    enable row level security;

drop policy if exists "schools: public read" on public.schools;
create policy "schools: public read" on public.schools for select to anon, authenticated using (true);
drop policy if exists "schools: super admin insert" on public.schools;
create policy "schools: super admin insert" on public.schools for insert to authenticated with check (public.has_cap('school.edit'));
drop policy if exists "schools: super admin update" on public.schools;
create policy "schools: super admin update" on public.schools for update to authenticated
  using (public.has_cap('school.edit')) with check (public.has_cap('school.edit'));

drop policy if exists "elections: public read current" on public.elections;
create policy "elections: public read current" on public.elections for select to anon, authenticated
  using (archived_at is null or public.has_cap('admin'));
drop policy if exists "elections: super admin insert" on public.elections;
create policy "elections: super admin insert" on public.elections for insert to authenticated
  with check (public.has_cap('election.edit') and status = 'draft');
drop policy if exists "elections: super admin update" on public.elections;
create policy "elections: super admin update" on public.elections for update to authenticated
  using (public.has_cap('election.edit')) with check (public.has_cap('election.edit'));

drop policy if exists "positions: admin read" on public.positions;
create policy "positions: admin read" on public.positions for select to authenticated using (public.has_cap('admin'));
drop policy if exists "positions: super admin write" on public.positions;
drop policy if exists "positions: super admin insert" on public.positions;
drop policy if exists "positions: super admin update" on public.positions;
drop policy if exists "positions: super admin delete" on public.positions;
create policy "positions: super admin insert" on public.positions for insert to authenticated with check ((select public.has_cap('positions.edit')));
create policy "positions: super admin update" on public.positions for update to authenticated
  using ((select public.has_cap('positions.edit'))) with check ((select public.has_cap('positions.edit')));
create policy "positions: super admin delete" on public.positions for delete to authenticated using ((select public.has_cap('positions.edit')));

drop policy if exists "candidates: admin read" on public.candidates;
create policy "candidates: admin read" on public.candidates for select to authenticated using (public.has_cap('admin'));
drop policy if exists "candidates: editors write" on public.candidates;
drop policy if exists "candidates: editors insert" on public.candidates;
drop policy if exists "candidates: editors update" on public.candidates;
drop policy if exists "candidates: editors delete" on public.candidates;
create policy "candidates: editors insert" on public.candidates for insert to authenticated with check ((select public.has_cap('candidates.edit')));
create policy "candidates: editors update" on public.candidates for update to authenticated
  using ((select public.has_cap('candidates.edit'))) with check ((select public.has_cap('candidates.edit')));
create policy "candidates: editors delete" on public.candidates for delete to authenticated using ((select public.has_cap('candidates.edit')));

drop policy if exists "voters: managers read" on public.voters;
create policy "voters: managers read" on public.voters for select to authenticated using (public.has_cap('voters.manage'));

drop policy if exists "audit: read" on public.audit_logs;
create policy "audit: read" on public.audit_logs for select to authenticated using (public.has_cap('audit.view'));

drop policy if exists "admin_users: self or super admin" on public.admin_users;
create policy "admin_users: self or super admin" on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_cap('admins.manage')));

drop policy if exists "pulse: public read" on public.election_pulse;
create policy "pulse: public read" on public.election_pulse for select to anon, authenticated using (true);
-- ballots, ballot_selections, final_results, voting_stations and everything in `private`
-- intentionally have NO policies: no browser can read or write them directly.

-- -------------------------------------------------------------------------------------
--  Table privileges (defence in depth on top of RLS)
-- -------------------------------------------------------------------------------------
revoke all on all tables in schema private from anon, authenticated;
revoke all on public.schools, public.elections, public.positions, public.candidates, public.voters,
              public.ballots, public.ballot_selections, public.final_results, public.audit_logs,
              public.admin_users, public.voting_stations, public.election_pulse from anon, authenticated;
grant select on public.schools, public.elections, public.election_pulse to anon, authenticated;
grant insert, update on public.schools to authenticated;
grant insert, update (name, subtitle, academic_year, description, instructions, confirmation_message,
                      results_visibility, rotation_seconds, starts_at, ends_at, school_id, is_demo) on public.elections to authenticated;
grant select, insert, update, delete on public.positions, public.candidates to authenticated;
grant select (id, election_id, student_reference, class_name, active, has_voted, created_at) on public.voters to authenticated;
grant select on public.audit_logs, public.admin_users to authenticated;

-- -------------------------------------------------------------------------------------
--  Function privileges
-- -------------------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.has_cap(text), public.admin_role(), public.voting_state(public.elections),
  public.get_public_state(), public.begin_voting(uuid, text), public.submit_ballot(text, jsonb),
  public.station_heartbeat(uuid, text, text), public.get_results(uuid)
  to anon, authenticated;
grant execute on function public.my_admin(), public.get_admin_bundle(uuid), public.set_election_status(uuid, text, text),
  public.archive_election(uuid, text), public.reorder_positions(uuid, uuid[]), public.reorder_candidates(uuid, uuid[]),
  public.import_voters(uuid, jsonb), public.regenerate_codes(uuid, uuid[], text, boolean, int),
  public.set_voter_active(uuid, boolean), public.remove_voter(uuid), public.get_monitor(uuid),
  public.log_action(uuid, text, jsonb), public.list_admins(), public.grant_admin(text, text),
  public.revoke_admin(uuid), public.reset_demo(uuid, text)
  to authenticated;

-- -------------------------------------------------------------------------------------
--  Realtime + storage (Supabase-specific; skipped automatically elsewhere)
-- -------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.election_pulse;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('election-media', 'election-media', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
    on conflict (id) do update set public = true, file_size_limit = 2097152,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

    drop policy if exists "election media: editors upload" on storage.objects;
    create policy "election media: editors upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'election-media' and public.has_cap('candidates.edit'));
    drop policy if exists "election media: editors update" on storage.objects;
    create policy "election media: editors update" on storage.objects for update to authenticated
      using (bucket_id = 'election-media' and public.has_cap('candidates.edit'));
    drop policy if exists "election media: editors delete" on storage.objects;
    create policy "election media: editors delete" on storage.objects for delete to authenticated
      using (bucket_id = 'election-media' and public.has_cap('candidates.edit'));
  end if;
end $$;

-- =====================================================================================
--  FIRST ADMINISTRATOR
--  1. Supabase → Authentication → Users → "Add user" (email + password, auto-confirm).
--  2. Run (with your email):
--
--     insert into public.admin_users (user_id, email, role)
--     select id, lower(email), 'super_admin' from auth.users where lower(email) = lower('you@school.org');
--
--  After that, add other administrators from the app: Settings → Administrators.
-- =====================================================================================
