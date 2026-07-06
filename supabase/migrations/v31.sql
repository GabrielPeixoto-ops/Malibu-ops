-- v31 — Add cof_share and hours to job_casual_crew
-- Required by JobForm.tsx casual crew save logic.
-- Without these columns, every insert silently fails (caught by try/catch).

ALTER TABLE job_casual_crew
  ADD COLUMN IF NOT EXISTS cof_share boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hours     numeric;
