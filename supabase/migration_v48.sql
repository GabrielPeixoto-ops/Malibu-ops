-- migration_v48: role categorization for Casual Workers
--
-- casual_workers.role: nullable text tag classifying each casual worker as
-- 'offsider', 'driver', or 'packer'. Purely additive metadata on the registry
-- table — no existing job/invoice data references this column, so backfilling
-- it is optional and safe to do gradually via the Employees > Casual Workers
-- edit modal. Existing rows default to NULL ("No role set") until edited.

ALTER TABLE casual_workers ADD COLUMN IF NOT EXISTS role text;

ALTER TABLE casual_workers
  DROP CONSTRAINT IF EXISTS casual_workers_role_check;

ALTER TABLE casual_workers
  ADD CONSTRAINT casual_workers_role_check
  CHECK (role IS NULL OR role IN ('offsider', 'driver', 'packer'));
