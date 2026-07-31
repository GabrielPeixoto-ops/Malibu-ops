-- migration_v57: Pending Approval flag for jobs
--
-- Lets the office flag a job on the Dashboard as "owner needs to review the
-- hours" WITHOUT changing the job's actual status (draft/scheduled/confirmed/
-- etc). Purely a visual signal — renders the job card in a distinct color on
-- the Dashboard. Toggleable from both the JobForm (checkbox) and directly on
-- the Dashboard job card (quick toggle).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hours_pending_approval boolean DEFAULT false;
