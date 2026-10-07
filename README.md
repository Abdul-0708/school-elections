# Student Government Election System

A complete school election platform: **admin dashboard**, **student voting stations**, and a **live projector results screen**. Plain HTML/CSS/JS (no build step) with two interchangeable backends:

| Mode | When | Where data lives |
|---|---|---|
| **Local demo engine** (default) | Trying the system, training | This one browser (localStorage). Not secure, single computer. |
| **Supabase** | The real election | Postgres + Row Level Security + Realtime. Many stations, live results. |

## Quick start (local demo)
```bash
node tools/serve.js 5173
```
Open `http://localhost:5173` → **Administrator** → create the first admin → the 8-step setup wizard runs. Settings → **Demo mode** creates a practice election with sample candidates and 60 demo codes.

Routes: `#/` home · `#/vote` station · `#/results` projector · `#/admin` admin · add `/demo` to vote/results for the demo election.

## Going live with Supabase (~15 min)
1. Create a Supabase project (use a project dedicated to the election).
2. SQL Editor → paste and run **`supabase/schema.sql`** (safe to re-run). It creates tables, RLS, secure functions, the Realtime publication and the `election-media` storage bucket.
3. Authentication → Providers: **disable public sign-ups**. Authentication → Users → **Add user** (your email + password, auto-confirm).
4. Make yourself Super Admin (SQL Editor):
   ```sql
   insert into public.admin_users (user_id, email, role)
   select id, lower(email), 'super_admin' from auth.users where lower(email) = lower('you@school.org');
   ```
5. In **`config.js`** set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (the anon/publishable key — **never** the service_role key; the app refuses to start if it sees one).
6. Host the folder on any static host (school web server, Netlify, GitHub Pages…). If you use a custom Supabase domain, add it to `connect-src` in the CSP in `index.html`.
7. Rehearse in demo mode, then run the concurrency check (below).

Other admins: create them in Supabase → Users, then grant a role in the app (Settings → Administrators).

## Election day
- **Stations:** open `…/#/vote` on each lab PC. Kiosk: `chrome.exe --kiosk --incognito https://your-site/#/vote`. Stations reset automatically after each vote, time out idle ballots, and sign out any admin session. Never sign in as admin on a station.
- **Projector:** open `…/#/results`, press **F** (full screen). Keys: **O** overview · **P** position · **R** rotate · **W** winners (after closing) · ←/→ change position.
- **Lost code:** Voters → find the student → **New code** (the old code stops working).
- **Close:** Dashboard → Close election → type `CLOSE ELECTION`. Results lock; the projector switches to the winner display. Ties are shown as **TIE** — no winner is picked automatically.
- **After:** Reports → print official results, export CSVs, then archive.

## Security model (summary)
- Students only call two database functions: `begin_voting` (checks code, opens a 30-min session) and `submit_ballot` (validates every rule and records the ballot + marks the code used **in one transaction**; any failure writes nothing). The voter row is locked, so simultaneous submissions of one code yield exactly one vote.
- Codes: 8 chars from a 31-symbol alphabet (no I/L/O/0/1), stored only as HMAC-SHA256 with a secret pepper → **shown once** at generation. Failed guesses are throttled per client.
- Ballots have **no voter column**; ballot times are truncated to the hour. Ballots, final results and audit logs are append-only (only the separate demo election can be reset). Closed elections are immutable.
- RLS on every table; browsers can never read ballots, code hashes or sessions. Results reach browsers only as aggregates.
- Roles: **Super Admin** (everything) · **Election Admin** (candidates, voters, codes, monitor, results) · **Results Viewer** (read-only). Enforced in the database, mirrored in the UI.
- Limits to know: the local demo engine is *not* secure; anyone with database-owner access could still study raw tables; supabase-js loads from jsDelivr by default (download it to `vendor/` and change `SUPABASE_JS_URL` to self-host).

## Testing
```bash
cd tests && npm install && npm test        # 107 database checks + 58 adapter checks (PGlite, no Supabase needed)
node tools/load-test.mjs 20                 # against YOUR Supabase demo election: parallel + duplicate submissions
```
`load-test.mjs` needs env vars `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`; reset the demo afterwards.

## Files
```
index.html, config.js          entry page + settings
css/app.css                    design system and all screens
js/core/                       util, rules (validation/ranking), ui components, brand, demo, print
js/backend/local.js            in-browser demo engine
js/backend/supabase.js         Supabase adapter (same API)
js/views/                      landing, station, results, admin*, wizard
supabase/schema.sql            database, RLS, functions, realtime, storage
tests/, tools/                 test suites, local server, load test
samples/voters-sample.csv      CSV import example (student_reference,class_name)
```

## QA checklist
✔ = verified automatically or in the browser during development. ☐ = do this on your own Supabase project before election day.

