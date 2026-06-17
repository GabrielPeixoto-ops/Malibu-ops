-- migration_v23: per-entity rate tables for subcontractors and contracts

CREATE TABLE IF NOT EXISTS subcontractor_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontractor_id uuid NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  name text NOT NULL,
  rate_per_hour numeric NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contract_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  name text NOT NULL,
  rate_per_hour numeric NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS subcontractor_rate_id uuid REFERENCES subcontractor_rates(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contract_rate_id uuid REFERENCES contract_rates(id);
