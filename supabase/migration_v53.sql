-- migration_v53: job_extra_men.casual_worker_id
--
-- CRITICAL FIX: job_extra_men only ever had `employee_id uuid REFERENCES
-- employees(id)` — there was no separate column for casual workers, unlike
-- job_casual_crew / job_commissions / job_employee_expenses, which all
-- correctly split employee_id vs casual_worker_id into two FK columns.
--
-- JobForm.tsx's free-text "Extra Man" field resolves a typed name against
-- BOTH staff (employees) and casual workers, then saved whatever id it found
-- into employee_id — including casual workers' ids. Since employee_id's FK
-- only accepts ids that exist in employees(id), saving an extra man who is a
-- registered casual worker violated the FK constraint. The insert is a
-- delete-then-reinsert wrapped in a try/catch, so the DELETE succeeded, the
-- INSERT threw, and the row was silently gone — every single time an extra
-- man matched a casual worker, on every source (private/contract/subcontract).
--
-- This adds the missing column so the app can now correctly store staff in
-- employee_id and casual workers in casual_worker_id (JobForm.tsx has been
-- fixed to write to the correct column based on the match type).
ALTER TABLE job_extra_men ADD COLUMN IF NOT EXISTS casual_worker_id uuid REFERENCES casual_workers(id);

CREATE INDEX IF NOT EXISTS job_extra_men_casual_worker_id_idx ON job_extra_men(casual_worker_id);
