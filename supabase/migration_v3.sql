-- Migration v3 — run in Supabase SQL Editor
-- Adds: job_photos table, completion_notes column on jobs

-- 1. New column on jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completion_notes text;

-- 2. Photos table
CREATE TABLE IF NOT EXISTS job_photos (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  url        text        NOT NULL,
  caption    text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE job_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full access" ON job_photos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon full access" ON job_photos
  FOR ALL TO anon USING (true) WITH CHECK (true);
