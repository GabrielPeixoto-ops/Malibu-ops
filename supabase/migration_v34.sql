-- migration_v34: job_expenses table for tracking per-job expenses (parking, tolls, fuel, etc.)

CREATE TABLE IF NOT EXISTS job_expenses (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid         NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  description text         NOT NULL,
  amount      decimal(10,2) NOT NULL,
  created_at  timestamptz  DEFAULT now()
);

ALTER TABLE job_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage job_expenses"
  ON job_expenses FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
