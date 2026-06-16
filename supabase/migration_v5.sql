-- Migration v5 — run in Supabase SQL Editor
-- Adds actual start/finish times to jobs

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS actual_start_time  text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS actual_finish_time text;
