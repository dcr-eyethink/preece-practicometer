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
  // newuser@email.com's account id — new sign-ups clone its practice sets
  // and scores (see cloneFromTemplateAccount in js/data-api.js) instead of
  // the static default-sets.js / default-scores.js seed.
  templateUserId: '6b46b806-5c24-4617-8f17-a086b1c20623'
};
