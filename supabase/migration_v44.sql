-- migration_v44: multi-truck client charge + employee/casual out-of-pocket reimbursements
-- job_trucks.client_charge_amount: value charged to the client for that specific
-- truck (mirrors job_extra_men.client_charge_amount) — optional, defaults to 0.
-- job_employee_expenses: money an employee or casual worker spends out of pocket
-- on the job (e.g. a parking ticket) that must be reimbursed to them — surfaces
-- as an extra pay line on that specific person's invoice (staff or casual),
-- same dual-reference pattern as job_commissions.

ALTER TABLE job_trucks ADD COLUMN IF NOT EXISTS client_charge_amount numeric DEFAULT 0;

CREATE TABLE IF NOT EXISTS job_employee_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id),
  casual_worker_id uuid REFERENCES casual_workers(id),
  description text,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