**Voting**
- ✔ Valid code (any case, spaces/dashes ignored) · ✔ invalid / malformed code · ✔ used code · ✔ inactive voter · ✔ regenerated code (old one stops working)
- ✔ Not open yet / scheduled auto-open · ✔ paused · ✔ closed · ✔ end time passed
- ✔ Incomplete ballot blocked with a list of positions · ✔ single choice auto-deselects · ✔ multi-choice maximum enforced · ✔ optional positions
- ✔ Review → armed confirmation → success only after the server confirms · ✔ failure screen when voting is paused mid-ballot (code stays unused)
- ✔ Idle ballot warning + auto-reset · ✔ cannot navigate away mid-ballot · ✔ station signs out any admin session

**Security** (`tests/sql.test.mjs`, `tests/adapter.test.mjs`)
- ✔ Duplicate submission (same session, same code, second session) · ✔ forged tokens · ✔ unknown positions/candidates, duplicates, garbage IDs
- ✔ Browsers cannot read ballots, selections, code hashes or sessions; anon cannot call admin functions
- ✔ Role checks for Election Admin / Results Viewer · ✔ structure frozen after first vote · ✔ closed election locked · ✔ ballots/results/audit append-only · ✔ demo reset cannot touch the live election · ✔ code guessing throttled
- ✔ Parallel load on the live Supabase project (7 Oct 2026): 20 ballots × 2 simultaneous submissions → 20 accepted, 20 duplicates rejected, counts consistent. Re-run any time with `node tools/load-test.mjs 20`.

**Results**
- ✔ Counts, percentages, competition ranking, multi-seat winners, ties (no automatic winner), turnout
- ✔ Live updates across windows · ✔ winner display after closing · ✔ visibility: live / after close / admins only · ✔ SQL ranking identical to the JS rules

**UI**
- ✔ Desktop, laptop, tablet (admin drawer menu), projector (scales with viewport), keyboard shortcuts, reduced motion
- ☐ Your actual Smartboard/projector and lab PCs, in kiosk mode

## Troubleshooting
| Symptom | Fix |
|---|---|
| "Security stop: secret key detected" | You pasted the service_role key into `config.js`. Remove it, rotate it in Supabase, use the publishable/anon key. |
| "We couldn't connect to the election server" | Check the internet connection and `SUPABASE_URL`. Custom domain? Add it to `connect-src` in `index.html`. |
| Admin sign-in says "not an election administrator" | Run the `insert into public.admin_users …` step, or have a Super Admin grant the role. |
| Results screen says "sealed" | Election → Results display is "After closing" or "Admins only". |
| "Too many incorrect codes" at a station | Throttle after 150 wrong codes in 10 min from one network. Wait a few minutes; check nobody is guessing. |
| A student lost their code | Voters → search → **New code** → print/hand over the replacement. |
| Can't add a candidate after voting started | By design: the ballot is frozen once the first vote is cast. Text, photos and slogans can still be corrected. |
| Local demo data is a mess | Settings → System → Erase all local data (local mode only). |
| Opening `index.html` by double-click shows a blank page | Serve it instead: `node tools/serve.js` (or any web host). |

## Backend API (integration points)
Both `js/backend/local.js` and `js/backend/supabase.js` implement the same object, so screens never know which backend they use. Main calls and the SQL behind them:

| Call | Supabase | Who |
|---|---|---|
| `getPublic()` | `rpc get_public_state` | anyone |
| `subscribe(electionId, fn)` | Realtime on `election_pulse` | anyone |
| `beginVoting(id, code)` / `submitBallot(token, {positionId:[candidateIds]})` | `rpc begin_voting` / `rpc submit_ballot` | stations |
| `stationHeartbeat(id, stationId, label)` | `rpc station_heartbeat` | stations |
| `getResults(id)` | `rpc get_results` (aggregates only) | anyone, per visibility |
| `auth.signIn / current / signOut` | Supabase Auth + `rpc my_admin` | admins |
| `saveSchool`, `createElection`, `updateElection` | tables `schools`, `elections` (RLS) | Super Admin |
| `setStatus(id, status, phrase)`, `archiveElection` | `rpc set_election_status`, `rpc archive_election` | Super Admin |
| `savePosition`, `deletePosition`, `reorderPositions` | table `positions`, `rpc reorder_positions` | Super Admin |
| `saveCandidate`, `deleteCandidate`, `reorderCandidates`, `uploadImage` | table `candidates`, `rpc reorder_candidates`, Storage | Super/Election Admin |
| `importVoters`, `regenerateCodes`, `setVoterActive`, `removeVoter`, `listVoters` | `rpc import_voters`, `rpc regenerate_codes`, … , table `voters` (no hash column) | Super/Election Admin |
| `getBundle`, `getMonitor`, `listAudit`, `logAction` | `rpc get_admin_bundle`, `rpc get_monitor`, table `audit_logs`, `rpc log_action` | admins |
| `listAdmins`, `grantAdmin`, `revokeAdmin` | `rpc list_admins`, `rpc grant_admin`, `rpc revoke_admin` | Super Admin |
| `resetDemo(id, phrase)` | `rpc reset_demo` (demo elections only) | Super Admin |
