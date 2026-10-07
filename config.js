/* =====================================================================================
   ELECTION SYSTEM CONFIGURATION
   -------------------------------------------------------------------------------------
   • Leave SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY empty to run in LOCAL DEMO MODE:
     everything works inside this one browser (great for trying the system out).
   • For the real election, create a Supabase project, run supabase/schema.sql, then paste
     the Project URL and the PUBLISHABLE (anon) key below.  See README.md.

   ⚠ NEVER put the service_role / secret key here.  This file is downloaded by every
     voting station.  The app refuses to start if it detects a secret key.
   ===================================================================================== */
window.SGE_CONFIG = {
  SUPABASE_URL: 'https://dcojzccbjpsmknfdfein.supabase.co',             // project: school-elections (Frankfurt)
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_bdWRsfGwsmk_2chDXd14sw_mhDz2NHD', // publishable key — public by design

  // Where to load supabase-js from.  For the most locked-down setup, download this file
  // into vendor/ and change the path to 'vendor/supabase.js'.
  SUPABASE_JS_URL: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
  MEDIA_BUCKET: 'election-media',

  // Voting station behaviour
  STATION_IDLE_SECONDS: 120,     // ask "Are you still voting?" after this much inactivity
  STATION_RESET_SECONDS: 10,     // return to "Ready for next voter" after a successful vote
};
