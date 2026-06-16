-- Per-crew COF hours (overrides global job COF for payroll purposes)
ALTER TABLE job_crew ADD COLUMN IF NOT EXISTS cof_hours numeric NOT NULL DEFAULT 0.5;

-- Scheduled time on jobs (shown in Job Info alongside Date)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_time time;
