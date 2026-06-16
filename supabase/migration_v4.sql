-- Migration v4 — run in Supabase SQL Editor
-- Adds start_time / end_time to job_crew for time-based hour calculation

ALTER TABLE job_crew ADD COLUMN IF NOT EXISTS start_time text;
ALTER TABLE job_crew ADD COLUMN IF NOT EXISTS end_time   text;
