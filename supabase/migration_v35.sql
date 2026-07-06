-- migration_v35: job_expenses with is_client_expense flag
-- Handles two cases: table created fresh (v34 skipped) or table already exists from v34

-- Case A: create fresh with is_client_expense column
CREATE TABLE IF NOT EXISTS job_expenses (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            uuid          NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  description       text          NOT NULL,
  amount            decimal(10,2) NOT NULL,
  is_client_expense boolean       NOT NULL DEFAULT true,
  created_at        timestamptz   DEFAULT now()
);

-- Case B: table already exists from v34 — add the column if missing
DO $$ BEGIN
  ALTER TABLE job_expenses ADD COLUMN is_client_expense boolean NOT NULL DEFAULT true;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

ALTER TABLE job_expenses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can manage job_expenses"
    ON job_expenses FOR ALL TO authenticated
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
