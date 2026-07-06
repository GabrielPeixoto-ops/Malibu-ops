-- migration_v37: casual_worker_id in job_commissions — allow casuals to be commission recipients
ALTER TABLE job_commissions ADD COLUMN IF NOT EXISTS casual_worker_id uuid REFERENCES casual_workers(id) ON DELETE SET NULL;
