-- Run this once in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Adds folders to the set browser (index.html's #setsPanel / renderSetBrowser
-- in js/data-api.js): a new set_folders table, plus folder_id/position on
-- practice_sets so sets can be filed into folders and manually ordered.
-- Folder "delete" is soft (trashed boolean), mirroring archive_practice_sets.sql's
-- archived flag on practice_sets, so a deleted folder's contents land in the
-- set browser's Trash view and can be restored.

create table if not exists set_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  parent_folder_id uuid references set_folders(id) on delete set null,
  position integer not null default 0,
  trashed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table set_folders enable row level security;

create policy "own folders select" on set_folders
  for select using (auth.uid() = user_id);
create policy "own folders insert" on set_folders
  for insert with check (auth.uid() = user_id);
create policy "own folders update" on set_folders
  for update using (auth.uid() = user_id);
create policy "own folders delete" on set_folders
  for delete using (auth.uid() = user_id);

-- Mirrors admin_dashboard.sql's admin access to practice_sets.
create policy "admin select any folder" on set_folders
  for select using (auth.jwt() ->> 'email' = 'dcr@eyethink.org');

alter table practice_sets
  add column if not exists folder_id uuid references set_folders(id) on delete set null,
  add column if not exists position integer not null default 0;
