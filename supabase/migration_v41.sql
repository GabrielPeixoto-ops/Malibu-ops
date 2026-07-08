-- migration_v41: deposit column on jobs (private jobs)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deposit numeric;
