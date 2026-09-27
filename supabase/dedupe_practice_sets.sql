-- Run this once in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Root-cause fix for duplicate practice lists: a brand-new account opened in
-- two tabs/devices at nearly the same moment could have both race to seed
-- its starter/template practice sets before either finished, producing two
-- rows with the same (user_id, name). js/data-api.js's seedDefaultsIfEmpty
-- and cloneFromTemplateAccount now handle a unique-violation on that insert
-- gracefully (see the comments there) instead of creating the duplicate —
-- but that guard only works once this constraint actually exists.
--
-- IMPORTANT: run this AFTER removing any existing duplicates (e.g. via the
-- Admin Dashboard's Delete button on each extra copy) — it will fail with a
-- "duplicate key" error if any (user_id, name) pair still repeats, and
-- nothing is changed when it fails.
alter table practice_sets
  add constraint practice_sets_user_id_name_key unique (user_id, name);
