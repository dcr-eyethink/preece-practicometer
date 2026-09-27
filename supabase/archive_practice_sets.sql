-- Run this once in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Adds "Archive" (soft delete) for practice lists: a user's own trash-icon
-- button on a list (see index.html's set-item-archive-btn) hides it from
-- their own view via archiveSet() in js/data-api.js, without erasing it —
-- only an admin can bring it back, via the Admin Dashboard's Restore button
-- (adminRestoreSet in js/data-api.js).

alter table practice_sets add column if not exists archived boolean not null default false;

-- Lets dcr@eyethink.org un-archive a list on someone's behalf (adminRestoreSet).
-- The existing "admin delete any set" etc. policies from admin_dashboard.sql
-- don't cover UPDATE, so this is a new one.
create policy "admin update any set" on practice_sets
  for update using (auth.jwt() ->> 'email' = 'dcr@eyethink.org');

-- Fix-up for supabase/dedupe_practice_sets.sql's plain unique(user_id, name)
-- constraint: without this, archiving a list and then creating (or being
-- re-seeded with) a new one under that same name would fail, since the
-- archived row would still be "using" that name. Swap it for a partial
-- index that only enforces uniqueness among non-archived rows.
alter table practice_sets drop constraint if exists practice_sets_user_id_name_key;
create unique index if not exists practice_sets_user_id_name_active_uidx
  on practice_sets (user_id, name) where not archived;
