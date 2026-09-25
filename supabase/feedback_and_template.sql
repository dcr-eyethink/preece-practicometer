-- Run this once in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
-- (The app only ships with the anon key, which can't run DDL, so this has to be pasted in by hand.)

-- ── 1. Feedback table ──────────────────────────────────────────────────────
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  user_email text not null,
  enjoyment smallint check (enjoyment between 1 and 9),
  liked text,
  improve text,
  disliked text,
  created_at timestamptz not null default now()
);

-- Safe to re-run: adds the column if you already ran this script before the
-- enjoyment slider was added.
alter table feedback add column if not exists enjoyment smallint check (enjoyment between 1 and 9);

alter table feedback enable row level security;

create policy "insert own feedback" on feedback
  for insert with check (auth.uid() = user_id);

-- Everyone can read their own feedback back; dcr@eyethink.org can read everyone's
-- (used by the CSV export button).
create policy "select own or admin" on feedback
  for select using (
    auth.uid() = user_id or auth.jwt() ->> 'email' = 'dcr@eyethink.org'
  );


-- ── 2. Template-account seeding for new sign-ups ────────────────────────────
-- Steps:
--   a) Create the newuser@email.com / newuser account yourself, via the app's
--      own "Sign Up" screen (Sign In box -> Sign Up).
--   b) Run the query below to find its user id:
--        select id from auth.users where email = 'newuser@email.com';
--   c) Replace TEMPLATE_USER_ID_HERE in the two policies below with that id
--      (keep the quotes), then run just those two CREATE POLICY statements.
--   d) Put the same id into js/config.js as templateUserId (see comment there).
--
-- These policies let any signed-in user read (but not write) newuser@email.com's
-- practice_sets rows and score files, so the app can clone them into a brand
-- new account on first sign-in. Nothing else about newuser's privacy changes —
-- other users still can't see each other's own sets or scores.

create policy "read template sets" on practice_sets
  for select using (user_id = 'TEMPLATE_USER_ID_HERE');

create policy "read template score files" on storage.objects
  for select using (
    bucket_id = 'scores' and (storage.foldername(name))[1] = 'TEMPLATE_USER_ID_HERE'
  );

-- scores table itself (the metadata row, not the file) needs the same treatment:
create policy "read template scores" on scores
  for select using (user_id = 'TEMPLATE_USER_ID_HERE');
