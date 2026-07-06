-- migration_v36: add paid_at timestamp to jobs table
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS paid_at timestamptz;
