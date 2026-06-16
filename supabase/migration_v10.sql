-- Migration v10 — Google Review Bonus + Photo Categories
-- Safe to re-run (IF NOT EXISTS / IF NOT EXISTS)

-- 1. Google Review Bonus flag on entity tables
ALTER TABLE subcontractors ADD COLUMN IF NOT EXISTS google_review_bonus boolean NOT NULL DEFAULT false;
ALTER TABLE customers      ADD COLUMN IF NOT EXISTS google_review_bonus boolean NOT NULL DEFAULT false;
ALTER TABLE contracts      ADD COLUMN IF NOT EXISTS google_review_bonus boolean NOT NULL DEFAULT false;

-- 2. Google Review tracking on jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS google_review              boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS google_review_employee_ids uuid[]  NOT NULL DEFAULT '{}';

-- 3. Photo category on job_photos
ALTER TABLE job_photos ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'completion';
