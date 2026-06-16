-- Migration v7 — run in Supabase SQL Editor
-- Adds: job_source enum, contracts, contract_clients, billing cols on customers/jobs

-- 1. Tables must exist before we add FKs, so create them first

CREATE TABLE IF NOT EXISTS contracts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text        NOT NULL,
  billing_type   text        NOT NULL DEFAULT 'ratecard',
  billing_config jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contracts anon full access"          ON contracts FOR ALL TO anon          USING (true) WITH CHECK (true);
CREATE POLICY "contracts authenticated full access" ON contracts FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS contract_clients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE contract_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contract_clients anon full access"          ON contract_clients FOR ALL TO anon          USING (true) WITH CHECK (true);
CREATE POLICY "contract_clients authenticated full access" ON contract_clients FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Enum for job source (run separately if this errors: "type already exists")
DO $$ BEGIN
  CREATE TYPE job_source_enum AS ENUM ('private', 'contract', 'subcontract');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. New columns on jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source               job_source_enum NOT NULL DEFAULT 'subcontract';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contract_id          uuid REFERENCES contracts(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contract_client_id   uuid REFERENCES contract_clients(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_billing_config jsonb;

-- customer_id already exists on jobs from initial schema — no-op:
-- ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id);

-- 4. Billing columns on customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_type   text  DEFAULT 'ratecard';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_config jsonb DEFAULT '{}'::jsonb;
