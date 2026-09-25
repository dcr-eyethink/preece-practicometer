// Copy this file to config.js (which is gitignored) and fill in your
// Supabase project's values from Settings -> API.
//
// The anon key is meant to be public/client-side — it's not a secret.
// Access control is enforced by the Row Level Security policy on
// practice_sets, not by hiding this key. Never put the service_role key
// or your database password here or anywhere in the frontend.
window.PRACTICOMETER_CONFIG = {
  supabaseUrl: 'https://zpvdklhvvhnmjhszinup.supabase.co',
  supabaseAnonKey: 'sb_publishable_EDvY4czxWvxOVCZ8VYQp7A_mQaqnvH2',
  // Fill in once newuser@email.com exists and you've run supabase/feedback_and_template.sql —
  // see that file for the exact steps. Until then this stays null and new
  // accounts get the old static default-sets.js / default-scores.js seed.
  templateUserId: null
};
