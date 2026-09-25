// Copy this file to config.js (which is gitignored) and fill in your
// Supabase project's values from Settings -> API.
//
// The anon key is meant to be public/client-side — it's not a secret.
// Access control is enforced by the Row Level Security policy on
// practice_sets, not by hiding this key. Never put the service_role key
// or your database password here or anywhere in the frontend.
window.PRACTICOMETER_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-PUBLIC-KEY',
  // user id of the "template" account whose practice sets get cloned into
  // every brand-new sign-up (see supabase/feedback_and_template.sql). Leave
  // null to fall back to the static js/default-sets.js / default-scores.js seed.
  templateUserId: null
};
