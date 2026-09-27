-- Run this once in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
-- (The app only ships with the anon key, which can't run DDL, so this has to
-- be pasted in by hand — same as supabase/feedback_and_template.sql.)
--
-- Adds the "Admin Dashboard" button (dcr@eyethink.org only): a list of every
-- account, each one's practice log, and the ability to copy or move a
-- practice list (and any scores its rows reference) into a different
-- account. See js/admin-ui.js and the admin* functions in js/data-api.js.

-- ── 1. profiles: mirrors auth.users' id/email ───────────────────────────────
-- The client only ever has the anon key, which can't query auth.users
-- directly, so the dashboard's user list is read from this table instead.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "select own or admin" on profiles
  for select using (
    auth.uid() = id or auth.jwt() ->> 'email' = 'dcr@eyethink.org'
  );

-- Keeps profiles in sync with auth.users for every sign-up from now on.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- One-time backfill for accounts that signed up before this trigger existed.
-- Safe to re-run.
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;


-- ── 2. Admin access to every account's practice lists and log ──────────────
-- These are additional (OR'd) policies alongside whatever "own rows only"
-- policy practice_sets/practice_log/scores already have — signed-in users
-- still only ever see their own rows; dcr@eyethink.org additionally sees
-- everyone's.

create policy "admin select all sets" on practice_sets
  for select using (auth.jwt() ->> 'email' = 'dcr@eyethink.org');
create policy "admin insert any set" on practice_sets
  for insert with check (auth.jwt() ->> 'email' = 'dcr@eyethink.org');
create policy "admin delete any set" on practice_sets
  for delete using (auth.jwt() ->> 'email' = 'dcr@eyethink.org');

-- Read-only: the dashboard's "practice log" view. Admin never edits or
-- deletes another account's log entries.
create policy "admin select all practice log" on practice_log
  for select using (auth.jwt() ->> 'email' = 'dcr@eyethink.org');

-- A copied/moved list's score rows get cloned too (see adminCopySet in
-- js/data-api.js), so the new owner's own "own rows only" policy covers
-- reading them back afterwards — no broader scores-table access is needed
-- beyond admin being able to read the source row and insert the clone.
create policy "admin select all scores" on scores
  for select using (auth.jwt() ->> 'email' = 'dcr@eyethink.org');
create policy "admin insert any score" on scores
  for insert with check (auth.jwt() ->> 'email' = 'dcr@eyethink.org');

-- Storage: admin needs to read the source file and write a copy under the
-- target account's own folder (adminCopySet uses storage.copy() for this).
-- Once copied, the target account's ordinary per-user storage policy
-- (folder name == their own auth.uid()) covers reading it back — this admin
-- policy is only ever used for the copy step itself.
create policy "admin select any score file" on storage.objects
  for select using (
    bucket_id = 'scores' and auth.jwt() ->> 'email' = 'dcr@eyethink.org'
  );
create policy "admin insert any score file" on storage.objects
  for insert with check (
    bucket_id = 'scores' and auth.jwt() ->> 'email' = 'dcr@eyethink.org'
  );
