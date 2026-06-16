-- Migration v2 — run in Supabase SQL Editor
-- Adds: 'reviewed' status, extra_men_hours, break_minutes, cof_final

-- 1. New status value (no IF NOT EXISTS needed on Postgres 14+)
ALTER TYPE job_status_enum ADD VALUE 'reviewed' AFTER 'completed';

-- 2. New job columns
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS extra_men_hours numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS break_minutes   numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cof_final       numeric(10,2);
